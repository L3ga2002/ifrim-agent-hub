// M08 UI logic (pure; tested in node without a browser): tabs, routes, labels, tones and the phone's freshness rule.

export const INTEL_TABS = [
  ["today", "Azi"], ["twin", "Digital Twin"], ["warroom", "War Room"], ["autopilot", "Autopilot"], ["board", "Ședința"],
  ["simulation", "Simulare"], ["league", "Liga agenților"], ["skills", "Skilluri"], ["lessons", "Lecții"], ["decisions", "Decizii"], ["devices", "Telefon"],
];
const TAB_IDS = new Set(INTEL_TABS.map(([id]) => id));
/** `#/intel/<tab>?id=…` → { tab, id }. An unknown tab falls back to "Azi". */
export function intelRoute(tabId, query = {}) {
  return { tab: TAB_IDS.has(tabId) ? tabId : "today", id: typeof query?.id === "string" && query.id ? query.id : null };
}
export const intelHref = (tab, id = null) => `/intel/${tab}${id ? `?id=${encodeURIComponent(id)}` : ""}`;

export const INCIDENT_RO = { PROPOSED: "propus", TRIAGE: "triaj", REPRODUCING: "reproducere", REMEDIATION: "remediere", MONITORING: "monitorizare", RESOLVED: "rezolvat", DISMISSED: "respins" };
export const INCIDENT_TONE = { PROPOSED: "neutral", TRIAGE: "warn", REPRODUCING: "warn", REMEDIATION: "info", MONITORING: "info", RESOLVED: "ok", DISMISSED: "neutral" };
/** The same transition table as the server (warroom.mjs); the server re-checks every move. */
export const INCIDENT_NEXT = {
  PROPOSED: ["TRIAGE", "DISMISSED"], TRIAGE: ["REPRODUCING", "REMEDIATION", "MONITORING", "DISMISSED"], REPRODUCING: ["REMEDIATION", "TRIAGE", "DISMISSED"],
  REMEDIATION: ["MONITORING", "TRIAGE"], MONITORING: ["RESOLVED", "TRIAGE"], RESOLVED: ["TRIAGE"], DISMISSED: ["TRIAGE"],
};
export const ENTRY_RO = { signal: "semnal", hypothesis: "ipoteză", action: "acțiune", evidence: "dovadă", note: "notă", timeline: "cronologie" };
export const ENTRY_STATUS_TONE = { CONFIRMED: "ok", UNCONFIRMED: "warn", REFUTED: "error" };

export const OBJECTIVE_RO = { DRAFT: "ciornă", PREPARED: "pregătit", PROPOSED: "plan propus", RUNNING: "rulează", WAITING_OWNER: "așteaptă decizia ta", DELIVERED: "livrat (de verificat)", STOPPED: "oprit", SUPERSEDED: "înlocuit" };
export const OBJECTIVE_TONE = { DRAFT: "neutral", PREPARED: "info", PROPOSED: "approval", RUNNING: "info", WAITING_OWNER: "warn", DELIVERED: "ok", STOPPED: "neutral", SUPERSEDED: "neutral" };

export const LESSON_RO = { PROPOSED: "propusă", ACTIVE: "activă", REFUSED: "refuzată", SUPERSEDED: "înlocuită", FORGET_PROPOSED: "dezactivare propusă", FORGOTTEN: "dezactivată", DISMISSED: "renunțat" };
export const LESSON_TONE = { PROPOSED: "approval", ACTIVE: "ok", REFUSED: "error", SUPERSEDED: "neutral", FORGET_PROPOSED: "warn", FORGOTTEN: "neutral", DISMISSED: "neutral" };
export const SCOPE_RO = { GLOBAL: "toate proiectele", PROJECT: "un proiect", MISSION: "o misiune", NONE: "—" };

export const CANDIDATE_RO = { PROPOSED: "propus", EVALUATED: "evaluat", APPROVED: "aprobat", ACTIVE_LIMITED: "activ limitat", ACTIVE: "activ", ROLLED_BACK: "revenit", REJECTED: "respins" };
export const CANDIDATE_TONE = { PROPOSED: "neutral", EVALUATED: "info", APPROVED: "approval", ACTIVE_LIMITED: "info", ACTIVE: "ok", ROLLED_BACK: "warn", REJECTED: "neutral" };

export const OPTION_STATE_RO = { UNDECIDED: "nedecisă", APPROVED: "aprobată", APPROVED_PENDING_EXECUTION: "aprobată · de executat", EXECUTED: "executată (verificat)", REJECTED: "respinsă", DEFERRED: "amânată" };
export const OPTION_STATE_TONE = { UNDECIDED: "approval", APPROVED: "info", APPROVED_PENDING_EXECUTION: "warn", EXECUTED: "ok", REJECTED: "neutral", DEFERRED: "neutral" };

export const BOARD_ITEM_TONE = { PRESENTED: "neutral", PROPOSED: "approval", DECIDED: "ok", DEFERRED: "warn", REJECTED: "neutral", NOTED: "info" };
export const BOARD_ITEM_RO = { PRESENTED: "informativ", PROPOSED: "de decis", DECIDED: "decis", DEFERRED: "amânat", REJECTED: "respins", NOTED: "notat" };

/** Evidence label of a league row: never a "winner" on fewer than the minimum observations. */
export function evidenceLabel(row, minEvidence = 5) {
  if (!row) return { tone: "neutral", text: "—" };
  return row.evidence === "SUFFICIENT" ? { tone: "info", text: `${row.observations} observații` } : { tone: "neutral", text: `date insuficiente (${row.observations}/${minEvidence})` };
}

export const fmtHours = (h) => (h === null || h === undefined ? "—" : `${Math.round(h * 10) / 10} h`);
export const fmtWeeks = (w) => (w === null || w === undefined ? "—" : `${Math.round(w * 10) / 10} săpt.`);
export const fmtMoney = (v) => (v === null || v === undefined ? "—" : `${Math.round(v).toLocaleString("ro-RO")} lei`);

/** A simulation input field: a number, or "min-max" → { min, max }; empty → undefined; anything else → null (invalid). */
export function parseSimInput(text) {
  const s = String(text ?? "").trim().replace(",", ".");
  if (!s) return undefined;
  const range = s.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/);
  if (range) { const [min, max] = [Number(range[1]), Number(range[2])]; return min <= max ? { min, max } : null; }
  return /^\d+(?:\.\d+)?$/.test(s) ? Number(s) : null;
}

/**
 * The phone's view of freshness (M08 §18): a view is "stale" when the last successful read is older than `staleMs` or the
 * server clock in it is older than that (a frozen server); a command is built only on a fresh view (the server re-checks it).
 */
export function mobileFreshness({ fetchedAt, serverTime, now = Date.now(), staleMs = 30000, failed = false }) {
  if (!fetchedAt) return { state: "unknown", label: "Încă nu am citit starea", canAct: false };
  const age = now - fetchedAt;
  const serverAge = serverTime ? now - new Date(serverTime).getTime() : Infinity;
  if (failed && age > staleMs) return { state: "offline", label: `Fără legătură de ${Math.round(age / 1000)} s — starea afișată e veche`, canAct: false };
  if (age > staleMs || serverAge > staleMs + 5000) return { state: "stale", label: `Stare veche (${Math.round(Math.max(age, serverAge) / 1000)} s)`, canAct: false };
  return { state: "fresh", label: `Actualizat acum ${Math.max(0, Math.round(age / 1000))} s`, canAct: true };
}

/** One idempotency key per tap (a retry of the same tap reuses it; a new tap gets a new one). */
export function newIdempotencyKey(prefix = "m") {
  const rnd = typeof crypto !== "undefined" && crypto.getRandomValues ? Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("") : Math.random().toString(16).slice(2, 18);
  return `${prefix}-${Date.now().toString(36)}-${rnd}`;
}

/** The kind of M08 result an intent returned (what card the cockpit shows), or null. */
export function intelResultKind(r) {
  if (!r) return null;
  for (const k of ["incident", "changes", "impact", "why", "blocked", "board", "simulation", "league", "lesson", "forget", "today", "decisions", "objectives"]) if (r[k]) return k;
  return null;
}
