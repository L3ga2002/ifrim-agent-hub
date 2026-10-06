// Pure UI helpers (no DOM, no React) — covered by v2/tests/m02-ui-logic.test.mjs.

/* ---------------- attachments ---------------- */
/**
 * Decoded file size the Hub stores (server/domain/conversations.mjs ATTACHMENT_MAX_BYTES). The 15 MB on the upload route
 * is the base64 JSON body, not the file: a 10-15 MB file passed here and was refused by the server after the full upload.
 * M02-UI-13 reads both server values so this cannot drift again.
 */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_TYPES = Object.freeze({ "text/plain": ".txt", "text/markdown": ".md", "application/json": ".json", "text/csv": ".csv",
  "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "application/pdf": ".pdf" });
/** Extension → the MIME the Hub accepts; browsers often report "" (.md on Windows) or a foreign type (.csv as application/vnd.ms-excel). */
const MIME_BY_EXT = Object.freeze({ txt: "text/plain", log: "text/plain", md: "text/markdown", json: "application/json", csv: "text/csv",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", pdf: "application/pdf" });
const SECRET_NAME = /^(?:\.env(?!\.example$).*|.*\.(?:pem|key|pfx|p12|kdbx)|id_(?:rsa|ed25519|ecdsa)(?:\.pub)?|\.npmrc|credentials(?:\.json)?|auth\.json)$/i;
/** Longest file name the Hub accepts (conversation.attachment schema, filename max); M02-UI-13 reads the server value. */
export const ATTACHMENT_NAME_MAX = 200;
/** Megabytes rounded UP to one decimal (Romanian comma), so a file 1 byte over the limit never reads as "10 MB". */
const mb = (bytes) => `${String(Math.ceil((bytes / 1048576) * 10) / 10).replace(".", ",")} MB`;

/**
 * The MIME to send for a file, or null when the Hub would refuse it. A declared type the Hub accepts wins; otherwise the
 * extension decides, so a .csv reported as application/vnd.ms-excel is not accepted here and then refused by the server.
 */
export function attachmentMime({ name = "", type = "" } = {}) {
  if (typeof type === "string" && Object.hasOwn(ATTACHMENT_TYPES, type)) return type; // own keys only: "toString" is not a MIME
  const ext = String(name).match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return (ext && MIME_BY_EXT[ext]) || null;
}

/** Client-side check before upload; the server validates again. Attaching never sends anything to a provider. */
export function validateAttachment({ name = "", size = 0, type = "" } = {}) {
  if (!name) return { ok: false, reason: "Fișier fără nume" };
  if (String(name).trim().length > ATTACHMENT_NAME_MAX) return { ok: false, reason: `Numele fișierului depășește ${ATTACHMENT_NAME_MAX} de caractere` };
  if (SECRET_NAME.test(name)) return { ok: false, reason: "Fișierele de tip secret (.env, chei, credențiale) nu se atașează" };
  if (!size) return { ok: false, reason: "Fișier gol" };
  if (size > ATTACHMENT_MAX_BYTES) return { ok: false, reason: `Fișierul are ${mb(size)}; limita Hub-ului este ${mb(ATTACHMENT_MAX_BYTES)} pe fișier` };
  const mime = attachmentMime({ name, type });
  if (!mime) return { ok: false, reason: "Tip neacceptat (text, JSON, CSV, imagini PNG/JPG/WebP, PDF)" };
  return { ok: true, mime };
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
/**
 * High-water mark of a stream whose start is unknown (no /api/state yet): nothing is accepted, the stream asks for
 * nothing (`?after=` this value), learns the server's lastSeq from `hello` and reopens from there, instead of
 * replaying the whole history as new notifications.
 */
export const STREAM_UNKNOWN_SEQ = Number.MAX_SAFE_INTEGER;

/**
 * Pure gate step for one persisted event. The Hub's log is totally ordered by `seq`, so a single high-water mark is the
 * dedup: anything at or below it (a replay overlapping what already arrived, a late or out-of-order copy) is dropped.
 * No separate seen-set: it would outlive a log reset and silently drop the new log's reused numbers.
 * An event without a numeric seq or a string type is dropped too (listeners read `event.type`).
 */
export function acceptEvent(state, event) {
  if (!event || typeof event !== "object" || !Number.isSafeInteger(event.seq) || event.seq < 1 || typeof event.type !== "string") return { accept: false, state };
  if (!Number.isSafeInteger(state.lastSeq) || event.seq <= state.lastSeq) return { accept: false, state };
  return { accept: true, state: { ...state, lastSeq: event.seq, lastEventAt: event.createdAt || state.lastEventAt || null } };
}

/**
 * Pure handshake step (`hello` = the server's { lastSeq, bootId } at connect time). The log only grows, so a server mark
 * below ours means a reset or different database (or an unknown start): the mark drops to the server's and the caller
 * must reopen the stream from there (`resync`), otherwise every new event up to the old mark would be dropped as stale.
 * A new bootId over the same log keeps the mark (`restarted`): `?after` replays exactly what was missed meanwhile.
 */
export function acceptHello(state, hello) {
  const serverSeq = hello && Number.isSafeInteger(hello.lastSeq) && hello.lastSeq >= 0 ? hello.lastSeq : null;
  const bootId = hello && typeof hello.bootId === "string" && hello.bootId ? hello.bootId : null;
  const restarted = Boolean(state.bootId && bootId && bootId !== state.bootId);
  const next = { ...state, bootId: bootId || state.bootId || null };
  if (serverSeq !== null && serverSeq < state.lastSeq) return { valid: true, resync: true, restarted, state: { ...next, lastSeq: serverSeq } };
  return { valid: serverSeq !== null, resync: false, restarted, state: next };
}

/**
 * The one gate between the SSE connection and the app (used by openStream in api.js; M02-UI-09/10 test it and that
 * client). `after` is the last sequence already reflected in the UI; anything else (null, NaN, negative) is an unknown start.
 */
/** Where the live stream starts: the snapshot's last event, or unknown (null) so the server's hello decides. Never 0. */
export const streamStartSeq = (hub) => (Number.isSafeInteger(hub?.lastSeq) && hub.lastSeq >= 0 ? hub.lastSeq : null);

/**
 * A command-scoped approval (a run or mission Lega proposed, a browser check…) runs the exact stored command; npm scripts
 * (process.run) keep their own "Rulează" button. For these, approving is the order to run: one click decides and starts.
 */
export const isCommandApproval = (approval) => approval?.scopeType === "command" && !["process.run", "browser.inspect"].includes(approval?.actionKind);
/** Local tools approved on the Approvals screen and started there with their own button (npm script, browser check). */
export const LOCAL_TOOL_APPROVALS = Object.freeze(["process.run", "browser.inspect"]);
/** Anything the owner approves that the Hub then starts: a stored command, or a local tool run. */
export const isExecutableApproval = (approval) => isCommandApproval(approval) || LOCAL_TOOL_APPROVALS.includes(approval?.actionKind);
/** Approved, not consumed and not expired: approved but never started (the owner must see these, not lose them). */
export const approvedNotStarted = (approvals = [], now = new Date()) => approvals.filter((a) => a?.status === "approved" && isExecutableApproval(a) && new Date(a.expiresAt) > now);

export function createEventGate({ after = null } = {}) {
  let state = { lastSeq: Number.isSafeInteger(after) && after >= 0 ? after : STREAM_UNKNOWN_SEQ, bootId: null, lastEventAt: null };
  return {
    get lastSeq() { return state.lastSeq; },
    get known() { return state.lastSeq !== STREAM_UNKNOWN_SEQ; },
    get bootId() { return state.bootId; },
    get lastEventAt() { return state.lastEventAt; },
    /** True when the event is new and in order; the mark advances. */
    accept(event) { const r = acceptEvent(state, event); state = r.state; return r.accept; },
    /** Applies `hello`; `resync` = close this connection and reopen from `after`. */
    hello(info) { const r = acceptHello(state, info); state = r.state; return { valid: r.valid, resync: r.resync, restarted: r.restarted, after: state.lastSeq }; },
  };
}

/* ---------------- keyboard ---------------- */
/**
 * The key of a global app shortcut (Alt+1..9, Alt+M, Alt+L, Alt+J), or null when the chord belongs to what is being typed.
 * AltGr is not Alt: on Windows it arrives as ctrlKey+altKey and on the Romanian layout AltGr+key types characters, so
 * honouring it switched screens mid-sentence. Alt+numpad digits are Windows Alt codes (Alt+0226 = â); IME composition
 * belongs to the input method; auto-repeat must not flip a toggle back and forth. Only plain ASCII letters/digits qualify.
 */
export function appShortcutKey(e) {
  if (!e || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (e.isComposing || e.keyCode === 229 || e.repeat || e.defaultPrevented) return null;
  if (typeof e.getModifierState === "function" && e.getModifierState("AltGraph")) return null;
  if (e.location === 3 || String(e.code || "").startsWith("Numpad")) return null;
  const key = typeof e.key === "string" ? e.key : "";
  return /^[a-z0-9]$/i.test(key) ? key.toLowerCase() : null;
}
/** True when `e` is exactly the plain Alt+`key` app shortcut (see appShortcutKey). */
export const isAppShortcut = (e, key) => appShortcutKey(e) === String(key).toLowerCase();

/* ---------------- composer: model and effort ---------------- */
/** Effort values run.start accepts (server/runtime/command-catalog.mjs); anything else is refused there, so it is never offered. */
export const RUN_EFFORTS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);
/** Offered when nothing verified exists; labelled as unverified in the UI. */
const FALLBACK_EFFORTS = Object.freeze(["low", "medium", "high", "xhigh"]);
/**
 * Claude Code aliases the Hub may pass to --model. Not verified by the Hub: the Claude probe reads only `auth status` and the
 * `--help` flags, and what an alias resolves to depends on the installed CLI build. fable/best/[1m] are refused by the adapter.
 */
export const CLAUDE_MODEL_ALIASES = Object.freeze(["sonnet", "opus", "haiku"]);

/**
 * Model and effort choices for the composer, each with its source, so a guess is never shown as verified.
 * Codex: models and per-model efforts from the probe's model/list ("verified"), limited to what run.start accepts.
 * Claude: static aliases ("unverified"); effort only when the installed CLI's --help lists --effort ("unsupported" otherwise),
 * with unverified levels. `effort` comes back as the value that may be sent: a stored choice the options lack becomes "".
 */
/** M09: the Claude model a run sends — always an explicit alias (the Hub refuses a Claude run without one); sonnet unless chosen. */
export const DEFAULT_CLAUDE_MODEL = "sonnet";
export const claudeRunModel = (model) => (CLAUDE_MODEL_ALIASES.includes(model) ? model : DEFAULT_CLAUDE_MODEL);

/**
 * The body of POST /api/conversations/:id/runs from the composer's choices. Claude always carries an explicit model (never empty);
 * Codex sends a model only when one was chosen (empty = the account default, pinned by the Hub when the run starts).
 */
export function runRequestBody({ provider, access, model = "", effort = "", taskId = null } = {}) {
  const m = provider === "claude" ? claudeRunModel(model) : String(model || "");
  return { provider, access, ...(m ? { model: m } : {}), ...(effort ? { effort } : {}), ...(taskId ? { taskId } : {}) };
}

/** The body of POST /api/missions/:id/shadow: a shadow review names its model too (Claude: an explicit alias, never empty). */
export function shadowReviewBody({ provider = "claude", model = "" } = {}) {
  const m = provider === "claude" ? claudeRunModel(model) : String(model || "");
  return { provider, ...(m ? { model: m } : {}) };
}

export function composerOptions({ provider, providerState = null, model = "", effort = "" } = {}) {
  let models; let modelSource; let modelNote; let efforts; let effortSource; let effortNote; let defaultEffort = null;
  let sendModel = String(model || ""); let modelRequired = false;
  if (provider === "claude") {
    const flags = providerState?.installation?.flags;
    const effortFlag = Array.isArray(flags) ? flags.includes("--effort") : null;
    models = CLAUDE_MODEL_ALIASES.map((id) => ({ id, label: `${id} (alias CLI, nevalidat)` }));
    modelSource = "unverified";
    modelRequired = true;
    sendModel = claudeRunModel(model);
    modelNote = "Aliasuri Claude Code fixe, nevalidate de Hub: verificarea Claude citește doar autentificarea și flag-urile CLI; modelul real depinde de versiunea instalată. Claude rulează doar cu un model explicit (implicit sonnet), niciodată cu modelul implicit al contului";
    efforts = effortFlag === false ? [] : [...FALLBACK_EFFORTS];
    effortSource = effortFlag === false ? "unsupported" : "unverified";
    effortNote = effortFlag === false ? "CLI-ul Claude instalat nu listează --effort; efortul nu se trimite"
      : effortFlag ? "CLI-ul Claude listează --effort; nivelurile nu sunt validate de Hub" : "Instalarea Claude nu a fost verificată; nivelurile de efort nu sunt validate de Hub";
  } else {
    const listed = Array.isArray(providerState?.models) ? providerState.models.filter((m) => m && typeof m.id === "string" && m.id) : null;
    const current = listed ? listed.find((m) => m.id === model) || (!model ? listed.find((m) => m.isDefault) : null) : null;
    const reported = Array.isArray(current?.efforts) ? current.efforts : [];
    const accepted = reported.filter((x) => RUN_EFFORTS.includes(x));
    models = listed ? listed.map((m) => ({ id: m.id, label: m.displayName || m.id })) : null;
    modelSource = listed ? "verified" : "unread";
    modelNote = listed ? "Modele citite din Codex (model/list) la ultima verificare a providerului" : "Lista de modele Codex nu a fost citită încă; rulează verificarea providerului";
    // Reported but none accepted by run.start (e.g. only "minimal"): offer nothing rather than a level the model lacks.
    efforts = reported.length ? accepted : [...FALLBACK_EFFORTS];
    effortSource = reported.length ? (accepted.length ? "verified" : "unsupported") : "unverified";
    effortNote = effortSource === "verified" ? "Niveluri de efort raportate de Codex pentru modelul ales"
      : effortSource === "unsupported" ? "Modelul ales nu raportează niveluri de efort acceptate de Hub; efortul nu se trimite"
        : "Niveluri de efort nevalidate de Hub (Codex nu le-a raportat pentru acest model)";
    defaultEffort = accepted.includes(current?.defaultEffort) ? current.defaultEffort : null;
  }
  // `model` is the value that may be sent: for Claude always an alias (never ""); `modelRequired` hides the "implicit" choice.
  return { models, modelSource, modelNote, efforts, effortSource, effortNote, defaultEffort, effort: efforts.includes(effort) ? effort : "", model: sendModel, modelRequired };
}

/* ---------------- Software Factory (M03) ---------------- */
/** Owner-facing stage names (Romanian) and the order of the main path. */
export const FACTORY_STAGE_RO = Object.freeze({
  SPEC_DRAFT: "Specificație", BASELINE: "Baseline", IMPLEMENTING: "Implementare", CHECKING: "Verificări", REVIEWING: "Review", REPAIRING: "Remediere",
  QA: "QA", PREVIEW: "Preview", DELIVERY_READY: "Gata de acceptare", ACCEPTED: "Acceptat local", REJECTED: "Respins", PAUSED: "Pauză", BLOCKED: "Blocat",
  NEEDS_OWNER_DECISION: "Decizia ta", CANCEL_REQUESTED: "Oprire cerută", CANCELLED: "Oprit",
});
export const FACTORY_PATH = Object.freeze(["SPEC_DRAFT", "BASELINE", "IMPLEMENTING", "CHECKING", "REVIEWING", "QA", "PREVIEW", "DELIVERY_READY", "ACCEPTED"]);

/**
 * What the mission waits for, in words that never say "AI lucrează" when it waits for the owner, a grant, the gate,
 * the runner or a cancel confirmation. `waitReason` comes from the factory view.
 */
export function factoryWaitLabel(waitReason, stage) {
  switch (waitReason) {
    case "approval": return "Așteaptă aprobarea ta (comandă sau modificare cerută de model)";
    case "grant": return "Așteaptă un grant (fără grant nu pornește niciun model)";
    case "gate": return "Așteaptă poarta de execuție (mod, poartă, izolare sau facturare)";
    case "provider": return "Modelul lucrează (urmărește cronologia execuției)";
    case "runner": return stage === "BLOCKED" ? "Runner-ul sau browserul nu au putut rula (fără model); remediază cauza, apoi Reia" : "Runner-ul Hub rulează verificările (fără model)";
    case "owner_decision": return stage === "SPEC_DRAFT" ? "Completează și aprobă specificația" : "Așteaptă decizia ta";
    case "cancel": return "Oprire cerută; aștept confirmarea că nimic nu mai rulează";
    default: return stage === "ACCEPTED" ? "Acceptat local; commit/push/deploy rămân acțiuni separate" : "—";
  }
}

/** Index of each stage on the main path (side states map to where the mission stopped). */
export function factoryProgress(view) {
  const stage = view?.factory?.stage;
  const at = FACTORY_PATH.indexOf(stage);
  if (at >= 0) return { current: at, side: null };
  const reached = Math.max(0, ...((view?.dispatches || []).map((d) => FACTORY_PATH.indexOf(d.stage === "REPAIRING" ? "IMPLEMENTING" : d.stage))),
    ...((view?.evidence || []).map((e) => FACTORY_PATH.indexOf(e.stage))));
  return { current: reached, side: stage || null };
}

/** "1 min 05 s" style durations for the run timeline (null → "—"). */
export function formatMs(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(s % 60).padStart(2, "0")} s`;
}

/**
 * Acceptance criteria typed one per line: "text | verify | test/path.mjs". verify: test, review, manual, e2e, preview
 * (default test when a path is given, otherwise review). Returns the spec array the API expects.
 */
/**
 * Keeps what the line editor cannot show (approved E2E steps, the expected baseline failure) on the criteria that keep their
 * id and verification kind, so saving a revision never drops them silently.
 */
export function mergeCriteria(parsed = [], previous = []) {
  const byId = new Map(previous.map((a) => [a.id, a]));
  return parsed.map((a) => {
    const prev = byId.get(a.id);
    if (!prev || prev.verify !== a.verify) return a;
    return { ...a, ...(prev.steps ? { steps: prev.steps } : {}), ...(prev.expectFailure ? { expectFailure: prev.expectFailure } : {}) };
  });
}

export function parseCriteriaLines(text = "") {
  const kinds = new Set(["test", "review", "manual", "e2e", "preview"]);
  return String(text).split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 20).map((line, i) => {
    const [body, second = "", third = ""] = line.split("|").map((s) => s.trim());
    const verify = kinds.has(second) ? second : third ? "test" : second && /[/.]/.test(second) ? "test" : second ? "review" : "review";
    const testRef = kinds.has(second) ? third : second && /[/.]/.test(second) ? second : "";
    return { id: `AC-${i + 1}`, text: body, verify, ...(testRef ? { testRef } : {}) };
  });
}

// ---------------------------------------------------------------- M10: Lega's one-click start
/** Plain hints for the checks that can still block a one-click start (the authority checks are the Hub's own business now). */
export const LEGA_CHECK_HINTS = Object.freeze({
  // M10.2 (D13): after the owner's own pause „Continuă” reopens the gate. M10.2.1 (D14): every other suspension (Stop All, a palette
  // pause, the Hub's shutdown…) is reopened by the rearm card — the owner session + a fresh Windows Hello — never an admin pointer.
  execution_gate: "Poarta e suspendată. După pauza ta spune sau scrie „Continuă”; altfel o redeschizi cu Windows Hello, din cardul „Redeschide poarta” (aici sau în cockpit). Nimic vechi nu repornește singur.",
  lega_consent: "Înregistrează acordul de mai sus (o singură dată).",
  billing_route: "Integrări → Codex: declarația de abonament, în sesiunea ta.",
  realtime_config: "Integrări → Inspectează instalarea.",
  // M10.2: the real fix for a project's isolation is its route + the attested environment (System → Medii), not the Codex ACL panel.
  isolation: "Sistem → Medii: ruta proiectului și atestarea mediului izolat ifrim-runner (acordul Codex pentru Windows rămâne în Integrări → Izolare).",
  circuit_breaker: "Codex a eșuat de mai multe ori; reîncearcă după ora afișată.",
  single_session: "O sesiune Lega e deja pornită.",
  concurrency: "Prea multe execuții AI rulează acum; așteaptă să se termine una.",
  derived_rate: "Limita de porniri a fost atinsă; reîncearcă după timpul afișat.",
  // D23: the Hub checked the Codex account by itself as often as it may in this window; the owner's own check is the way until then.
  account_refresh_rate: "Hub-ul a verificat singur contul Codex de prea multe ori în acest interval; așteaptă timpul afișat sau rulează „Verifică contul” în Integrări → Codex.",
});
/**
 * Under the legacy policy (no voice-first) an owner without a registered authenticator has no rearm card: the typed gate opening in
 * Integrations stays the administrative way, so the legacy hint still names it. Never shown under voice-first (legaCheckHint).
 */
export const LEGA_CHECK_HINTS_LEGACY = Object.freeze({
  execution_gate: "Poarta e suspendată. După pauza ta spune sau scrie „Continuă”; altfel o redeschizi cu Windows Hello, din cardul „Redeschide poarta” (sesiunea ta de proprietar), sau — fără sesiune — din Integrări → Avansat (OPEN GATE, cale de administrare).",
});
/** The hint for one failing Lega start check, for the policy in force (voice-first unless the page knows otherwise). */
export function legaCheckHint(id, { voiceFirst = true } = {}) {
  const key = String(id || "");
  if (!voiceFirst && Object.hasOwn(LEGA_CHECK_HINTS_LEGACY, key)) return LEGA_CHECK_HINTS_LEGACY[key];
  return Object.hasOwn(LEGA_CHECK_HINTS, key) ? LEGA_CHECK_HINTS[key] : null;
}
const LEGA_AUTHORITY_CHECKS = new Set(["mode", "voice_grant"]);
/**
 * D23: the Codex account check („Verifică contul”) goes stale after 24 h. On the one-click path the Hub runs it by itself at start
 * (a few seconds, no inference), so the page never sends the owner to Integrări for it: a hint before the start, a line during it.
 */
export const LEGA_ACCOUNT_AUTO_HINT = "Hub-ul verifică singur contul Codex la pornire (câteva secunde, fără inferență); nu ai nimic de făcut în Integrări.";
export const LEGA_START_CHECKING = "Verific contul și pornesc…";
/**
 * What the start needs, from GET /api/lega. Under the voice-first policy, when the click will derive the authority (no owner
 * session yet, or the presented one must be reopened), mode / voice_grant are never blockers: they mean "open your session" and the
 * click does it (Windows Hello). Real blockers (the gate after Stop All, the consent, billing, the start limit…) are listed alone, so
 * the page never points to the old manual path for them. Under the legacy policy every failing check blocks.
 * D23: a failing check the Hub marked `auto` (it only lacks a fresh account check, which the derived start runs itself) is never a
 * blocker and never in `failed`: it is listed in `auto`, `accountCheck` says the start will check the account, and — because only a
 * DERIVED start does that — a click without an owner session opens the session first. The Hub marks `auto` only under voice-first.
 * Once the automatic check's limit is reached the Hub marks those checks `limited` instead and adds the `account_refresh_rate`
 * blocker: the `limited` ones are left out of `failed` (their own hints would point the wrong way), the rate check blocks and says when.
 */
export function legaStartReadiness(d) {
  const p = d?.preview || {};
  const unmet = (p.checks || []).filter((c) => !c.ok);
  const auto = unmet.filter((c) => c.auto === true);
  const limited = unmet.filter((c) => c.limited === true);
  const failed = unmet.filter((c) => c.auto !== true && c.limited !== true);
  const authFailed = failed.filter((c) => LEGA_AUTHORITY_CHECKS.has(c.id));
  const policyActive = Boolean(d?.owner?.policyActive ?? p.policyActive);
  const willDerive = policyActive && (!d?.owner?.session || Boolean(p.needSession));
  const blocking = willDerive ? failed.filter((c) => !LEGA_AUTHORITY_CHECKS.has(c.id)) : failed;
  const needsSession = willDerive && (authFailed.length > 0 || Boolean(p.needSession) || auto.length > 0);
  const authorityOnly = failed.length > 0 && authFailed.length === failed.length;
  const needsPolicy = !policyActive && authorityOnly;
  // M10.2.1: `gateSuspended` — the execution gate is a real blocker of this start; the panel shows the rearm card next to the hint.
  return { failed, blocking, authorityOnly, needsSession, needsPolicy, willDerive, sessionProblem: p.sessionProblem || null,
    ready: failed.length === 0, derived: p.authority === "owner_session", policyActive, gateSuspended: blocking.some((c) => c.id === "execution_gate"),
    auto, limited, accountCheck: auto.length > 0 && blocking.length === 0 && !needsPolicy };
}

// ---------------------------------------------------------------- M10.2 (U15): plan cards everywhere, old flow as "advanced"
/**
 * Gate checks a confirmed plan arranges by itself (kept in sync with server/owner/envelopes.mjs ENVELOPE_RESOLVES; a test compares
 * both). A refusal made ONLY of these is not something the owner has to fix by hand (mode, grant, lease, backup): it means "this
 * should be a plan". Isolation, billing, the gate after Stop All… are real blockers and are shown as they are.
 */
export const PLAN_RESOLVED_CHECKS = Object.freeze(["live_grant", "mode", "workspace_lease", "backup", "operational", "concurrency"]);
/** True when every failing check of a gate refusal / preview is one a plan resolves (and at least one check failed). */
export function planCoversRefusal(checks = []) {
  const failed = (Array.isArray(checks) ? checks : []).filter((c) => c && c.ok === false);
  return failed.length > 0 && failed.every((c) => PLAN_RESOLVED_CHECKS.includes(String(c.id || "").replace(/^(writer|reviewer):/, "")));
}

/**
 * The plan a `lega.plan` announcement names, whatever its shape: the intake's live event ({ kind, id, projectId, sessionId }), the
 * preserved-request re-plan ({ data: { planRef: { kind, id }, projectId, workRequestId } }) or the persisted bus event
 * ({ scopeType: "work_request", payload: { planRef, projectId } }). → { kind: "envelope"|"ops", id, projectId, sessionId } or null.
 * Ids are checked by prefix: the page only ever loads a plan through its own read route (the Hub re-checks everything on confirm).
 */
export function planRefOfLive(event) {
  if (!event || event.type !== "lega.plan") return null;
  const body = event.data || event.payload || {};
  const ref = event.id ? { kind: event.kind, id: event.id } : body.planRef || null;
  const id = String(ref?.id || "");
  const kind = ref?.kind === "ops" || /^opp_/.test(id) ? "ops" : ref?.kind === "envelope" || /^env_/.test(id) ? "envelope" : null;
  if (!kind || !/^[A-Za-z0-9_-]{4,80}$/.test(id)) return null;
  return { kind, id, projectId: event.projectId || body.projectId || null, sessionId: event.sessionId || null, workRequestId: body.workRequestId || null };
}

/** The address shows the cockpit (#/lega, #/lega/<project>; not the setup page). A plain start (#/ or empty) opens it too. */
export function isCockpitHash(hash = "") {
  const h = String(hash || "");
  if (h === "" || h === "#" || h === "#/") return true;
  return /^#\/lega(\/(?!setup(?:[/?]|$))[^/?]*)?(\?.*)?$/.test(h);
}

/**
 * What Lega's arrow (`lega.point` / `lega.prefill`) may do. While a plan is presented, or while the owner is in the cockpit, it never
 * navigates away (that unmounted the card and lost the armed voice confirmation, P11): the panel shows an inline hint with an
 * explicit „Deschide” instead. An element of the top bar (no path) is always just pointed at.
 */
export function legaPointAction({ path = null, presented = false, hash = "" } = {}) {
  if (!path) return "point";
  if (presented || isCockpitHash(hash)) return "hint";
  return "navigate";
}

/**
 * The address an arrow opens. Integrations has no sub-route per panel, so the isolation panel is named by `?panel=isolation`: the page
 * scrolls to it and the M10.2 probe (owner.nav) counts it as integrations.isolation, not as the live-validation panel.
 */
export function legaPointPath(target, path) {
  if (!path) return null;
  if (target === "isolation" && /^\/integrations\/?$/.test(String(path))) return "/integrations?panel=isolation";
  return String(path);
}

/** Lega's legacy proposals (approval cards); everything else in Approvals keeps its own screen. */
export const LEGA_APPROVAL_KINDS = Object.freeze(["lega.run_request", "lega.mission_request"]);
/** Where an "approval needed" toast leads: Lega's own proposals open the Lega panel (their card is there), the rest the Approvals list. */
export const approvalToastTarget = (event) => (LEGA_APPROVAL_KINDS.includes(event?.payload?.actionKind) || /^lega(:|$)/.test(String(event?.source || "")) ? "lega" : "approvals");

/**
 * Where a blocker option (owner/blockers.mjs) leads, as ONE next action. Options of a preserved request come back without their
 * `where` (only kind/code/label are stored), so the known places are mapped here by code; an unknown option is information only.
 * → { type: "link", href } | { type: "autonomy", level } | { type: "say", text } | { type: "rearm" } | { type: "auto" } | { type: "refused" } | { type: "info" }.
 * M10.2.1 (D14): a suspended gate is never a link to an administration page. The owner's own pause → „Continuă”; a rearmable
 * suspension → { type: "rearm" } (the cockpit's rearm card: owner session + a fresh Windows Hello); otherwise the Hub's honest reason
 * (a stop still being confirmed…) is information only.
 */
const BLOCKER_WHERE = Object.freeze({
  HOST_R2_OPEN: "#/system?tab=environments", ENV_UNAVAILABLE: "#/system?tab=environments", ENV_NOT_ATTESTED_CANARY: "#/system?tab=environments",
  ENV_ATTESTATION_EXPIRED: "#/system?tab=environments", ENV_FINGERPRINT_CHANGED: "#/system?tab=environments", ENV_NOT_ATTESTED: "#/system?tab=environments",
  ENV_ATTESTATION_FAILED: "#/system?tab=environments", ENV_BOUNDARY: "#/system?tab=environments", ENV_POLICY_B_NEEDED: "#/system?tab=environments",
  ENV_STAGES_OUTSIDE: "#/system?tab=environments", BILLING_DECLARATION: "#/integrations", ISOLATION_OTHER: "#/integrations?panel=isolation",
  // M10.2 (#27): a changed ffmpeg/ffprobe is acknowledged in the Studio's Unelte panel (Studio.jsx → ToolsPanel), named by ?panel=tools.
  PROJECT_SCOPE: "#/projects", MEDIA_TOOLS_CHANGED: "#/studio?panel=tools",
});
const SAFE_HREF = /^#\/[a-z][a-z0-9/_-]*(\?[a-z0-9=&_-]*)?$/i;
export function blockerAction(option = {}) {
  const kind = String(option.kind || ""); const code = String(option.code || "");
  if (kind === "refused") return { type: "refused" };
  if (kind === "automatic_readiness") return { type: "auto" };
  if (kind === "rearm") return code === "GATE_SUSPENDED" ? { type: "rearm" } : { type: "info" };
  if (kind === "owner_decision_inline") {
    if (code === "AUTONOMY_OBSERVE") return { type: "autonomy", level: "ASSISTED" };
    if (code === "GATE_SUSPENDED") return { type: "say", text: "Continuă" };
    if (code === "PROJECT_FROZEN") return { type: "say", text: "Dezgheață" };
    return { type: "info" };
  }
  // M10.2.1 (D14): the gate is reopened in the cockpit (rearm card) or by „Continuă”, never through an administration page — whatever
  // `where` an older server or a stored option still carries.
  if (code === "GATE_SUSPENDED") return { type: "info" };
  // The R2 risk acceptance is the admin escape hatch of HOST_R2_OPEN; the separate decision of the same code is the environment route.
  const given = option.where && SAFE_HREF.test(String(option.where)) ? String(option.where) : null;
  const r2Admin = kind === "admin" && code === "HOST_R2_OPEN" ? "#/integrations?panel=isolation" : null;
  const where = given || r2Admin || BLOCKER_WHERE[code] || null;
  return where ? { type: "link", href: where } : { type: "info" };
}

/** The Studio's Unelte panel (#/studio?panel=tools, Studio.jsx → ToolsPanel). */
export const STUDIO_TOOLS_HREF = "#/studio?panel=tools";
const MEDIA_TOOL_LABELS = Object.freeze({ PINNED: "fixat", UNPINNED: "nefixat", CHANGED: "schimbat", MISSING: "lipsă" });

/**
 * M10.2 (#27) — what the Studio → Unelte panel shows from GET /api/media/tools ({ tools, pins }), and the ONE action each state allows.
 * Pure (tested in node). The identity the owner SEES is the identity posted, so the Hub refuses a binary (or a DLL set) that changed
 * again in between instead of pinning / acknowledging something unseen:
 *  - UNPINNED (and nothing missing) → „Fixează”: POST /api/media/tools/pin with `expect` = the displayed identity of both tools
 *    (the pin is also allowed from the UI channel; nothing about it needs Windows Hello);
 *  - CHANGED → „Confirmă schimbarea”: POST /api/media/tools/:tool/acknowledge with the displayed sha256, shared-library hash ("none" for
 *    a static build) and version; owner-only, so a missing session opens Windows Hello once (withReauth);
 *  - MISSING → no action (ffmpeg is installed outside the Hub); PINNED → nothing to do.
 * → { rows: [{ tool, state, label, tone, version, sha256, libsSha256, path, pinnedAt, pinnedBy, previous, action }], pin, usable, missing }.
 */
export function mediaToolsPanel(data) {
  const tools = data?.tools || {};
  const pins = data?.pins || {};
  const rows = ["ffmpeg", "ffprobe"].map((tool) => {
    const info = tools[tool] || null;
    const state = tools.states?.[tool] || info?.state || "MISSING";
    const pin = pins[tool] || null;
    const shown = info?.sha256 ? { sha256: String(info.sha256), libsSha256: info.libsSha256 ? String(info.libsSha256) : null, version: info.version ? String(info.version) : null } : null;
    const action = state === "CHANGED" && shown
      ? { type: "acknowledge", label: "Confirmă schimbarea", owner: true, path: `/api/media/tools/${tool}/acknowledge`,
        body: { sha256: shown.sha256, libsSha256: shown.libsSha256 || "none", ...(shown.version ? { version: shown.version } : {}) } }
      : null;
    return { tool, state, label: MEDIA_TOOL_LABELS[state] || state, tone: state === "PINNED" ? "ok" : state === "MISSING" ? "danger" : "warn",
      version: shown?.version || null, sha256: shown?.sha256 || null, libsSha256: shown?.libsSha256 || null, path: info?.path || null,
      pinnedAt: pin?.pinnedAt || null, pinnedBy: pin?.pinnedBy || null, previous: pin?.previous || null, action };
  });
  const missing = rows.some((r) => r.state === "MISSING" || !r.sha256);
  const pin = !missing && rows.some((r) => r.state === "UNPINNED")
    ? { type: "pin", label: "Fixează", owner: false, path: "/api/media/tools/pin",
      body: { reason: "Studio → Unelte", expect: Object.fromEntries(rows.map((r) => [r.tool, { sha256: r.sha256, libsSha256: r.libsSha256, version: r.version }])) } }
    : null;
  return { rows, pin, usable: tools.usable === true, missing };
}

// ---------------------------------------------------------------- M10.2 review #37–#39, #41, #42: which card takes the focus
/**
 * What the cockpit does with a `lega.plan` (planRefOfLive). Only a plan THIS tab asked for — its own Lega voice session (ref.sessionId
 * equals the store's legaSessionId), a send() of this tab still in flight (the live event can arrive before the HTTP answer; a typed
 * request has sessionId null), or the owner's own click on „Arată planul” (`explicit`) — may take the focus or switch the project.
 * Anything else (another tab, a kept request that became plannable) is shown without focus here, or offered as „Deschide planul”:
 * a focused card turns the owner's next Enter into a confirmation of something they did not just ask for (#38). A plan of another
 * project never unmounts a plan on screen (presentedId: the plan this cockpit presents now): a toast instead (#39, like the shell).
 * 2.12.1 (UI-07): `reproposed` — the plan the Hub re-proposed for the request a rearm card was just confirmed for — is NEVER this tab's
 * own, whatever is in flight (a typed send, the rearm's answer): shown without focus, or offered as a toast for another project.
 * → { action: "show", focus } | { action: "navigate", path } | { action: "toast", path } | { action: "ignore" }.
 */
export function cockpitPlanAction({ ref, pid = "", legaSessionId = null, sendInFlight = false, explicit = false, presentedId = null, reproposed = false } = {}) {
  if (!ref?.id || !["envelope", "ops"].includes(ref.kind)) return { action: "ignore" };
  const own = reproposed !== true && Boolean(explicit || sendInFlight || (ref.sessionId && legaSessionId && ref.sessionId === legaSessionId));
  const path = ref.projectId ? `/lega/${ref.projectId}` : "/lega";
  // An operation plan belongs to the company (no project): it is shown in whatever cockpit is open.
  if (ref.kind === "envelope" && ref.projectId && ref.projectId !== String(pid || "")) {
    const otherPresented = Boolean(presentedId && presentedId !== ref.id);
    return own && !otherPresented ? { action: "navigate", path } : { action: "toast", path };
  }
  return { action: "show", focus: own };
}

/**
 * A card focuses itself only for a focus request naming IT ({ kind, id, tick, at }), once per request (handledTick), and only while the
 * request is fresh: a card restored later (a reload read model, another env) never re-fires an old request (#37/#38).
 */
export const FOCUS_REQUEST_MAX_AGE_MS = 8000;
export function cardFocusWanted(request, { kind, id, handledTick = null, now = Date.now(), maxAgeMs = FOCUS_REQUEST_MAX_AGE_MS } = {}) {
  if (!request || !id || request.kind !== kind || request.id !== id || request.tick === handledTick) return false;
  return !(Number.isFinite(request.at) && now - request.at > maxAgeMs);
}

const NON_TEXT_INPUTS = new Set(["button", "checkbox", "radio", "submit", "reset", "range", "color", "file", "image", "hidden"]);
/**
 * The owner is typing somewhere else: an editable element OUTSIDE the card (the composer, a field) that holds text. The card then
 * never steals the focus (the next Enter would confirm instead of sending the sentence, #38). Works on any element-like object.
 */
export function holdsTypedText(active, container = null) {
  if (!active) return false;
  if (container && typeof container.contains === "function" && container.contains(active)) return false;
  if (active.isContentEditable) return String(active.textContent || "").trim() !== "";
  const tag = String(active.tagName || "").toUpperCase();
  if (tag === "TEXTAREA") return String(active.value || "") !== "";
  if (tag === "INPUT") return !NON_TEXT_INPUTS.has(String(active.type || "text").toLowerCase()) && String(active.value || "") !== "";
  return false;
}

/**
 * The shell's answer to a `lega.plan` (#41): a plan of THIS tab's voice session closes the full-screen stage (the modal covers the
 * cockpit card and the toasts) and opens the cockpit when it is not on screen; anything else only offers „Deschide planul” and keeps
 * the stage as it is (the cockpit underneath shows that plan without focus).
 */
export function shellPlanAction({ ref, mine = false, onCockpit = false, stageOpen = false } = {}) {
  if (!ref?.id) return { closeStage: false, navigate: null, toast: null };
  const path = ref.projectId ? `/lega/${ref.projectId}` : "/lega";
  const own = Boolean(ref.sessionId && mine);
  return { closeStage: own && stageOpen, navigate: own && !onCockpit ? path : null, toast: !own && !onCockpit ? path : null };
}

/** „Ridică la Asistat” is offered only while the project really is on Observ (the cockpit's own level, not a stale option, #42). */
export const autonomyRaiseOffered = (projectLevel) => projectLevel === "OBSERVE";

/** Whether the Studio shows the Unelte panel: asked by the address (?panel=tools), or the last inspection says renders are refused. */
export function studioToolsPanelOpen(query, statusTools) {
  if (query?.panel === "tools") return true;
  const problems = Array.isArray(statusTools?.problems) ? statusTools.problems : [];
  return problems.includes("tool_changed") || problems.includes("tools_not_pinned");
}
