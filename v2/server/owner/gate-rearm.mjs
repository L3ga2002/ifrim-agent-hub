import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";
import { hashCanonical } from "../core/canonical.mjs";
import { parse } from "../storage/db.mjs";
import { classifySuspension, suspensionKey, credentialTag, SECURITY_EVENT_TYPES, SECURITY_EVENT_LABELS, SECURITY_LOOKBACK_MS, SUSPENSION_LABELS, CHANNEL_LABELS } from "../policy/gate-state.mjs";
import { createStopScope } from "./stop-scope.mjs";

/**
 * M10.2.1 contextual gate rearm (owner decisions D14–D16). Before it, the only way to reopen the execution gate after Stop All was the
 * typed OPEN GATE in Integrări → Avansat (the per-boot UI token, no owner session, no authenticator) — and the owner-facing texts
 * pointed there or to „Sistem”, where no gate control exists. Here the rearm is ONE decision in the cockpit:
 *
 *  - eligibility() reads the recorded suspension (policy/gate-state.mjs) and the state that must be quiet first: no retained lease,
 *    no run still stopping or still being admitted, no mission still in CANCEL_REQUESTED, no Lega session. The owner's own pause is
 *    not rearmed here („Continuă” reopens it, LC-10 / IN-04);
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
      what.push("Poarta de execuție a fost suspendată și toate autorizările active au fost revocate.");
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
  function evaluate({ forSession = false, sessionTagValue = null } = {}) {
    const g = settings.get("executionGate") || {};
    const c = classifySuspension(g);
    const key = suspensionKey(g);
    const base = { cls: c.cls, kind: c.kind, key, since: c.since, at: c.at, channel: c.channel, deviceId: c.deviceId };
    if (c.cls === "open") return { ...base, eligible: false, code: "OPEN", reason: "Poarta e deschisă; nu e nimic de redeschis.", security: null, facts: null };
    const facts = factsOf(c);
    const security = securityScan(c, key);
    const no = (code, reason) => ({ ...base, eligible: false, code, reason, security, facts });
    if (c.cls === "owner_pause" && (!forSession || !sessionTagValue || sessionTagValue === c.credential)) {
      return no("OWNER_PAUSE", "Ai pus Hub-ul pe pauză din sesiunea ta: spune sau scrie „Continuă” și îl reiau în aceleași limite.");
    }
    const retained = count("SELECT COUNT(*) AS n FROM leases WHERE status = 'retained'");
    if (retained) return no("LEASES", `${retained === 1 ? "Un spațiu de lucru e încă rezervat" : `${retained} spații de lucru sunt încă rezervate`} după o oprire neconfirmată (lease-uri reținute); până nu sunt eliberate nu redeschid poarta.`);
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
    return { ...base, eligible: true, code: security ? "SECURITY" : "ELIGIBLE",
      reason: security ? "Poarta se poate redeschide aici, cu Windows Hello, după ce confirmi că ai văzut evenimentele de securitate de pe card." : "Poarta se poate redeschide aici, cu Windows Hello.",
      security, facts };
  }

  /** Read-only, session-independent (the cockpit, the readiness facts, the blocker explainer). */
  function eligibility() {
    const ev = evaluate();
    return { eligible: ev.eligible, cls: ev.cls, code: ev.code, reason: ev.reason, key: ev.key, since: ev.since, at: ev.at, channel: ev.channel, security: ev.security, facts: ev.facts };
  }

  /** The hash a card is bound to: the exact suspension (key, class, times) and the security events it listed. */
  const cardHash = (ev) => hashCanonical({ v: 1, key: ev.key, cls: ev.cls, since: ev.since || null, at: ev.at || null, security: ev.security?.hash || null });

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

  /** The rearm card for this owner session, or { eligible: false, code, reason, cls }. Nothing changes. */
  function cardFor({ ownerSession = null, requestId = null } = {}) {
    const s = trust.requireSession(ownerSession, "redeschiderea porții");
    const ev = evaluate({ forSession: true, sessionTagValue: sessionTag(s) });
    if (!ev.eligible) return { eligible: false, code: ev.code, reason: ev.reason, cls: ev.cls };
    const rid = checkRequest(requestId);
    const nowMs = clock().getTime();
    prune(nowMs);
    // One live card per (session, suspension): a newer card replaces the older one (its nonce stops working).
    for (const [nonce, c] of cards) if (c.sessionId === s.id && c.key === ev.key) cards.delete(nonce);
    const nonce = crypto.randomBytes(16).toString("hex");
    const hash = cardHash(ev);
    const expiresAtMs = nowMs + REARM_TTL_MS;
    cards.set(nonce, { sessionId: s.id, key: ev.key, hash, requestId: rid, cls: ev.cls, expiresAtMs });
    const at = when(ev.at);
    const via = ev.facts?.via || null;
    const headline = `Poarta de execuție e ${STATE_PHRASE[ev.cls] || STATE_PHRASE.legacy_unknown}${at ? ` (${at}${via ? `, ${via}` : ""})` : ""}. O redeschid aici, cu Windows Hello?`;
    const lines = [...(ev.facts?.what || [])];
    if (ev.security) lines.push(ev.security.events.length ? "În jurul opririi au avut loc evenimente de securitate (lista de mai jos): confirmă că le-ai văzut înainte de redeschidere." : "Oprirea a fost una de securitate: confirmă că ai verificat cauza înainte de redeschidere.");
    return { kind: "gate_rearm", eligible: true, code: ev.code, nonce, hash, cls: ev.cls, headline, lines, stays: [...(ev.facts?.stays || [])],
      security: ev.security ? { events: ev.security.events, total: ev.security.total, truncated: ev.security.truncated, order: ev.security.order, ackRequired: true } : null,
      requiresFreshAuth: true, fresh: Boolean(s.fresh), requestId: rid, stoppedAt: ev.at || null, via, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  /**
   * The rearm. Order matters: the fresh verification FIRST (an authentication error with data.reauth leaves the card usable, so the
   * UI's withReauth retries the same body), then the modality, the card (nonce: single use, this session, unexpired; hash), the
   * eligibility NOW, the compare-and-set key, the security acknowledgement, and ONE transaction. The re-proposal of the card's request
   * runs after the commit and never undoes the rearm (its failure is reported, not thrown).
   */
  async function apply({ ownerSession = null, nonce = "", hash = "", requestId = null, ackSecurity = false, modality = "click" } = {}) {
    const s = trust.requireFresh(ownerSession, "redeschiderea porții");
    if (!REARM_MODALITIES.includes(modality)) throw new HubError("policy", "Redeschiderea porții se confirmă doar cu un click, Enter sau tastat, în sesiunea ta — niciodată prin voce.");
    const nowMs = clock().getTime();
    const card = cards.get(String(nonce || ""));
    if (!card || card.expiresAtMs <= nowMs) { if (card) cards.delete(String(nonce)); throw new HubError("conflict", "Cardul de redeschidere nu mai e valabil (folosit, expirat sau înlocuit); îl cer din nou.", { data: { code: "CARD_STALE" } }); }
    if (card.sessionId !== s.id) throw new HubError("policy", "Cardul de redeschidere a fost emis pentru altă sesiune de proprietar.", { data: { code: "CARD_SESSION" } });
    if (String(hash || "") !== card.hash) throw new HubError("conflict", "Confirmarea nu corespunde cardului afișat; reîncarcă-l.", { data: { code: "CARD_HASH" } });
    if (requestId && card.requestId && requestId !== card.requestId) throw new HubError("conflict", "Cardul a fost afișat pentru altă cerere.", { data: { code: "CARD_REQUEST" } });
    if (requestId && !card.requestId) throw new HubError("conflict", "Cardul nu a fost afișat pentru o cerere; îl cer din nou.", { data: { code: "CARD_REQUEST" } });
    const ev = evaluate({ forSession: true, sessionTagValue: sessionTag(s) });
    // A changed state can never make this card valid again: it is dropped (the owner gets a new card that says what changed).
    if (!ev.eligible) { cards.delete(String(nonce)); throw new HubError("conflict", ev.reason, { data: { code: ev.code } }); }
    if (ev.key !== card.key) { cards.delete(String(nonce)); throw new HubError("conflict", "Între timp poarta a fost oprită din nou; îți arăt cardul nou înainte să o redeschid.", { data: { code: "SUSPENSION_CHANGED" } }); }
    if (cardHash(ev) !== card.hash) { cards.delete(String(nonce)); throw new HubError("conflict", "De la afișarea cardului s-a schimbat ceva (de exemplu un eveniment de securitate nou); îl cer din nou.", { data: { code: "CARD_CHANGED" } }); }
    if (ev.security && ackSecurity !== true) throw new HubError("validation", "Confirmă întâi că ai văzut evenimentele de securitate de pe card.", { data: { code: "SECURITY_ACK", securityAckRequired: true } });
    cards.delete(String(nonce));
    const actor = `owner:${s.id}`;
    const at = iso();
    const label = SUSPENSION_LABELS[ev.cls] || SUSPENSION_LABELS.legacy_unknown;
    const value = { status: "open", reason: `Redeschisă de tine după ${label}`, changedAt: at, changedBy: actor,
      reopenedAfter: { cls: ev.cls, key: ev.key, via: "rearm", sessionId: s.id, at, security: ev.security?.hash || null } };
    const committed = bus.transaction(() => {
      // Compare-and-set: anything written since these checks (in this process every step above is synchronous) is never overwritten.
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
        payload: { cls: ev.cls, key: ev.key, sessionId: s.id, requestId: card.requestId, modeReset, security: ev.security?.hash || null, modality } });
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
    const summary = `Am redeschis poarta după ${label}${committed.modeReset ? "; Hub-ul e din nou în BUILD_SAFE" : ""}. Nimic vechi nu repornește singur: ce e pe pauză reiei cu „Continuă”.`
      + (reproposed?.planned ? " Cererea ta are acum un plan pe care îl confirmi separat." : reproposed?.error ? ` Cererea ta rămâne păstrată (${reproposed.error}).` : "");
    return { reopened: true, cls: ev.cls, gate: value, modeReset: committed.modeReset, reproposed, summary };
  }

  return { eligibility, cardFor, apply, liveCards: () => cards.size };
}
