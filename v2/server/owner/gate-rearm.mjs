import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";
import { hashCanonical } from "../core/canonical.mjs";
import { parse } from "../storage/db.mjs";
import { classifySuspension, suspensionKey, credentialTag, SECURITY_EVENT_TYPES, SECURITY_EVENT_LABELS, SECURITY_LOOKBACK_MS, SUSPENSION_LABELS, CHANNEL_LABELS } from "../policy/gate-state.mjs";
import { createStopScope } from "./stop-scope.mjs";
import { createLeaseReconciler, LEASES_ACK_LABEL } from "../runtime/lease-reconcile.mjs";

/**
 * M10.2.1 contextual gate rearm (owner decisions D14–D16). Before it, the only way to reopen the execution gate after Stop All was the
 * typed OPEN GATE in Integrări → Avansat (the per-boot UI token, no owner session, no authenticator) — and the owner-facing texts
 * pointed there or to „Sistem”, where no gate control exists. Here the rearm is ONE decision in the cockpit:
 *
 *  - eligibility() reads the recorded suspension (policy/gate-state.mjs) and the state that must be quiet first: no lease of a run that
 *    still looks live (a retained lease of a finished run is a step of the card, below), no run still stopping or still being admitted,
 *    no mission still in CANCEL_REQUESTED, no Lega session. The owner's own pause is not rearmed here („Continuă” reopens it, LC-10 / IN-04);
 *  - cardFor() shows what stopped the gate (who, when, from where), what it stopped, what stays stopped after the rearm, and the
 *    security events around the stop (D16). It needs the owner session; one live nonce per (session, suspension), 5 minutes, in memory
 *    (a restart forgets every card: fail-safe);
 *  - apply() needs a FRESH authenticator verification (trust.requireFresh, ≤ 5 min) FIRST, a click / Enter / typed modality (never
 *    voice), the card's nonce and hash, and a compare-and-set on the exact suspension. In ONE transaction it opens the WHOLE gate (one
 *    kill switch, no plan-only exemption) and puts the Hub back in BUILD_SAFE if it was not (D15).
 *
 * Nothing old restarts: missions Stop All cancelled stay cancelled; what the stop itself paused (operation plans, the desktop session;
 * D22, owner/stop-scope.mjs) stays paused until an explicit „Continuă” after the rearm; preserved requests are not swept
 * (work-requests.mjs skips a rearm); only the request that showed the card is re-proposed — a plan that still needs its own
 * confirmation. No timer and no tick ever reopens the gate.
 *
 * 2.12.2 (P0-R1): a workspace lease retained after an unconfirmed stop or a restart is no longer a dead end. The card first runs the
 * reconciler's sweep (runtime/lease-reconcile.mjs: a lease whose run is finished and whose process is provably gone is released at
 * once); what remains is listed as a step INCLUDED in the same decision and bound into the card hash (lease ids, runs, verdicts):
 *  - an orphaned process the Hub's own records tie to that run ("process_alive") is stopped by apply() — after the fresh verification,
 *    inside the same ceremony — and its lease released, then the gate reopens;
 *  - a lease whose outcome cannot be proven ("unknown", e.g. an environment reap that never confirmed) needs the owner's explicit
 *    acknowledgement (ackLeases: true; the card says what is unknown); a Hub-tied process is still stopped first.
 * A lease of a run that still looks live is never touched (LEASES, not eligible). Under the owner's OWN pause the card releases only the
 * leases (scope "leases") and leaves the pause to „Continuă”. One rearm at a time (REARM_BUSY): never a double kill, never two reopenings.
 */
export const REARM_TTL_MS = 5 * 60000;
export const REARM_MODALITIES = Object.freeze(["click", "keyboard", "typed"]);
export const REARM_CODES = Object.freeze(["OPEN", "OWNER_PAUSE", "LEASES", "RUNS_ACTIVE", "CANCEL_PENDING", "LEGA_ACTIVE", "ELIGIBLE", "SECURITY"]);
const MAX_LIVE_CARDS = 200;
const MAX_SECURITY_LISTED = 20;
/** The newest security events whose ids the card hash binds (with the true count and the newest seq, so it never saturates). */
const MAX_SECURITY_HASHED = 500;
/** VOICE-04: a not-yet answer says what the OWNER does next; nothing reopens the gate by itself (no „redeschid poarta după…”). */
const REOPEN_BY_OWNER = "o redeschizi tu, aici în cockpit, pe cardul „Redeschide poarta”, cu Windows Hello — nu se redeschide singură";

/** „Poarta de execuție e …” per class (the card's headline). */
const STATE_PHRASE = Object.freeze({ stop_all: "oprită de Stop All", suspend: "suspendată", shutdown: "suspendată la oprirea Hub-ului", security: "oprită după un eveniment de securitate",
  first_start: "suspendată de la prima pornire", legacy_unknown: "suspendată (originea opririi nu a fost înregistrată)", pause_unowned: "pe pauză fără sesiunea ta de proprietar",
  owner_pause: "pe pauză din altă sesiune a ta (alt autentificator)" });

const plural = (n, one, many) => (n === 1 ? one : `${n} ${many}`);

export function createGateRearm(hub) {
  const { db, bus, settings, trust, config } = hub;
  const clock = config.now;
  const iso = () => clock().toISOString();
  /** nonce → { sessionId, key, hash, requestId, cls, expiresAtMs } (in memory; single use). */
  const cards = new Map();
  /** D22: what the current suspension's own stop holds (hub.stopScope when wired; a private reader otherwise — both read-only). */
  let ownScope = null;
  const stopScope = () => hub.stopScope || (ownScope ||= createStopScope(hub));
  /** P0-R1: the lease reconciler (hub.leaseReconciler when wired; a private, non-subscribing one otherwise). */
  let ownReconciler = null;
  const reconciler = () => hub.leaseReconciler || (ownReconciler ||= createLeaseReconciler(hub, { subscribe: false }));
  /** The rearm in flight (one at a time: a second one is refused, never queued — no double kill, never two reopenings). */
  let applying = null;

  /**
   * P0-R1: the leases the decision must include → { steps, held, failed }. `write` (the card, the rearm) sweeps first; a read
   * (eligibility) writes nothing. A reconciler failure never opens the gate over a reserved workspace: every retained lease is then held.
   */
  function leaseView({ write = false } = {}) {
    try {
      const out = reconciler().pendingSteps({ write, reason: "rearm" });
      return { steps: out.steps || [], held: out.held || [], failed: false };
    } catch (error) {
      const n = count("SELECT COUNT(*) AS n FROM leases WHERE status = 'retained'");
      return { steps: [], held: n ? [{ leaseId: null, verdict: "unknown", reason: `verificarea rezervărilor a eșuat (${String(error?.message || error).slice(0, 120)})` }] : [], failed: true };
    }
  }
  /** The card's summary of the included lease steps (null when there is none); its hash binds the exact list. */
  function leasesOf(steps) {
    if (!steps.length) return null;
    const sorted = [...steps].sort((a, b) => String(a.leaseId).localeCompare(String(b.leaseId)));
    return { steps: sorted, total: sorted.length, terminate: sorted.filter((s) => s.verdict === "process_alive" || s.tie === "supervisor" || s.tie === "pid").length,
      ackRequired: sorted.some((s) => s.ack), ackLabel: LEASES_ACK_LABEL,
      hash: hashCanonical(sorted.map((s) => [s.leaseId, s.runId || null, s.verdict, s.tie || null, s.pid || null])) };
  }
  const heldReason = (held) => {
    const first = held[0] || {};
    const what = first.label ? `execuția „${first.label}”` : "o execuție";
    return `${held.length === 1 ? "Un spațiu de lucru e încă rezervat" : `${held.length} spații de lucru sunt încă rezervate`} de ${what}, care figurează încă în lucru${first.reason && !first.label ? ` (${first.reason})` : ""}; nu ating o execuție în lucru. După ce oprirea ei e confirmată, ${REOPEN_BY_OWNER}.`;
  };

  const when = (value) => {
    const d = new Date(value || "");
    if (Number.isNaN(d.getTime())) return null;
    try { return d.toLocaleString("ro-RO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return d.toISOString().slice(0, 16).replace("T", " "); }
  };
  const count = (sql, ...args) => { try { return Number(db.prepare(sql).get(...args)?.n || 0); } catch { return 0; } };
  /** The credential reference of an owner session, re-read from the database (an ended or expired session has none). */
  const sessionTag = (session) => {
    if (!session?.id) return null;
    const row = db.prepare("SELECT credential_id, status, expires_at FROM owner_sessions WHERE id = ?").get(String(session.id));
    return row && row.status === "active" && new Date(row.expires_at) > clock() ? credentialTag(row.credential_id) : null;
  };

  /**
   * D16 scan state per (suspension key, window start), REG-05 / SM-08: the first evaluation of a suspension scans the window once (the
   * true COUNT, the newest MAX_SECURITY_HASHED rows); every later one reads only the events written since (`seq > lastSeq`, a rowid
   * range — cheap), so the readiness explanations no longer walk the whole events table each time. A read inside a transaction may
   * see rows that are later rolled back: the state keeps the id of the newest row it saw (lastSeq is always the newest insert of this
   * connection, so a rolled-back write removes or replaces exactly that row) and is rebuilt when that row is gone or different. A new
   * suspension (key) starts over.
   */
  const SECURITY_TYPES_SQL = SECURITY_EVENT_TYPES.map(() => "?").join(",");
  let scanState = null; // { key, from, lastSeq, lastId, total, maxSeq, rows: [{ seq, id, type, created_at }] ascending, ≤ MAX_SECURITY_HASHED }
  const maxEventSeq = () => Number(db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM events").get().seq || 0);
  const idAt = (seq) => (seq > 0 ? db.prepare("SELECT id FROM events WHERE seq = ?").get(seq)?.id || null : null);
  function securityRows(key, from) {
    let state = scanState && scanState.key === key && scanState.from === from && idAt(scanState.lastSeq) === scanState.lastId ? scanState : null;
    if (!state) {
      const lastSeq = maxEventSeq();
      const agg = db.prepare(`SELECT COUNT(*) AS n, MAX(seq) AS maxSeq FROM events WHERE seq <= ? AND type IN (${SECURITY_TYPES_SQL}) AND created_at >= ?`).get(lastSeq, ...SECURITY_EVENT_TYPES, from);
      const rows = db.prepare(`SELECT seq, id, type, created_at FROM events WHERE seq <= ? AND type IN (${SECURITY_TYPES_SQL}) AND created_at >= ? ORDER BY seq DESC LIMIT ?`)
        .all(lastSeq, ...SECURITY_EVENT_TYPES, from, MAX_SECURITY_HASHED).reverse();
      state = { key, from, lastSeq, lastId: idAt(lastSeq), total: Number(agg?.n || 0), maxSeq: Number(agg?.maxSeq || 0), rows };
    }
    const lastSeq = maxEventSeq();
    if (lastSeq > state.lastSeq) {
      const fresh = db.prepare(`SELECT seq, id, type, created_at FROM events WHERE seq > ? AND seq <= ? AND type IN (${SECURITY_TYPES_SQL}) ORDER BY seq`)
        .all(state.lastSeq, lastSeq, ...SECURITY_EVENT_TYPES).filter((r) => String(r.created_at) >= from);
      state = { ...state, lastSeq, lastId: idAt(lastSeq), total: state.total + fresh.length, maxSeq: fresh.length ? Number(fresh.at(-1).seq) : state.maxSeq,
        rows: fresh.length ? [...state.rows, ...fresh].slice(-MAX_SECURITY_HASHED) : state.rows };
    }
    scanState = state;
    return state;
  }

  /**
   * D16: security events from SECURITY_LOOKBACK_MS before the start of the suspension chain until now (the whole log when the start
   * is unknown — the first start). null when there is none and the suspension is not itself a security one. The card lists the
   * NEWEST first (order: "newest_first"); `total` is the true count; the hash binds every listed-or-not id up to MAX_SECURITY_HASHED,
   * the count and the newest seq, so any new event changes it (CARD_CHANGED) however long the chain.
   */
  function securityScan(c, key) {
    const start = Date.parse(String(c.since || c.at || ""));
    const from = Number.isFinite(start) ? new Date(start - SECURITY_LOOKBACK_MS).toISOString() : "";
    const state = securityRows(key, from);
    if (!state.total && c.cls !== "security") return null;
    const events = state.rows.slice(-MAX_SECURITY_LISTED).reverse().map((r) => ({ id: r.id, type: r.type, at: r.created_at, label: SECURITY_EVENT_LABELS[r.type] || r.type }));
    return { events, total: state.total, truncated: state.total > events.length, order: "newest_first",
      hash: hashCanonical({ key, total: state.total, maxSeq: state.maxSeq, ids: state.rows.map((r) => r.id) }) };
  }

  /** What the suspension stopped and what stays stopped after a rearm (the owner's words; counts read from the database). */
  function factsOf(c) {
    const via = c.channel ? CHANNEL_LABELS[c.channel] || c.channel : null;
    const what = [];
    if (["stop_all", "shutdown", "security"].includes(c.cls)) {
      const ev = c.id ? db.prepare("SELECT payload_json FROM events WHERE type = 'system.stop_all' AND json_extract(payload_json, '$.suspensionId') = ? ORDER BY seq DESC LIMIT 1").get(c.id) : null;
      const p = ev ? parse(ev.payload_json, {}) : {};
      // 2.12.2 (D1): the boot's own suspension over a workspace still reserved after a crash is not a stop: it revoked nothing, so the
      // card never claims it did (no system.stop_all for that record).
      if (!ev && c.channel === "recovery") what.push("Poarta de execuție a fost suspendată la repornirea Hub-ului: un spațiu de lucru a rămas rezervat de o execuție întreruptă.");
      else what.push("Poarta de execuție a fost suspendată și toate autorizările active au fost revocate.");
      if (Number(p.interrupted) > 0) what.push(`${plural(Number(p.interrupted), "O execuție a fost întreruptă", "execuții au fost întrerupte")}.`);
      if (Number(p.factoryMissions) > 0) what.push(`${plural(Number(p.factoryMissions), "O misiune a fost oprită (anulată)", "misiuni au fost oprite (anulate)")}.`);
      // D22: what the stop itself recorded beyond the runs (payload.scope).
      const plansStopped = (Array.isArray(p.scope?.plansPaused) ? p.scope.plansPaused.length : 0) + (Array.isArray(p.scope?.plansInterrupted) ? p.scope.plansInterrupted.length : 0);
      if (plansStopped) what.push(`${plural(plansStopped, "Un plan de operare a fost oprit", "planuri de operare au fost oprite")}.`);
      if (p.scope?.desktopSessionId) what.push("Operatorul desktop a fost oprit (aplicațiile au rămas deschise).");
      if (p.voiceStopped) what.push("Sesiunea vocală Lega a fost închisă.");
    } else if (c.cls === "suspend") what.push("Poarta de execuție a fost suspendată: nicio execuție nouă nu pornește.");
    else if (c.cls === "pause_unowned" || c.cls === "owner_pause") what.push("Hub-ul a fost pus pe pauză: pașii activi au fost întrerupți și nimic nou nu pornește.");
    else if (c.cls === "first_start") what.push("Poarta n-a fost deschisă de la prima pornire a Hub-ului.");
    else what.push("Poarta e suspendată; cine a oprit-o nu a fost înregistrat (o oprire dinaintea acestei versiuni).");
    const stays = [];
    const since = c.since || c.at || null;
    const cancelled = since ? count("SELECT COUNT(*) AS n FROM factory_missions WHERE stage = 'CANCELLED' AND updated_at >= ?", since) : 0;
    if (cancelled) stays.push(`${plural(cancelled, "Misiunea anulată", "misiuni anulate")} la oprire ${cancelled === 1 ? "rămâne anulată" : "rămân anulate"}.`);
    // Missions need the gate open to continue; SM-01: a mission of an open plan refused at the gate (BLOCKED „gate”) is resumed by the
    // same „Continuă” after the rearm, like a paused one. D22: the operation plans and the desktop session the stop ITSELF paused
    // (owner/stop-scope.mjs) wait for that „Continuă” too; anything paused for another reason keeps its own resume.
    const pausedMissions = count("SELECT COUNT(*) AS n FROM factory_missions WHERE stage = 'PAUSED'");
    const gateBlocked = count(`SELECT COUNT(*) AS n FROM factory_missions fm WHERE fm.stage = 'BLOCKED' AND fm.wait_reason = 'gate' AND EXISTS (SELECT 1 FROM mission_envelopes e, json_each(e.mission_ids_json) j
      WHERE e.status IN ('CONFIRMED','ACTIVE','WAITING_OWNER') AND j.value = fm.mission_id)`);
    let held = { ops: new Set(), desktop: false };
    try { held = stopScope().stoppedSet(); } catch { /* read-only facts: an unreadable scope lists nothing as held */ }
    let otherPlans = 0;
    try { otherPlans = db.prepare("SELECT id FROM ops_plans WHERE status = 'PAUSED'").all().filter((p) => !held.ops.has(p.id)).length; } catch { otherPlans = 0; }
    const parts = [pausedMissions ? plural(pausedMissions, "o misiune pe pauză", "misiuni pe pauză") : null, gateBlocked ? plural(gateBlocked, "o misiune oprită la poartă", "misiuni oprite la poartă") : null,
      held.ops.size ? plural(held.ops.size, "un plan de operare", "planuri de operare") : null, held.desktop ? "sesiunea desktop" : null].filter(Boolean);
    stays.push(parts.length ? `Ce e oprit (${parts.join(", ")}) rămâne oprit până spui „Continuă” după redeschidere.`
      : "Nimic oprit nu repornește singur: ce e pe pauză reiei cu „Continuă” după redeschidere.");
    if (otherPlans) stays.push(`${otherPlans === 1 ? "Un plan de operare pus pe pauză din alt motiv decât această oprire îl reiei" : `${otherPlans} planuri de operare puse pe pauză din alt motiv decât această oprire le reiei`} cu „Continuă” și înainte de redeschidere (nu depind de poartă).`);
    stays.push("Cererile vechi nu sunt repropuse singure; un plan nou cere tot confirmarea lui.");
    stays.push(settings.get("mode") === "BUILD_SAFE" ? "Hub-ul rămâne în BUILD_SAFE; Lega nu pornește singură." : "Hub-ul revine în BUILD_SAFE (modul ales de mână se închide); Lega nu pornește singură.");
    return { stoppedAt: c.at || null, via, what, stays };
  }

  /**
   * The rearm decision's facts. `sessionTagValue` (cardFor / apply) distinguishes the owner's own pause (refused: „Continuă” reopens
   * it) from a pause of another authenticator of the owner (rearmable here, with the fresh verification).
   */
  function evaluate({ forSession = false, sessionTagValue = null, write = false } = {}) {
    const g = settings.get("executionGate") || {};
    const c = classifySuspension(g);
    const key = suspensionKey(g);
    const base = { cls: c.cls, kind: c.kind, key, since: c.since, at: c.at, channel: c.channel, deviceId: c.deviceId };
    if (c.cls === "open") return { ...base, eligible: false, code: "OPEN", reason: "Poarta e deschisă; nu e nimic de redeschis.", security: null, facts: null };
    const facts = factsOf(c);
    const security = securityScan(c, key);
    const no = (code, reason) => ({ ...base, eligible: false, code, reason, security, facts });
    const ownPause = c.cls === "owner_pause" && (!forSession || !sessionTagValue || sessionTagValue === c.credential);
    const OWN_PAUSE_REASON = "Ai pus Hub-ul pe pauză din sesiunea ta: spune sau scrie „Continuă” și îl reiau în aceleași limite.";
    // The owner's own pause is reopened by „Continuă”; only in the owner's own session can a card release what it leaves reserved.
    if (ownPause && !(forSession && sessionTagValue && sessionTagValue === c.credential)) return no("OWNER_PAUSE", OWN_PAUSE_REASON);
    // P0-R1: the reconciler first (a provably free lease is released now); a lease of a run that still looks live is never touched.
    const lv = leaseView({ write });
    if (lv.failed && lv.held.length) return no("LEASES", `Nu am putut verifica rezervările spațiilor de lucru (${lv.held[0].reason}); până nu le pot verifica nu redeschid poarta. Cere cardul din nou peste câteva secunde.`);
    if (lv.held.length) return no("LEASES", heldReason(lv.held));
    const leases = leasesOf(lv.steps);
    if (ownPause && !leases) return no("OWNER_PAUSE", OWN_PAUSE_REASON);
    // AS-01: a start still being admitted (backup, git state) counts until its admission ends — it is refused before its model.
    const active = hub.runs?.activeRuns?.() || [];
    const admitting = Number(hub.runs?.admittingCount?.() || 0);
    const stopping = active.length + admitting;
    if (stopping) {
      return no("RUNS_ACTIVE", `Încă se ${stopping === 1 ? "oprește o execuție" : `opresc ${stopping} execuții`}${admitting ? ` (${admitting === 1 ? "una e încă în admitere și nu ajunge" : `${admitting} sunt încă în admitere și nu ajung`} la model)` : ""}; după ce oprirea e confirmată, ${REOPEN_BY_OWNER}.`);
    }
    const cancelling = (hub.factory?.list?.() || []).filter((f) => f.stage === "CANCEL_REQUESTED");
    if (cancelling.length) return no("CANCEL_PENDING", `${cancelling.length === 1 ? `Misiunea „${cancelling[0].title}” încă se oprește` : `${cancelling.length} misiuni încă se opresc`} (anulare cerută, neconfirmată); după ce oprirea e confirmată, ${REOPEN_BY_OWNER}.`);
    if (hub.lega?.active?.()) return no("LEGA_ACTIVE", "Sesiunea vocală Lega e încă deschisă: închide-o, apoi redeschizi poarta aici, în cockpit, pe cardul „Redeschide poarta”, cu Windows Hello — nu prin voce; nu se redeschide singură.");
    const included = leases ? ` Cardul include ${leases.total === 1 ? "eliberarea spațiului de lucru rămas rezervat" : `eliberarea celor ${leases.total} spații de lucru rămase rezervate`}${leases.terminate ? " (întâi opresc procesul rămas pornit de Hub)" : ""}${leases.ackRequired ? `, cu confirmarea ta („${LEASES_ACK_LABEL}”)` : ""}.` : "";
    // P0-R1: under the owner's own pause the card only releases what stays reserved; „Continuă” then reopens the pause, as always (the
    // security acknowledgement belongs to a reopening, so this card neither lists nor binds the events).
    if (ownPause) {
      return { ...base, eligible: true, code: "OWNER_PAUSE", scope: "leases", security: null, facts, leases,
        reason: `Hub-ul e pe pauza ta, dar ${leases.total === 1 ? "un spațiu de lucru e încă rezervat" : `${leases.total} spații de lucru sunt încă rezervate`} după o oprire neconfirmată: îl eliberezi aici, cu Windows Hello, apoi spui „Continuă”.` };
    }
    return { ...base, eligible: true, code: security ? "SECURITY" : "ELIGIBLE",
      reason: (security ? "Poarta se poate redeschide aici, cu Windows Hello, după ce confirmi că ai văzut evenimentele de securitate de pe card." : "Poarta se poate redeschide aici, cu Windows Hello.") + included,
      security, facts, leases };
  }

  /** Read-only, session-independent (the cockpit, the readiness facts, the blocker explainer). */
  function eligibility() {
    const ev = evaluate();
    return { eligible: ev.eligible, cls: ev.cls, code: ev.code, reason: ev.reason, key: ev.key, since: ev.since, at: ev.at, channel: ev.channel, security: ev.security, facts: ev.facts,
      leases: ev.leases ? { total: ev.leases.total, terminate: ev.leases.terminate, ackRequired: ev.leases.ackRequired } : null };
  }

  /**
   * The hash a card is bound to: the exact suspension (key, class, times), the security events it listed and (P0-R1) the exact lease
   * steps it included and the scope — a card without leases keeps the hash it always had.
   */
  const cardHash = (ev) => hashCanonical({ v: 1, key: ev.key, cls: ev.cls, since: ev.since || null, at: ev.at || null, security: ev.security?.hash || null,
    ...(ev.leases ? { leases: ev.leases.hash } : {}), ...(ev.scope ? { scope: ev.scope } : {}) });

  function prune(nowMs = clock().getTime()) {
    for (const [nonce, c] of cards) if (c.expiresAtMs <= nowMs) cards.delete(nonce);
    while (cards.size >= MAX_LIVE_CARDS) cards.delete(cards.keys().next().value);
  }

  /** A live preserved request this card may re-propose (never a closed one). */
  function checkRequest(requestId) {
    if (!requestId) return null;
    const r = hub.workRequests?.get ? hub.workRequests.get(requestId) : null;
    if (!r) throw new HubError("not_found", "Cererea păstrată nu există");
    if (!["OPEN", "BLOCKED", "PLANNED", "CONFIRMED"].includes(r.status)) throw new HubError("conflict", `Cererea nu mai e activă (${r.status})`);
    return r.id;
  }

  /**
   * The rearm card for this owner session, or { eligible: false, code, reason, cls }. The gate and the work stay as they are; the only
   * write is the reconciler's sweep (P0-R1: a lease whose run is finished and whose process is provably gone is released first).
   */
  function cardFor({ ownerSession = null, requestId = null } = {}) {
    const s = trust.requireSession(ownerSession, "redeschiderea porții");
    const ev = evaluate({ forSession: true, sessionTagValue: sessionTag(s), write: true });
    if (!ev.eligible) return { eligible: false, code: ev.code, reason: ev.reason, cls: ev.cls };
    const rid = checkRequest(requestId);
    const nowMs = clock().getTime();
    prune(nowMs);
    // One live card per (session, suspension): a newer card replaces the older one (its nonce stops working).
    for (const [nonce, c] of cards) if (c.sessionId === s.id && c.key === ev.key) cards.delete(nonce);
    const nonce = crypto.randomBytes(16).toString("hex");
    const hash = cardHash(ev);
    const expiresAtMs = nowMs + REARM_TTL_MS;
    cards.set(nonce, { sessionId: s.id, key: ev.key, hash, requestId: rid, cls: ev.cls, scope: ev.scope || null, expiresAtMs });
    const at = when(ev.at);
    const via = ev.facts?.via || null;
    const leases = ev.leases ? { steps: ev.leases.steps.map((st) => ({ ...st })), total: ev.leases.total, terminate: ev.leases.terminate, ackRequired: ev.leases.ackRequired, ackLabel: ev.leases.ackLabel } : null;
    if (ev.scope === "leases") {
      // P0-R1: the owner's own pause — the card releases only what stays reserved; „Continuă” reopens the pause afterwards.
      const n = ev.leases.total;
      return { kind: "gate_rearm", eligible: true, code: ev.code, scope: "leases", nonce, hash, cls: ev.cls,
        headline: `Hub-ul e pe pauza ta, dar ${n === 1 ? "un spațiu de lucru a rămas rezervat" : `${n} spații de lucru au rămas rezervate`} după o oprire neconfirmată. ${n === 1 ? "Îl eliberez" : "Le eliberez"} aici, cu Windows Hello; apoi spui „Continuă”.`,
        lines: [...(ev.facts?.what || [])], stays: ["Poarta rămâne pe pauza ta: o redeschizi cu „Continuă”, în aceleași limite.", "Nimic oprit nu repornește singur."],
        security: null, leases, requiresFreshAuth: true, fresh: Boolean(s.fresh), requestId: rid, stoppedAt: ev.at || null, via, expiresAt: new Date(expiresAtMs).toISOString() };
    }
    const headline = `Poarta de execuție e ${STATE_PHRASE[ev.cls] || STATE_PHRASE.legacy_unknown}${at ? ` (${at}${via ? `, ${via}` : ""})` : ""}. O redeschid aici, cu Windows Hello?`;
    const lines = [...(ev.facts?.what || [])];
    if (ev.security) lines.push(ev.security.events.length ? "În jurul opririi au avut loc evenimente de securitate (lista de mai jos): confirmă că le-ai văzut înainte de redeschidere." : "Oprirea a fost una de securitate: confirmă că ai verificat cauza înainte de redeschidere.");
    if (leases) lines.push(leases.ackRequired ? `Un spațiu de lucru a rămas rezervat după o oprire neconfirmată: pasul de mai jos e inclus în redeschidere și cere confirmarea ta („${LEASES_ACK_LABEL}”).`
      : `Un spațiu de lucru a rămas rezervat după o oprire neconfirmată: pasul de mai jos e inclus în redeschidere.`);
    return { kind: "gate_rearm", eligible: true, code: ev.code, nonce, hash, cls: ev.cls, headline, lines, stays: [...(ev.facts?.stays || [])],
      security: ev.security ? { events: ev.security.events, total: ev.security.total, truncated: ev.security.truncated, order: ev.security.order, ackRequired: true } : null,
      ...(leases ? { leases } : {}), requiresFreshAuth: true, fresh: Boolean(s.fresh), requestId: rid, stoppedAt: ev.at || null, via, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  /**
   * The rearm. Order matters: the fresh verification FIRST (an authentication error with data.reauth leaves the card usable, so the
   * UI's withReauth retries the same body), then the modality, the card (nonce: single use, this session, unexpired; hash), the
   * eligibility NOW, the compare-and-set key, the security acknowledgement, and ONE transaction. The re-proposal of the card's request
   * runs after the commit and never undoes the rearm (its failure is reported, not thrown).
   * P0-R1: with lease steps on the card, the lease acknowledgement (when one is unknown) is checked with the others; then — the nonce
   * spent, one rearm at a time — each included step runs (terminateOrphan), EVERYTHING is evaluated again, and only then the same
   * compare-and-set transaction reopens the gate. A step that fails leaves the gate closed. A card without lease steps takes exactly
   * the synchronous path it always took.
   */
  async function apply({ ownerSession = null, nonce = "", hash = "", requestId = null, ackSecurity = false, ackLeases = false, modality = "click" } = {}) {
    const s = trust.requireFresh(ownerSession, "redeschiderea porții");
    if (!REARM_MODALITIES.includes(modality)) throw new HubError("policy", "Redeschiderea porții se confirmă doar cu un click, Enter sau tastat, în sesiunea ta — niciodată prin voce.");
    if (applying) throw new HubError("conflict", "O redeschidere e deja în curs (din alt card sau altă filă); aștept rezultatul ei, apoi verifici din nou.", { data: { code: "REARM_BUSY" } });
    const nowMs = clock().getTime();
    const card = cards.get(String(nonce || ""));
    if (!card || card.expiresAtMs <= nowMs) { if (card) cards.delete(String(nonce)); throw new HubError("conflict", "Cardul de redeschidere nu mai e valabil (folosit, expirat sau înlocuit); îl cer din nou.", { data: { code: "CARD_STALE" } }); }
    if (card.sessionId !== s.id) throw new HubError("policy", "Cardul de redeschidere a fost emis pentru altă sesiune de proprietar.", { data: { code: "CARD_SESSION" } });
    if (String(hash || "") !== card.hash) throw new HubError("conflict", "Confirmarea nu corespunde cardului afișat; reîncarcă-l.", { data: { code: "CARD_HASH" } });
    if (requestId && card.requestId && requestId !== card.requestId) throw new HubError("conflict", "Cardul a fost afișat pentru altă cerere.", { data: { code: "CARD_REQUEST" } });
    if (requestId && !card.requestId) throw new HubError("conflict", "Cardul nu a fost afișat pentru o cerere; îl cer din nou.", { data: { code: "CARD_REQUEST" } });
    const ev = evaluate({ forSession: true, sessionTagValue: sessionTag(s), write: true });
    // A changed state can never make this card valid again: it is dropped (the owner gets a new card that says what changed).
    if (!ev.eligible) { cards.delete(String(nonce)); throw new HubError("conflict", ev.reason, { data: { code: ev.code } }); }
    if (ev.key !== card.key) { cards.delete(String(nonce)); throw new HubError("conflict", "Între timp poarta a fost oprită din nou; îți arăt cardul nou înainte să o redeschid.", { data: { code: "SUSPENSION_CHANGED" } }); }
    if (cardHash(ev) !== card.hash) { cards.delete(String(nonce)); throw new HubError("conflict", "De la afișarea cardului s-a schimbat ceva (de exemplu un eveniment de securitate nou sau un spațiu de lucru eliberat ori rămas rezervat); îl cer din nou.", { data: { code: "CARD_CHANGED" } }); }
    if (ev.security && ackSecurity !== true) throw new HubError("validation", "Confirmă întâi că ai văzut evenimentele de securitate de pe card.", { data: { code: "SECURITY_ACK", securityAckRequired: true } });
    if (ev.leases?.ackRequired && ackLeases !== true) {
      throw new HubError("validation", `Confirmă întâi „${LEASES_ACK_LABEL}”: nu pot dovedi că execuția de pe card s-a oprit, așa că eliberez spațiul ei de lucru doar cu confirmarea ta.`,
        { data: { code: "LEASES_ACK", leasesAckRequired: true } });
    }
    cards.delete(String(nonce));
    if (!ev.leases) return commit(card, ev, s, modality, null);
    applying = runLeaseSteps(card, ev, s, { ackLeases: ackLeases === true, modality });
    try { return await applying; } finally { applying = null; }
  }

  /**
   * P0-R1: the steps the owner's card included, in order (an orphaned Hub process stopped, then its lease released; an unknown one
   * released with the acknowledgement), then everything again — the suspension, the security events, what is still running or reserved
   * — before the same compare-and-set reopening. Under the owner's own pause (scope "leases") nothing reopens: „Continuă” does that.
   */
  async function runLeaseSteps(card, ev, s, { ackLeases, modality }) {
    const done = [];
    for (const step of ev.leases.steps) {
      // Review R1-F1: the acknowledgement covers only the steps that asked for it (an "unknown" outcome), never a step that promised to
      // stop a Hub-tied process — that one is released only after its stop, or the rearm stops with a new card. An ackLeases the card
      // did not ask for (ackRequired false) therefore changes nothing.
      try { done.push(await reconciler().terminateOrphan(step.leaseId, { ownerSession: s, ack: ackLeases === true && step.ack === true, expected: { verdict: step.verdict, tie: step.tie || null } })); }
      catch (error) {
        const code = error?.details?.code || error?.data?.code || null;
        // The lease's state moved since the card (e.g. its start evidence can no longer be read): a new card says what is true now.
        if (code === "LEASE_STATE_CHANGED" || code === "LEASE_HELD") {
          throw new HubError("conflict", `${error.message} Îți arăt cardul nou înainte de orice altceva.`, { data: { code: "CARD_CHANGED", leaseId: step.leaseId } });
        }
        throw error;
      }
    }
    const released = done.filter((d) => d?.released);
    const after = evaluate({ forSession: true, sessionTagValue: sessionTag(s), write: true });
    if (ev.scope === "leases") {
      if (after.code === "LEASES" || after.leases) throw new HubError("conflict", after.leases ? "Între timp a rămas rezervat alt spațiu de lucru; îți arăt cardul nou." : after.reason, { data: { code: after.leases ? "CARD_CHANGED" : "LEASES" } });
      const n = released.length;
      return { reopened: false, scope: "leases", cls: ev.cls, leases: done,
        summary: `${done.some((d) => d?.terminated) ? "Am oprit procesul rămas și " : "Am "}eliberat ${n === 1 ? "spațiul de lucru rezervat" : `cele ${n} spații de lucru rezervate`}. Poarta rămâne pe pauza ta: spune „Continuă” și reiau în aceleași limite.` };
    }
    if (after.cls === "open") throw new HubError("conflict", "Poarta e deja deschisă; nu am schimbat nimic altceva.", { data: { code: "OPEN" } });
    if (after.key !== card.key) throw new HubError("conflict", "Între timp poarta a fost oprită din nou; îți arăt cardul nou înainte să o redeschid.", { data: { code: "SUSPENSION_CHANGED" } });
    if (!after.eligible) throw new HubError("conflict", after.reason, { data: { code: after.code } });
    if ((after.security?.hash || null) !== (ev.security?.hash || null)) throw new HubError("conflict", "Între timp a apărut un eveniment de securitate nou; îl cer din nou înainte să redeschid poarta.", { data: { code: "CARD_CHANGED" } });
    if (after.leases) throw new HubError("conflict", "Între timp a rămas rezervat un spațiu de lucru; îți arăt cardul nou înainte să redeschid poarta.", { data: { code: "CARD_CHANGED" } });
    return commit(card, after, s, modality, done);
  }

  /** The reopening itself: ONE compare-and-set transaction on the card's suspension, then the card's request re-proposed. */
  async function commit(card, ev, s, modality, leaseSteps) {
    const actor = `owner:${s.id}`;
    const at = iso();
    const label = SUSPENSION_LABELS[ev.cls] || SUSPENSION_LABELS.legacy_unknown;
    const value = { status: "open", reason: `Redeschisă de tine după ${label}`, changedAt: at, changedBy: actor,
      reopenedAfter: { cls: ev.cls, key: ev.key, via: "rearm", sessionId: s.id, at, security: ev.security?.hash || null } };
    const committed = bus.transaction(() => {
      // Compare-and-set: anything written since these checks is never overwritten (every step since the last evaluation is synchronous).
      const current = settings.get("executionGate") || {};
      if (current.status !== "suspended" || suspensionKey(current) !== card.key) return null;
      settings.set("executionGate", value, actor, `Gate rearmed by the owner after ${ev.cls}`);
      const modeReset = settings.get("mode") !== "BUILD_SAFE";
      if (modeReset) {
        settings.set("mode", "BUILD_SAFE", actor, "Redeschiderea porții readuce Hub-ul în BUILD_SAFE");
        // The mode is the owner's from here: no plan's hold may switch it back later (the same rule as mode.set).
        if ((settings.get("envelopeModeHold") || {}).envelopeId) settings.set("envelopeModeHold", {}, actor, "Mode reset by the gate rearm");
      }
      bus.append({ type: "gate.rearmed", scopeType: "system", scopeId: "gate", source: actor,
        payload: { cls: ev.cls, key: ev.key, sessionId: s.id, requestId: card.requestId, modeReset, security: ev.security?.hash || null, modality,
          ...(leaseSteps ? { leases: leaseSteps.map((d) => ({ leaseId: d?.leaseId || null, terminated: Boolean(d?.terminated), acknowledged: Boolean(d?.acknowledged) })) } : {}) } });
      return { modeReset };
    });
    if (!committed) throw new HubError("conflict", "Starea porții s-a schimbat între timp; nu o redeschid.", { data: { code: "SUSPENSION_CHANGED" } });
    let reproposed = null;
    if (card.requestId) {
      try {
        if (!hub.workRequests?.reproposeOne) throw new Error("cererile păstrate nu sunt disponibile");
        reproposed = await hub.workRequests.reproposeOne(card.requestId);
      } catch (error) { reproposed = { requestId: card.requestId, planned: null, error: String(error?.message || error).slice(0, 300) }; }
    }
    const freed = (leaseSteps || []).filter((d) => d?.released).length;
    const leasePart = freed ? `${(leaseSteps || []).some((d) => d?.terminated) ? "Am oprit procesul rămas și am" : "Am"} eliberat ${freed === 1 ? "spațiul de lucru rezervat" : `cele ${freed} spații de lucru rezervate`}. ` : "";
    const summary = `${leasePart}Am redeschis poarta după ${label}${committed.modeReset ? "; Hub-ul e din nou în BUILD_SAFE" : ""}. Nimic vechi nu repornește singur: ce e pe pauză reiei cu „Continuă”.`
      + (reproposed?.planned ? " Cererea ta are acum un plan pe care îl confirmi separat." : reproposed?.error ? ` Cererea ta rămâne păstrată (${reproposed.error}).` : "");
    return { reopened: true, cls: ev.cls, gate: value, modeReset: committed.modeReset, reproposed, summary, ...(leaseSteps ? { leases: leaseSteps } : {}) };
  }

  return { eligibility, cardFor, apply, liveCards: () => cards.size, applying: () => Boolean(applying) };
}
