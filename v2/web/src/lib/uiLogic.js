// Pure UI helpers (no DOM, no React) — covered by v2/tests/m02-ui-logic.test.mjs.

/* ---------------- attachments ---------------- */
export const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024; // matches the server route limit
export const ATTACHMENT_TYPES = Object.freeze({ "text/plain": ".txt", "text/markdown": ".md", "application/json": ".json", "text/csv": ".csv",
  "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "application/pdf": ".pdf" });
const EXT_OK = /\.(txt|md|json|csv|png|jpe?g|webp|pdf|log)$/i;
const SECRET_NAME = /^(?:\.env(?!\.example$).*|.*\.(?:pem|key|pfx|p12|kdbx)|id_(?:rsa|ed25519|ecdsa)(?:\.pub)?|\.npmrc|credentials(?:\.json)?|auth\.json)$/i;

/** Client-side check before upload; the server validates again. Attaching never sends anything to a provider. */
export function validateAttachment({ name = "", size = 0, type = "" } = {}) {
  if (!name) return { ok: false, reason: "Fișier fără nume" };
  if (SECRET_NAME.test(name)) return { ok: false, reason: "Fișierele de tip secret (.env, chei, credențiale) nu se atașează" };
  if (!size) return { ok: false, reason: "Fișier gol" };
  if (size > ATTACHMENT_MAX_BYTES) return { ok: false, reason: `Mai mare de ${ATTACHMENT_MAX_BYTES / 1048576} MB` };
  if (!(type in ATTACHMENT_TYPES) && !EXT_OK.test(name)) return { ok: false, reason: "Tip neacceptat (text, JSON, CSV, imagini PNG/JPG/WebP, PDF)" };
  return { ok: true };
}

/* ---------------- errors ---------------- */
const STAGES = {
  policy: "Politică", gate: "Poartă", backup: "Backup", authentication: "Autentificare", auth: "Autentificare", quota: "Cotă",
  transport: "Transport", tool: "Unealtă", task: "Task", billing: "Facturare", validation: "Validare", timeout: "Timp depășit", internal: "Intern",
};
/** Human stage for an error category, so the UI says WHERE a run stopped (policy, backup, auth, quota, transport, tool, task). */
export function errorStage(category, { preInference = false } = {}) {
  const stage = STAGES[category] || (category ? String(category) : "Necunoscut");
  return preInference ? `${stage} · înainte de model` : stage;
}

/* ---------------- Focus layout ---------------- */
export const DEFAULT_LAYOUT = Object.freeze({ left: 260, right: 420, bottom: 220, showLeft: true, showRight: true, showBottom: false });
const LIMITS = { left: [200, 420], right: [300, 760], bottom: [140, 520] };
const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));

/**
 * Keeps a stored layout valid for the current viewport: sizes are clamped and panes collapse so the conversation
 * never gets narrower than 360 px (no permanent horizontal overflow on a laptop).
 */
export function fitLayout(stored, { width = 1440, height = 900 } = {}) {
  const l = { ...DEFAULT_LAYOUT, ...(stored || {}) };
  l.left = clamp(l.left, LIMITS.left); l.right = clamp(l.right, LIMITS.right); l.bottom = clamp(l.bottom, [LIMITS.bottom[0], Math.min(LIMITS.bottom[1], Math.max(160, height - 320))]);
  const minThread = 360;
  const compact = width < 1024;
  let showLeft = l.showLeft && !compact; let showRight = l.showRight;
  if (showLeft && width - l.left - (showRight ? l.right : 0) < minThread) showLeft = false;
  if (showRight && width - (showLeft ? l.left : 0) - l.right < minThread) {
    const room = width - (showLeft ? l.left : 0) - minThread;
    if (room >= LIMITS.right[0]) l.right = room; else showRight = compact ? l.showRight : false;
  }
  return { ...l, showLeft, showRight, overlayRight: compact && showRight, compact };
}

/* ---------------- mission progress ---------------- */
/** Counts, never an estimate: "X/Y taskuri" plus blocked/approval counts; percent only when a denominator exists. */
export function missionProgress(tasks = []) {
  const live = tasks.filter((t) => t.status !== "CANCELLED");
  const done = live.filter((t) => t.status === "COMPLETED").length;
  return { completed: done, total: live.length, blocked: live.filter((t) => ["BLOCKED", "FAILED"].includes(t.status)).length,
    waitingApproval: live.filter((t) => t.status === "WAITING_APPROVAL").length, verifying: live.filter((t) => t.status === "VERIFYING").length,
    percent: live.length ? Math.round((done / live.length) * 100) : null, method: "taskuri finalizate / taskuri neanulate" };
}

/* ---------------- ecosystem catalog ---------------- */
/**
 * Separate, explicit facts per capability: documented publicly, eligible on the plan, authenticated locally,
 * implemented in the Hub, verified live, verified simulated. Each keeps its own source/date.
 */
export function classifyCapability(record, { verifications = [], surface = null } = {}) {
  const status = record.status || "";
  const facts = {
    documented: Boolean(record.officialSource || record.technicalDoc || status),
    eligible: ["AVAILABLE", "NEEDS_SETUP", "ASSISTED_ONLY"].includes(status) ? "da" : status === "PLAN_RESTRICTED" ? "nu" : status === "ELIGIBILITY_UNKNOWN" ? "necunoscut" : status === "ROLLOUT_PENDING" ? "rollout" : "—",
    authenticated: surface?.availability === "available" ? "da" : surface ? "nu" : "—",
    implemented: ["WRAP", "MIRROR_STATE", "REIMPLEMENT"].includes(record.hubDecision) && surface?.programmaticControl !== "NONE" ? "da" : record.hubDecision === "ASSISTED" || status === "ASSISTED_ONLY" ? "asistat" : "nu",
    verifiedLive: verifications.some((v) => v.result === "PASS_LIVE"),
    verifiedSimulated: verifications.some((v) => ["PASS_SIMULATED", "PASS_LOCAL"].includes(v.result)),
  };
  const cost = record.apiBillingRisk === "high" ? "risc de cost" : record.apiBillingRisk === "low" ? "poate depăși planul" : record.apiBillingRisk === "none" ? "inclus" : "necunoscut";
  // "Usable now" = available on the account + implemented in the Hub + the surface is authenticated locally.
  const bucket = status === "BLOCKED" || record.apiBillingRisk === "high" ? "blocked"
    : status === "AVAILABLE" && facts.implemented === "da" && facts.authenticated !== "nu" ? "usable"
      : status === "AVAILABLE" && facts.implemented === "da" ? "setup"
      : status === "ASSISTED_ONLY" || facts.implemented === "asistat" ? "assisted"
        : ["NEEDS_SETUP", "ELIGIBILITY_UNKNOWN", "ROLLOUT_PENDING", "DOCUMENTED"].includes(status) ? "setup" : "other";
  return { facts, cost, bucket };
}

/* ---------------- local voice commands ---------------- */
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.,!?;:"„”]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Deterministic, local navigation commands (no model, no side effects). Side-effecting commands (Stop, Pause)
 * go to the Hub, which also decides them deterministically; approvals can never be granted by voice.
 */
export function parseLocalCommand(transcript, { projects = [] } = {}) {
  const t = norm(transcript);
  if (!t) return null;
  if (/^(opreste|stop)( tot| totul)?$/.test(t)) return { kind: "hub", command: "stop" };
  if (/^(pauza|pune pauza)$/.test(t)) return { kind: "hub", command: "pause" };
  if (/^(taci|liniste|opreste vorbirea|mut)$/.test(t)) return { kind: "local", command: "mute" };
  if (/(deschide|arata)( mi)? aprobarile/.test(t)) return { kind: "navigate", command: "approvals", path: "/approvals" };
  if (/(intra|treci|deschide)( in)? focus/.test(t)) return { kind: "navigate", command: "focus", path: "/conversations" };
  if (/(deschide|arata)( mi)? (camera de control|control room|controlul)/.test(t)) return { kind: "navigate", command: "control", path: "/control" };
  if (/(deschide|arata)( mi)? misiunile/.test(t)) return { kind: "navigate", command: "missions", path: "/missions" };
  const project = t.match(/^deschide proiectul (.+)$/);
  if (project) {
    const wanted = norm(project[1]);
    const hit = projects.find((p) => norm(p.name) === wanted || norm(p.slug) === wanted) || projects.find((p) => norm(p.name).includes(wanted));
    return hit ? { kind: "navigate", command: "project", path: `/projects/${hit.id}` } : { kind: "unknown", reason: `Nu găsesc proiectul „${project[1]}”` };
  }
  if (/^(aproba|aprob|confirma|deploy|sterge|trimite)/.test(t)) return { kind: "refused", reason: "Vocea nu aprobă, nu șterge, nu trimite și nu face deploy; confirmă vizual acțiunea exactă" };
  return null;
}

/* ---------------- live stream bookkeeping ---------------- */
/** Applies persisted events in order: drops duplicates and events at or below the last seen sequence. */
export function acceptEvent(state, event) {
  if (!event || typeof event.seq !== "number") return { accept: false, state };
  if (event.seq <= state.lastSeq || state.seen.has(event.seq)) return { accept: false, state };
  const seen = new Set(state.seen); seen.add(event.seq);
  if (seen.size > 5000) seen.delete(seen.values().next().value);
  return { accept: true, state: { lastSeq: event.seq, seen, lastEventAt: event.createdAt || state.lastEventAt } };
}
