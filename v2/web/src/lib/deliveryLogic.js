// M11 „Ifrim Delivery” — Delivery Room UI logic (pure; tested in node without a browser by v2/tests/m11-ui-logic.test.mjs).
//
// The Room reads ONE aggregated view (GET /api/deliveries/:id; contract in .ifrim/M11_DESIGN.md → DELIVERY ROOM UI) and this module
// decides what the page shows from it: chips, honest evidence labels, the STALE banner, which players / screenshots / documents count
// as CURRENT evidence, the five separate owner decisions with the command each one sends, enabled states, timecodes, the summary diff
// and the ONE answer of a revision. Nothing here talks to the Hub or decides authority: the Hub re-checks the owner session, the
// displayed sha and every transition. Unknown values are never read as a pass, an approval or current evidence.
import { frameToMs, normFps } from "./studioLogic.js";
import { PLAN_STATUS_LABELS, STEP_STATUS_LABELS, planTone, stepTone } from "./opsLogic.js";
import { serviceView, formatPrice, formatLeadTime, NOT_CONFIGURED_TEXT as SALES_NOT_CONFIGURED } from "./salesLogic.js";

const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const str = (v) => (typeof v === "string" ? v : v === null || v === undefined || typeof v === "object" ? "" : String(v));
const up = (v) => str(v).trim().toUpperCase();
/** A finite number, or null for anything else (null, "", undefined, NaN): `Number(null)` is 0 and must never pass for a time or a count. */
const num = (v) => (v === null || v === undefined || v === "" || typeof v === "boolean" || !Number.isFinite(Number(v)) ? null : Number(v));
const SAFE_ID = /^[A-Za-z0-9_-]{3,80}$/;
const safeId = (v) => (typeof v === "string" && SAFE_ID.test(v) ? v : null);
const short = (h, n = 12) => (str(h) ? str(h).slice(0, n) : "");
/** A reason the Hub wrote as a clause („software-ul s-a schimbat: …”) shown as a sentence: first letter upper-cased, one full stop. */
export function sentence(text) {
  const t = str(text).trim();
  if (!t) return "";
  return `${t[0].toLocaleUpperCase("ro-RO")}${t.slice(1)}${/[.!?…]$/.test(t) ? "" : "."}`;
}

// ---------------------------------------------------------------- routes & API paths

/** `#/livrare/<dlv>` and `#/livrare?projectId=<id>`: only a well-formed delivery id ever reaches an API path. */
export function deliveryRoute(id, query = {}) {
  const deliveryId = typeof id === "string" && /^dlv_[A-Za-z0-9_-]{3,76}$/.test(id) ? id : null;
  const projectId = safeId(query?.projectId) || safeId(query?.project);
  return { deliveryId, projectId, invalid: Boolean(id) && !deliveryId };
}
/** In-app path of a delivery (for `go()`; prefix with `#` in an href). */
export const deliveryHref = (id) => `/livrare/${encodeURIComponent(id)}`;
export const deliveryViewPath = (id) => `/api/deliveries/${encodeURIComponent(id)}`;
export const deliveryListPath = (projectId) => `/api/deliveries?projectId=${encodeURIComponent(projectId)}`;

/**
 * The Room's write actions: one row per Hub command (server/delivery/delivery-commands.mjs), sent as POST /api/deliveries/:id/<action>.
 * `session` = the command needs the owner session (the button says so instead of failing). There is NO publish, upload or send
 * action here, and none may be added: publishing is not part of M11.
 */
export const DELIVERY_ACTIONS = Object.freeze({
  verify: Object.freeze({ command: "delivery.verify", action: "verify", session: false }),
  correctionPropose: Object.freeze({ command: "delivery.correction.propose", action: "correction-propose", session: true }),
  packagePropose: Object.freeze({ command: "delivery.package.propose", action: "package-propose", session: true }),
  revise: Object.freeze({ command: "delivery.revise", action: "revise", session: true }),
  summaryEdit: Object.freeze({ command: "delivery.summary.edit", action: "summary-edit", session: true }),
  summaryApprove: Object.freeze({ command: "delivery.summary.approve", action: "summary-approve", session: true }),
  summaryService: Object.freeze({ command: "delivery.summary.service", action: "summary-service", session: true }),
  softwareAccept: Object.freeze({ command: "delivery.software.accept", action: "software-accept", session: true }),
  previewStart: Object.freeze({ command: "delivery.preview.start", action: "preview-start", session: true }),
  previewStop: Object.freeze({ command: "delivery.preview.stop", action: "preview-stop", session: false }),
});
export function deliveryActionPath(id, key) {
  const def = DELIVERY_ACTIONS[key];
  if (!def) throw new Error(`Acțiune necunoscută în camera de livrare: ${String(key).slice(0, 40)}`);
  return `${deliveryViewPath(id)}/${def.action}`;
}
/** The creative decision goes to the existing Studio route (media.review.decide), per edit version. */
export const creativeDecisionPath = (editVersionId) => `/api/media/edit-versions/${encodeURIComponent(editVersionId)}/decision`;

/** The delivery `#/livrare` opens without an id: the most recently created one of the project (or null). */
export function latestDelivery(list) {
  const rows = arr(Array.isArray(list) ? list : list?.deliveries).filter((d) => deliveryRoute(d?.id).deliveryId);
  const time = (d) => Date.parse(d.createdAt || d.updatedAt || "") || 0;
  return rows.slice().sort((a, b) => time(b) - time(a) || (Number(b.generation) || 0) - (Number(a.generation) || 0))[0]?.id || null;
}

/**
 * Hub events after which the view is read again (the hook debounces; live progress never rewrites the view by itself). With the view
 * at hand, another delivery's own events and another project's factory / envelope events are left alone; anything the event does not
 * say is not guessed (the reload happens).
 */
const RELOAD_PREFIXES = ["delivery.", "factory.", "ops.", "envelope.", "media.render.", "media.review.", "media.variant.", "media.rights.", "media.asset.", "media.qa.", "media.edit.", "sales.service."];
export function deliveryReloadEvent(event, view = null) {
  const type = str(event?.type);
  if (!type || type.startsWith("run.activity") || !RELOAD_PREFIXES.some((p) => type.startsWith(p))) return false;
  const d = obj(view?.delivery);
  if (event.scopeType === "delivery" && str(d.id) && str(event.scopeId) && event.scopeId !== d.id) return false;
  if ((type.startsWith("factory.") || type.startsWith("envelope.")) && str(d.projectId) && str(event.projectId) && event.projectId !== d.projectId) return false;
  return true;
}

// ---------------------------------------------------------------- honest wording & evidence labels

/** The only way the Room names the narrow viewport: a width in Chromium, never „pe telefon” (no real device, no touch). */
export const PHONE_WIDTH_PX = 390;
export const phoneWording = (width = PHONE_WIDTH_PX) => `lățimea unui telefon (${Number.isInteger(width) && width > 0 ? width : PHONE_WIDTH_PX} px) în Chromium`;
export const PHONE_WORDING = phoneWording();
export const PHONE_CAVEAT = "fără touch; nu este un telefon real";
export const SYNTHETIC_BADGE = "DATE SINTETICE · DEMO LOCAL";

/** The seven honest evidence labels (I7). Anything unknown is NOT_RUN: never a pass. */
export const EVIDENCE_LABELS = Object.freeze(["PASS_LOCAL", "PASS_SIMULATED", "PASS_LIVE", "FAIL", "BLOCKED", "NOT_RUN", "SKIPPED_ENV"]);
const EVIDENCE_META = Object.freeze({
  PASS_LOCAL: ["ok", "trecut local"], PASS_SIMULATED: ["info", "trecut în simulare"], PASS_LIVE: ["ok", "trecut live"], FAIL: ["error", "picat"],
  BLOCKED: ["warn", "blocat"], NOT_RUN: ["neutral", "nerulat"], SKIPPED_ENV: ["neutral", "sărit (mediul nu îl poate rula)"],
});
const RAW_PASS = new Set(["PASS", "PASS_EVIDENCE", "PASS_REVIEW", "PASS_LOCAL"]);
const RAW_FAIL = new Set(["FAIL", "FAILED", "REJECTED"]);
const RAW_BLOCKED = new Set(["BLOCKED", "INCONCLUSIVE", "NEEDS_INSTALL_APPROVAL", "NEEDS_OWNER_DECISION"]);
/**
 * A check's status (the factory's PASS / FAIL / INCONCLUSIVE / …, or an already honest label) → one of EVIDENCE_LABELS.
 * A simulated delivery (SIMULATION label) can show at most PASS_SIMULATED; PASS_LIVE is never inferred, only passed through.
 */
export function evidenceLabel(status, { simulation = false } = {}) {
  const s = up(status);
  if (RAW_PASS.has(s)) return simulation ? "PASS_SIMULATED" : "PASS_LOCAL";
  if (s === "PASS_SIMULATED") return "PASS_SIMULATED";
  if (s === "PASS_LIVE") return simulation ? "PASS_SIMULATED" : "PASS_LIVE";
  if (RAW_FAIL.has(s)) return "FAIL";
  if (RAW_BLOCKED.has(s)) return "BLOCKED";
  if (s === "SKIPPED_ENV" || s === "SKIPPED") return "SKIPPED_ENV";
  return "NOT_RUN";
}
/**
 * The chip of a check: `{ label, tone, text, raw }`. `current: false` (the evidence belongs to an older version) keeps the label but
 * never a green tone, and says so in the text: old evidence must not read as proof of the code that exists now.
 */
export function evidenceChip(status, { simulation = false, current = true } = {}) {
  const label = evidenceLabel(status, { simulation });
  const [tone, ro] = EVIDENCE_META[label];
  const raw = up(status);
  if (!current) return { label, tone: "neutral", text: `${label} · versiunea veche`, raw, current: false };
  return { label, tone, text: `${label} · ${ro}`, raw, current: true };
}

// ---------------------------------------------------------------- delivery header

export const DELIVERY_STATUS = Object.freeze({
  PLANNED: ["neutral", "planificată"], ARMED: ["info", "confirmată · aștept software-ul"], ACTIVE: ["info", "în lucru"], READY: ["ok", "gata"],
  NEEDS_OWNER: ["warn", "așteaptă decizia ta"], STALE: ["error", "învechită"], CLOSED: ["neutral", "închisă"], CANCELLED: ["neutral", "anulată"],
  EXPIRED: ["neutral", "expirată"], FAILED: ["error", "eșuată"],
});
export const isSimulated = (view) => arr(view?.delivery?.labels).map(up).includes("SIMULATION");
/** Header chips: the status (text, never colour alone), SIMULARE when simulated, and the synthetic-data badge — always. */
export function headerChips(view) {
  const d = obj(view?.delivery);
  const [tone, text] = DELIVERY_STATUS[up(d.status)] || ["neutral", str(d.status) || "necunoscută"];
  const chips = [{ key: "status", tone, text: `Livrare ${text}` }];
  if (isSimulated(view)) chips.push({ key: "simulation", tone: "warn", text: "SIMULARE" });
  chips.push({ key: "synthetic", tone: "warn", text: SYNTHETIC_BADGE });
  if (Number(d.generation) > 1) chips.push({ key: "generation", tone: "neutral", text: `generația ${Number(d.generation)} de software` });
  return chips;
}

const fileEntry = (f) => (typeof f === "string" ? { path: f, status: "" } : { path: str(f?.path), status: str(f?.status) });
/** „Verifică acum”: the last snapshot check, shown as equal ✓ / different ✗ (with up to 20 changed files) / not checked yet. */
export function verifyState(view) {
  const v = obj(view?.delivery?.verified);
  const files = arr(v.changedFiles).map(fileEntry).filter((f) => f.path);
  const shown = files.slice(0, 20);
  if (v.equal === true) return { known: true, equal: true, tone: "ok", text: "snapshot identic ✓", at: str(v.at), files: [], more: 0 };
  if (v.equal === false) {
    return { known: true, equal: false, tone: "error", text: `workspace diferit ✗${files.length ? ` · ${files.length} ${files.length === 1 ? "fișier schimbat" : "fișiere schimbate"}` : ""}`,
      at: str(v.at), files: shown, more: files.length - shown.length };
  }
  return { known: false, equal: null, tone: "neutral", text: "neverificat încă", at: "", files: [], more: 0 };
}

// ---------------------------------------------------------------- stale rules (what is hidden, what is shown)

/** Deliveries whose items prove nothing about the code that exists now (stale.mjs currentView: not STALE, not CLOSED). */
const NOT_CURRENT_DELIVERY = new Set(["STALE", "CLOSED", "CANCELLED", "EXPIRED", "FAILED"]);
const NOT_CURRENT_ITEM = new Set(["STALE", "SUPERSEDED", "INVALIDATED", "MISSING"]);
const snapshotOf = (node) => str(node?.snapshotSha || node?.snapshotShaPrefix).toLowerCase();
const samePrefix = (a, b) => { const n = Math.min(a.length, b.length); return n >= 8 && a.slice(0, n) === b.slice(0, n); };

/**
 * Why a view node (a clip slot, a screenshot, the bundle, the summary) is NOT current — or null when it is. The rule mirrors the server's
 * and adds the page's own guards, so a missed status write can never present an old item as current:
 *   the delivery is STALE / CLOSED (or never produced anything) · the last verify saw a different workspace · the item itself is STALE,
 *   SUPERSEDED or INVALIDATED (`itemStatus`, `stale`) · its snapshot differs from the delivery's verified snapshot (when both are sent).
 */
export function notCurrentReason(view, node) {
  const d = obj(view?.delivery);
  const status = up(d.status);
  if (!node || typeof node !== "object") return { code: "MISSING", text: "nu există" };
  if (node.mismatch === true) return { code: "BUNDLE_MISMATCH", text: "pachetul legat de livrare diferă de ultimul pachet al misiunii" };
  if (status === "STALE") return { code: "DELIVERY_STALE", text: str(d.statusReason).trim() || "baza livrării s-a schimbat" };
  if (NOT_CURRENT_DELIVERY.has(status)) return { code: `DELIVERY_${status}`, text: str(d.statusReason).trim() || `livrarea este ${(DELIVERY_STATUS[status] || [0, status.toLowerCase()])[1]}` };
  if (obj(d.verified).equal === false) return { code: "SNAPSHOT_DIFFERS", text: "workspace-ul diferă de versiunea testată" };
  const item = up(node.itemStatus);
  if (node.stale === true || NOT_CURRENT_ITEM.has(item)) {
    const fallback = item === "SUPERSEDED" ? "există o versiune mai nouă" : item === "INVALIDATED" ? "varianta a fost invalidată" : "baza ei s-a schimbat";
    return { code: item === "SUPERSEDED" ? "SUPERSEDED" : str(node.staleCode) || `ITEM_${item || "STALE"}`, text: str(node.staleReason).trim() || fallback };
  }
  const mine = snapshotOf(node);
  const theirs = snapshotOf(d);
  if (mine && theirs && !samePrefix(mine, theirs)) return { code: "SNAPSHOT_MISMATCH", text: "a fost făcut din alt snapshot decât cel verificat" };
  return null;
}
/**
 * Current EVIDENCE: the node is current AND its automated QA did not fail. A clip whose QA failed stays visible with its findings,
 * but it is never counted or labelled as evidence.
 */
export function isCurrentEvidence(view, node) {
  if (!node || typeof node !== "object") return false;
  return notCurrentReason(view, node) === null && up(obj(node.qa).status) !== "FAIL";
}
/** The label old players hide behind (collapsed): the bundle the clip was made from, and that it proves nothing about new code. */
export function oldClipLabel(view) {
  const id = str(view?.software?.bundle?.id) || "bnd_…";
  return `Clip pentru versiunea veche (${id}) — nu dovedește codul nou`;
}

/** The red banner: why the delivery is stale, the changed files (≤ 20), what it means, and the real link to its replacement. */
export function replacementOf(view) {
  const d = obj(view?.delivery), id = deliveryRoute(d.childId).deliveryId, status = up(d.childStatus);
  if (!id || !["READY", "ARMED", "ACTIVE", "NEEDS_OWNER"].includes(status)) return null;
  return { id, href: `#${deliveryHref(id)}`, label: status === "READY" ? "Deschide livrarea care o înlocuiește" : "Deschide livrarea nouă (în lucru)" };
}
export function staleBanner(view) {
  const d = obj(view?.delivery);
  const check = verifyState(view);
  const stale = up(d.status) === "STALE";
  if (!stale && check.equal !== false) return null;
  const replacement = replacementOf(view);
  const bundleId = str(view?.software?.bundle?.id);
  return {
    tone: "error",
    title: stale ? "Livrare învechită" : "Workspace-ul diferă de versiunea verificată",
    reason: str(d.statusReason).trim() || (check.equal === false ? "workspace-ul diferă de versiunea testată" : "baza livrării s-a schimbat"),
    files: check.files, more: check.more,
    consequence: `Clipurile, capturile și rezumatul arată versiunea veche${bundleId ? ` (${bundleId})` : ""}: nu sunt dovezi pentru codul de acum. Nimic nu a fost șters.`,
    replacement,
  };
}
/** A quieter line for the other non-working states (waiting for you, closed, failed, cancelled), with real links only. */
export function statusNotice(view) {
  const d = obj(view?.delivery);
  const status = up(d.status);
  const reason = str(d.statusReason).trim();
  const link = replacementOf(view);
  const child = link?.id;
  if (status === "NEEDS_OWNER") return { tone: "warn", title: "Așteaptă decizia ta", text: reason || "Planul de livrare s-a oprit; îl continui sau îl anulezi de pe cardul lui.", link: null };
  if (status === "FAILED") return { tone: "error", title: "Livrarea nu a putut porni", text: reason || "Verificările de activare nu au trecut.", link: null };
  if (status === "CLOSED") return { tone: "info", title: "Livrare închisă", text: reason || (child ? "A fost înlocuită de o livrare nouă." : "Ai închis această livrare."), link };
  if (status === "CANCELLED" || status === "EXPIRED") return { tone: "info", title: status === "EXPIRED" ? "Livrare expirată" : "Livrare anulată", text: reason || "Nu s-a capturat nimic.", link: null };
  if (status === "PLANNED" || status === "ARMED") return { tone: "info", title: status === "ARMED" ? "Confirmată" : "Planificată", text: reason || (status === "ARMED" ? "Software-ul se repară și se verifică; captura, clipul și rezumatul pornesc singure după aceea, din aceeași confirmare." : "Planul așteaptă confirmarea ta în cockpit."), link: null };
  return null;
}
/** Links to the parent / child delivery (software revisions), only for ids the view really carries. */
export function lineageLinks(view) {
  const d = obj(view?.delivery);
  const out = [];
  const parent = deliveryRoute(d.parentId).deliveryId;
  const child = replacementOf(view);
  if (parent) out.push({ key: "parent", href: `#${deliveryHref(parent)}`, label: `Înlocuiește livrarea ${parent}` });
  if (child) out.push({ key: "child", href: child.href, label: child.label });
  return out;
}

// ---------------------------------------------------------------- 1 · demo local (preview)

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
/**
 * The preview link is offered only for an http loopback address with an explicit port that is not this page's own origin (never a link
 * that looks like the demo but opens the Hub, and never an external site). Returns the normalized URL or null.
 */
export function safePreviewUrl(url, { hubOrigin = "" } = {}) {
  let u;
  try { u = new URL(str(url)); } catch { return null; }
  if (u.protocol !== "http:" || !LOOPBACK.has(u.hostname) || !u.port || u.username || u.password) return null;
  let hub = null;
  try { hub = hubOrigin ? new URL(hubOrigin) : null; } catch { hub = null; }
  if (hub && u.port === (hub.port || "80") && LOOPBACK.has(hub.hostname)) return null;
  return u.href;
}
/** What the „Demo local” panel offers: open (running), start (verified snapshot only) or stop, each with its honest reason. */
export function previewState(view, { hubOrigin = "", session = "open", busy = false } = {}) {
  const p = obj(view?.preview);
  const url = safePreviewUrl(p.url, { hubOrigin });
  const running = p.running === true;
  const hasBundle = Boolean(str(view?.software?.bundle?.id));
  const why = hasBundle ? notCurrentReason(view, obj(view.software.bundle)) : null;
  const gate = sessionGate(session);
  const start = running ? { enabled: false, reason: "" }
    : !hasBundle ? { enabled: false, reason: "Nu există încă o versiune verificată de pornit." }
      : why ? { enabled: false, reason: `Preview-ul pornește doar din versiunea verificată: ${why.text}.` }
        : gate.blocked ? { enabled: false, reason: gate.reason } : { enabled: true, reason: "" };
  return {
    running, url, rawUrl: str(p.url), urlRefused: Boolean(str(p.url)) && !url,
    startCommand: str(p.startCommand), key: str(p.key),
    open: { enabled: running && Boolean(url) },
    start: { ...start, enabled: start.enabled && !busy, label: sessionLabel("Pornește preview-ul versiunii verificate", session) },
    stop: { enabled: running && !busy, label: "Oprește preview-ul" },
    note: "Cod generat, rulează local pe date sintetice. Se deschide într-o filă nouă, niciodată în pagina Hub-ului.",
  };
}

// ---------------------------------------------------------------- 2 · software (bound to the exact snapshot)

export const BUNDLE_STATUS = Object.freeze({
  READY_FOR_OWNER_ACCEPTANCE: ["approval", "așteaptă acceptarea ta"], OWNER_ACCEPTED: ["ok", "acceptat local"], REJECTED: ["error", "respins"], STALE: ["error", "învechit"],
});
export const CRITERION_STATUS = Object.freeze({
  PASS_EVIDENCE: ["ok", "dovadă automată"], PASS_REVIEW: ["ok", "review independent"], NEVERIFICAT: ["warn", "neverificat"], "VERIFICARE_MANUALĂ": ["approval", "verifici tu"],
  FAIL: ["error", "picat"], BLOCKED: ["warn", "blocat"], INCONCLUSIVE: ["warn", "neconcludent"], NEEDS_INSTALL_APPROVAL: ["warn", "lipsește o unealtă"], NOT_RUN: ["neutral", "nerulat"],
});
export const VERIFY_LABELS = Object.freeze({ test: "test automat", review: "review independent (doar citire)", preview: "preview pornit local", e2e: "în browser (Chromium)", manual: "verificare manuală" });
const FILE_STATUS = Object.freeze({ added: "adăugat", modified: "modificat", deleted: "șters", renamed: "redenumit" });

/** True while the displayed bundle still proves the code that exists now. */
export function softwareCurrent(view) {
  const b = obj(view?.software?.bundle);
  return Boolean(str(b.id)) && !["STALE", "REJECTED"].includes(up(b.status)) && notCurrentReason(view, b) === null;
}
/** Everything the Software panel shows; every evidence chip is bound to `current` (old evidence is never green). */
export function softwareView(view) {
  const s = obj(view?.software);
  const b = obj(s.bundle);
  const simulation = isSimulated(view);
  const present = Boolean(str(b.id));
  const current = softwareCurrent(view);
  const bStatus = up(b.status);
  const why = present ? notCurrentReason(view, b) || (bStatus === "STALE" ? { code: "BUNDLE_STALE", text: "pachetul a fost înlocuit de unul mai nou" } : bStatus === "REJECTED" ? { code: "BUNDLE_REJECTED", text: "pachetul a fost respins" } : null) : null;
  const [bTone, bText] = BUNDLE_STATUS[bStatus] || ["neutral", str(b.status) || "necunoscut"];
  const chip = (status) => evidenceChip(status, { simulation, current });
  const tests = arr(s.tests).map((t, i) => {
    const c = obj(t?.counts);
    const total = num(c.tests);
    // Counts come from the test output only; without them the cell says so instead of inventing progress.
    const countsText = total === null ? "—" : `${num(c.pass) ?? "?"}/${total}${num(c.fail) > 0 ? ` · ${num(c.fail)} picate` : ""}`;
    return { key: `${i}:${str(t?.command)}`, command: str(t?.command), evidence: chip(t?.evidence || t?.status), countsText, isolation: str(t?.isolation), runner: str(t?.runner) };
  });
  const criteria = arr(s.criteria).map((c) => {
    const status = up(c?.status);
    const [tone, text] = CRITERION_STATUS[status] || ["neutral", str(c?.status) || "necunoscut"];
    return { id: str(c?.id), text: str(c?.text), verify: str(c?.verify), verifyLabel: VERIFY_LABELS[str(c?.verify)] || str(c?.verify) || "—",
      status, statusChip: { tone: current ? tone : "neutral", text: `${status || "—"} · ${text}` }, evidence: chip(status), note: str(c?.note), pass: status.startsWith("PASS") };
  });
  const verdict = up(s.review?.verdict);
  return {
    present, current, why,
    // A bundle that no longer proves the code keeps its word (accepted, waiting) but never an inviting colour.
    bundle: { id: str(b.id), shaPrefix: short(b.sha || b.shaPrefix), status: bStatus,
      chip: !present ? { tone: "neutral", text: "încă nu există" } : current || bTone === "error" ? { tone: bTone, text: bText } : { tone: "neutral", text: `${bText} · versiunea veche` } },
    spec: { version: s.spec?.version ?? null, shaPrefix: short(s.spec?.shaPrefix || s.spec?.sha) },
    changeSet: { seq: s.changeSet?.seq ?? null, shaPrefix: short(s.changeSet?.shaPrefix || s.changeSet?.sha) },
    snapshotPrefix: short(s.snapshot?.shaPrefix || s.snapshot?.sha || view?.delivery?.snapshotShaPrefix || view?.delivery?.snapshotSha),
    files: arr(s.changeSet?.files).map(fileEntry).filter((f) => f.path).map((f) => ({ ...f, label: FILE_STATUS[f.status] || f.status || "schimbat" })),
    diff: { text: str(s.diff?.text), truncated: s.diff?.truncated === true },
    review: { id: str(s.review?.id), verdict, chip: { tone: !current ? "neutral" : verdict === "PASS" ? "ok" : verdict === "CHANGES_REQUESTED" ? "warn" : "neutral", text: verdict ? `review: ${verdict}` : "fără review" } },
    tests, criteria,
    counts: { pass: criteria.filter((c) => c.pass).length, total: criteria.length },
  };
}

// ---------------------------------------------------------------- 3 · preview on desktop and at phone width (E2E screenshots)

const shotWidth = (shot) => {
  const w = num(shot?.viewport?.width);
  if (Number.isInteger(w) && w > 0) return w;
  const m = /(\d{3,4})\s*(?:px|×|x)/i.exec(str(shot?.viewportLabel));
  return m ? Number(m[1]) : null;
};
/** A narrow viewport (≤ 480 px) or a label that says phone / mobile: always worded as a width in Chromium. */
export function isPhoneShot(shot) {
  const w = shotWidth(shot);
  if (w !== null) return w <= 480;
  return /telefon|mobil|phone/i.test(str(shot?.viewportLabel));
}
/** Screenshots are served only by the delivery's own evidence route (same origin); any other address is not rendered. */
export function safeShotSrc(src) {
  const s = str(src);
  return /^\/api\/deliveries\/[A-Za-z0-9_-]{3,80}\/evidence\/[A-Za-z0-9_-]{3,80}\/screenshot$/.test(s) ? s : null;
}
/** One row per E2E screenshot: criterion, honest viewport wording, evidence chip and whether it still shows the current code. */
export function shotRows(view) {
  const simulation = isSimulated(view);
  return arr(view?.preview?.shots).map((shot, i) => {
    const phone = isPhoneShot(shot);
    const why = notCurrentReason(view, obj(shot));
    const w = shotWidth(shot);
    const h = num(shot?.viewport?.height);
    const wording = phone ? phoneWording(w && w <= 480 ? w : PHONE_WIDTH_PX)
      : w && Number.isInteger(h) && h > 0 ? `desktop ${w}×${h}` : /desktop/i.test(str(shot?.viewportLabel)) ? str(shot.viewportLabel).trim().slice(0, 40) : "desktop";
    return {
      key: `${i}:${str(shot?.criterion)}`, criterion: str(shot?.criterion), phone, wording, caveat: phone ? PHONE_CAVEAT : "",
      evidence: evidenceChip(shot?.status, { simulation, current: !why }), src: safeShotSrc(shot?.src), current: !why, why,
      alt: `Captură E2E ${str(shot?.criterion)} — ${wording}${why ? " (versiunea veche)" : ""}`,
    };
  });
}

// ---------------------------------------------------------------- 4 · the clip (master 16:9 + vertical 9:16)

export const QA_KINDS = Object.freeze(["technical", "layout", "editorial", "legibility", "factual", "rights"]);
export const QA_KIND_LABELS = Object.freeze({ technical: "tehnic", layout: "încadrare", editorial: "editorial", legibility: "lizibilitate", factual: "factual", rights: "drepturi" });
const QA_TONE = Object.freeze({ PASS: ["ok", "PASS"], WARN: ["warn", "WARN"], FAIL: ["error", "FAIL"], NOT_RUN: ["neutral", "nerulat"] });
/** The automated QA of a version: one overall chip, one chip per kind (all six, NOT_RUN when absent) and the unjustified findings. */
export function qaChips(qa) {
  const q = obj(qa);
  const status = QA_TONE[up(q.status)] ? up(q.status) : "NOT_RUN";
  const byKind = Array.isArray(q.kinds) ? Object.fromEntries(q.kinds.map((k) => [str(k?.kind), k?.status])) : obj(q.kinds);
  const kinds = QA_KINDS.map((kind) => { const s = QA_TONE[up(byKind[kind])] ? up(byKind[kind]) : "NOT_RUN"; return { kind, status: s, tone: QA_TONE[s][0], text: `${QA_KIND_LABELS[kind]}: ${QA_TONE[s][1]}` }; });
  const unjustified = arr(q.unjustified).map((f) => ({ kind: str(f?.kind), kindLabel: QA_KIND_LABELS[str(f?.kind)] || str(f?.kind) || "QA", code: str(f?.code), message: str(f?.message),
    ms: num(f?.range?.fromMs ?? f?.ms) })).filter((f) => f.message || f.code);
  return { status, tone: QA_TONE[status][0], text: `QA automat: ${QA_TONE[status][1]}`, kinds, unjustified };
}
/** What the footage IS (shown on the clip, never inferred): SIMULARE or the original recording of the local demo. */
export function clipLabelChip(label) {
  const l = up(label);
  if (l === "SIMULATION") return { tone: "warn", text: "SIMULARE" };
  if (l === "ORIGINAL_RECORDING") return { tone: "info", text: "ÎNREGISTRARE ORIGINALĂ a demo-ului local" };
  return { tone: "neutral", text: l ? `etichetă: ${l}` : "fără etichetă" };
}
/** The creative review of ONE version: approved only when the Hub says so; anything else is still the owner's to decide. */
export function creativeState(value) {
  const s = up(typeof value === "object" && value ? value.state ?? value.status ?? value.kind : value);
  if (s === "CREATIVE_APPROVED" || s === "APPROVED") return "APPROVED";
  if (s === "REJECTED") return "REJECTED";
  if (s === "CHANGES_REQUESTED") return "CHANGES";
  return "PENDING";
}

/** m:ss with a decimal comma for tenths (10000 → "0:10", 18400 → "0:18,4"): the same form Lega uses on the difference card. */
export function fmtClock(ms) {
  const v = num(ms);
  if (v === null || v < 0) return "—";
  const tenths = Math.round(v / 100);
  const total = Math.floor(tenths / 10);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}${tenths % 10 ? `,${tenths % 10}` : ""}`;
}
/** 37400 → "37,4 s". */
export const fmtDuration = (ms) => (num(ms) !== null && num(ms) >= 0 ? `${(num(ms) / 1000).toFixed(1).replace(".", ",")} s` : "—");

export const MARKER_KIND_LABELS = Object.freeze({ chapter: "capitol", demo: "demonstrație", evidence: "dovadă", proof: "dovadă", cta: "îndemn final", hook: "început", beat: "moment", note: "notă", highlight: "evidențiere" });
/** The clickable marker list: valid times only (inside the clip), in order, each with the text a screen reader hears. */
export function markerRows(slot) {
  const duration = num(slot?.durationMs);
  return arr(slot?.markers)
    .map((m, i) => ({ i, ms: num(m?.ms), kind: str(m?.kind), note: str(m?.note).trim() }))
    .filter((m) => m.ms !== null && m.ms >= 0 && (duration === null || duration <= 0 || m.ms <= duration))
    .sort((a, b) => a.ms - b.ms || a.i - b.i)
    .map((m) => {
      const kindLabel = MARKER_KIND_LABELS[m.kind] || m.kind || "marker";
      // A note that only repeats a word of the kind's own label adds nothing (the clip's last marker is cta „final” → „îndemn final”).
      const repeats = m.note && kindLabel.toLocaleLowerCase("ro-RO").split(/\s+/).includes(m.note.toLocaleLowerCase("ro-RO"));
      const label = m.note && !repeats ? `${kindLabel} — ${m.note}` : kindLabel;
      return { key: `${m.i}:${m.ms}`, ms: Math.round(m.ms), clock: fmtClock(m.ms), kind: m.kind, kindLabel, note: m.note, label, aria: `Mergi la ${fmtClock(m.ms)}: ${label}` };
    });
}
const LABEL_TEXT = /^\s*(simulare|simulation|date sintetice)\b/i;
/** The id of the mandatory synthetic-data label in a delivery clip (server/delivery/clip-ir.mjs LABEL_ITEM_ID). */
export const LABEL_ITEM_ID = "l-data";
/**
 * The on-screen texts of a version. Times come in ms (`startMs` / `endMs`) or in IR frames (`start` / `end` at the clip's fps, 30/1 when
 * the view does not say). The disclosure label — known by its style, its id or its text — is listed but is never a target.
 */
export function textItemRows(slot) {
  const fps = normFps(slot?.fps);
  const ms = (inMs, inFrames) => (num(inMs) !== null ? Math.round(num(inMs)) : num(inFrames) !== null ? Math.round(frameToMs(num(inFrames), fps)) : null);
  return arr(slot?.textItems).filter((t) => safeId(t?.id)).map((t) => {
    const startMs = ms(t.startMs, t.start);
    const endMs = ms(t.endMs, t.end);
    const isLabel = t.style === "label" || t.id === LABEL_ITEM_ID || /^t-label/.test(t.id) || LABEL_TEXT.test(str(t.text));
    return { id: t.id, text: str(t.text), startMs, endMs, range: startMs === null ? "" : `${fmtClock(startMs)}${endMs === null ? "" : `–${fmtClock(endMs)}`}`, isLabel, selectable: !isLabel };
  });
}

const SLOT_DEFS = Object.freeze([["master", "Clip principal 16:9", "16:9"], ["vertical", "Varianta verticală 9:16", "9:16"]]);
const SLOT_HISTORY = Object.freeze({ master: ["edit", "master"], vertical: ["variant", "vertical"] });
/**
 * The two players, in a fixed order. `mode`:
 *   "current" — shown openly (it is the current version); `evidence` says whether it also counts as evidence (QA did not fail);
 *   "old"     — stale or superseded: rendered ONLY collapsed behind `collapsedLabel`, never as current evidence;
 *   "missing" — nothing to play yet (no render), with the reason.
 */
export function clipSlots(view) {
  const clip = obj(view?.clip);
  return SLOT_DEFS.map(([key, title, aspect]) => {
    const raw = obj(clip[key]);
    const editVersionId = safeId(raw.editVersionId);
    const assetVersionId = safeId(raw.assetVersionId);
    const present = Boolean(editVersionId || assetVersionId);
    const why = present ? notCurrentReason(view, raw) : null;
    const qa = qaChips(raw.qa);
    const mode = !present ? "missing" : why ? "old" : "current";
    const evidence = mode === "current" && Boolean(assetVersionId) && qa.status !== "FAIL";
    const creative = creativeState(raw.creative);
    const chain = versionChain(view?.history, ...SLOT_HISTORY[key]);
    const version = Number.isInteger(raw.version) && raw.version > 0 ? raw.version : chain.length ? (chain.find((v) => v.status === "CURRENT") || chain.at(-1)).n : null;
    return {
      key, title, aspect, present, mode, evidence, why, editVersionId, assetVersionId, version, versions: chain,
      playable: Boolean(assetVersionId), durationText: fmtDuration(raw.durationMs), durationMs: num(raw.durationMs),
      fps: normFps(raw.fps), label: clipLabelChip(raw.label), qa, creative, creativeKnown: raw.creative !== undefined && raw.creative !== null,
      evidenceNote: mode !== "current" ? "" : !assetVersionId ? "Versiunea curentă nu are încă o randare; nu e nimic de arătat ca dovadă." : qa.status === "FAIL" ? "QA automat a picat: clipul rămâne vizibil cu constatările lui, dar nu contează ca dovadă." : "",
      collapsedLabel: mode === "old" ? (why.code === "SUPERSEDED" ? `Versiune înlocuită${version ? ` (v${version})` : ""} — există una mai nouă` : oldClipLabel(view)) : "",
      missingText: present ? "" : "Clipul nu a fost produs încă pentru această livrare.",
      markers: markerRows(raw), textItems: textItemRows(raw),
    };
  });
}
/** The two players of the Room, by the key the Hub knows them by (delivery/revision.mjs `player`). */
export const PLAYER_KEYS = Object.freeze(SLOT_DEFS.map(([key]) => key));
const playerKey = (v) => (PLAYER_KEYS.includes(v) ? v : null);
/**
 * A text item the owner picked becomes the Room selection `{ kind: "text", id, versionId, player }` — `player` is the clip it was
 * picked in ("master" = 16:9, "vertical" = 9:16), so the Hub targets that clip. Labels and unknown ids never become a selection.
 */
export function selectionFor(slot, itemId) {
  const item = arr(slot?.textItems).find((t) => t.id === itemId);
  if (!item || !item.selectable || !slot?.editVersionId || slot.mode !== "current") return null;
  return { kind: "text", id: item.id, versionId: slot.editVersionId, player: slot.key };
}
/** The current slot a selection points at: a selectable text of a version that is still the current one, in the player it names (if it names one). */
function selectionSlot(view, selection) {
  const sel = obj(selection);
  if (sel.kind !== "text" || !safeId(sel.id) || !safeId(sel.versionId)) return null;
  return clipSlots(view).find((slot) => slot.mode === "current" && slot.editVersionId === sel.versionId && (!sel.player || sel.player === slot.key)
    && slot.textItems.some((t) => t.id === sel.id && t.selectable)) || null;
}
/** A selection is sent only while it points at a text of a version that is still the current one (of the player it was picked in). */
export const selectionValid = (view, selection) => Boolean(selectionSlot(view, selection));

export const RIGHTS_SCOPE_LABELS = Object.freeze({ organic: "postări organice", paid: "reclame plătite", case_study: "studiu de caz", portfolio: "portofoliu / site", internal: "uz intern" });
const RIGHTS_OK = new Set(["CLEARED_FOR_SCOPE", "CLEARED", "ALLOWED", "RECORDED"]);
const RIGHTS_BAD = new Set(["RESTRICTED", "REVOKED", "EXPIRED", "DENIED"]);
/** Rights: internal use as the Hub states it, and one honest state per public scope (never „permis” by default). */
export function rightsView(view) {
  const r = obj(view?.clip?.rights);
  const internalAllowed = up(r.internal) === "ALLOWED";
  const scopes = arr(r.public).filter((s) => str(s?.scope)).map((s) => {
    const state = up(s.state);
    const [tone, text] = RIGHTS_OK.has(state) ? ["ok", "înregistrat"] : RIGHTS_BAD.has(state) ? ["error", state === "RESTRICTED" ? "restricționat" : state === "REVOKED" ? "revocat" : state === "EXPIRED" ? "expirat" : "refuzat"]
      : state === "PENDING" ? ["warn", "în așteptare"] : ["neutral", "neînregistrat"];
    return { scope: str(s.scope), label: RIGHTS_SCOPE_LABELS[str(s.scope)] || str(s.scope), state, cleared: RIGHTS_OK.has(state), tone, text };
  });
  return { internalAllowed, internalText: internalAllowed ? "Folosire internă (prezentare): permisă pentru material propriu." : `Folosire internă: ${str(r.internal) || "necunoscut"}.`, scopes };
}

// ---------------------------------------------------------------- versions & history (real links only)

export const ITEM_KIND_LABELS = Object.freeze({ bundle: "Pachet software", e2e_shot: "Captură E2E", preview: "Preview", capture: "Captură video", brief: "Brief", claim: "Afirmație", edit: "Montaj",
  render: "Randare", variant: "Variantă", qa: "QA media", export: "Export", summary: "Rezumat" });
const ROLE_LABELS = Object.freeze({ master: "16:9", vertical: "9:16", desktop: "desktop", mobile: PHONE_WORDING });
const ITEM_STATUS = Object.freeze({ CURRENT: ["ok", "curentă"], SUPERSEDED: ["neutral", "înlocuită"], STALE: ["error", "învechită"] });
/**
 * The versions of one item line (kind + role), oldest first, numbered v1…vn by creation. `supersedes` is the version a row replaces —
 * set ONLY when its `supersedesId` names a row of the same line that the view really carries (`linked: false` otherwise: a missing
 * link is shown as missing, never invented).
 */
export function versionChain(history, kind, role = "") {
  const rows = arr(history).filter((h) => str(h?.kind) === kind && str(h?.role) === role && str(h?.id))
    .map((h, i) => ({ h, i, t: Date.parse(h.createdAt || "") || 0 })).sort((a, b) => a.t - b.t || a.i - b.i).map((x) => x.h);
  const index = new Map(rows.map((h, i) => [h.id, i + 1]));
  return rows.map((h, i) => {
    const status = up(h.status);
    const target = h.supersedesId ? index.get(h.supersedesId) : null;
    const [tone, text] = ITEM_STATUS[status] || ["neutral", str(h.status) || "necunoscută"];
    return { n: i + 1, id: h.id, status, tone, text, staleReason: str(h.staleReason).trim(), createdAt: str(h.createdAt),
      supersedes: target && target < i + 1 ? target : null, linked: !h.supersedesId || Boolean(target && target < i + 1) };
  });
}
/** History grouped per item line, in the order of the stale graph; only lines with more than one version or a non-current one are „interesting”. */
export function historyGroups(view) {
  const history = arr(view?.history);
  const seen = new Map();
  for (const h of history) { const k = `${str(h?.kind)}|${str(h?.role)}`; if (str(h?.kind) && !seen.has(k)) seen.set(k, [str(h.kind), str(h.role)]); }
  const order = ["bundle", "e2e_shot", "preview", "capture", "brief", "claim", "edit", "render", "variant", "qa", "export", "summary"];
  const rank = (kind) => { const i = order.indexOf(kind); return i < 0 ? order.length : i; };
  return [...seen.values()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[1].localeCompare(b[1])).map(([kind, role]) => {
    const versions = versionChain(history, kind, role);
    return { key: `${kind}|${role}`, kind, role, label: `${ITEM_KIND_LABELS[kind] || kind}${role ? ` · ${ROLE_LABELS[role] || role}` : ""}`, versions,
      notable: versions.length > 1 || versions.some((v) => v.status !== "CURRENT") };
  });
}

// ---------------------------------------------------------------- owner session (buttons say what they need instead of failing)

/** "open" | "closed" | "unavailable" (not on http://localhost) | "unconfigured" (no authenticator registered yet). */
export function ownerSessionState(owner, { onLocalhost = true } = {}) {
  if (!onLocalhost) return "unavailable";
  if (owner?.bootstrapNeeded) return "unconfigured";
  return owner?.session ? "open" : "closed";
}
export const SESSION_HINT = "deschide sesiunea (Windows Hello)";
export function sessionGate(session) {
  if (session === "unavailable") return { blocked: true, reason: "Sesiunea de proprietar se deschide doar pe http://localhost (aceeași pagină, aceeași adresă de port)." };
  if (session === "unconfigured") return { blocked: true, reason: "Sesiunea de proprietar nu e configurată încă; cockpitul Lega te ghidează o singură dată." };
  return { blocked: false, reason: "" };
}
/** A session-bound button names the ceremony while the session is closed: „… — deschide sesiunea (Windows Hello)”. */
export const sessionLabel = (label, session) => (session === "open" ? label : `${label} — ${SESSION_HINT}`);

// ---------------------------------------------------------------- 6 · the five separate owner decisions

/** The kind of the plan steps that record the screen (server/delivery/template.mjs packageSteps: one per capture role). */
export const CAPTURE_STEP_KIND = "delivery.capture";
/** Lower case, no diacritics („Filmează” → "filmeaza", „Înregistrez” → "inregistrez"). */
const foldRo = (text) => str(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
/**
 * The title fallback, for a view that sends no step kinds: a capture word — the stems captur / film / înregistr, read without
 * diacritics — as the step's OWN action: „Filmează demo-ul pe desktop…”, „Captură desktop (1280×720)”, „Înregistrez…”. The plural
 * „capturi” counts only at the start of a title: later steps name the finished captures they work from („Construiește montajul
 * 16:9 din cele două capturi”), and a montage step is not a recording.
 */
const CAPTURE_TITLE = /(?<![a-z])(?:captur(?:a|ez|eaza|am|are|area)|film(?:ez|eaza|am|are|area)|inregistr(?:ez|eaza|am|are|area))(?![a-z])|^\s*capturi(?:le)?(?![a-z])/;
/**
 * A plan step that records the screen: software acceptance waits for it (accepting stops the factory preview being filmed).
 * The Hub's step kind decides whenever the view carries one; the title is read only for a step without a kind.
 */
export function isCaptureStep(step) {
  const kind = str(step?.kind).trim();
  return kind ? kind === CAPTURE_STEP_KIND : CAPTURE_TITLE.test(foldRo(step?.title));
}
export function captureRunning(view) {
  return arr(view?.plans).some((p) => ["RUNNING", "CONFIRMED"].includes(up(p?.status)) && arr(p.steps).some((s) => up(s?.status) === "RUNNING" && isCaptureStep(s)));
}

/** The exact approval state of the commercial summary: bound to the sha that is displayed, never to „some version”. */
export function summaryApproval(view) {
  const s = obj(view?.summary);
  const a = s.approval && typeof s.approval === "object" ? s.approval : null;
  if (!a || !str(a.sha)) return { state: "none", text: "neaprobat" };
  if (str(s.sha) && a.sha === s.sha) return { state: "approved", text: `„gata de prezentare” pentru v${s.version ?? "?"} (sha ${short(s.sha)})`, at: str(a.at) };
  return { state: "other_version", text: `aprobarea era pentru altă versiune (sha ${short(a.sha)}); versiunea afișată nu e aprobată` };
}

/** The command behind each decision. Publishing has none — there is nothing to click. */
export const DECISION_COMMANDS = Object.freeze({
  software: "delivery.software.accept", creativeMaster: "media.review.decide", creativeVertical: "media.review.decide", rightsPublic: "media.rights.record",
  summaryReady: "delivery.summary.approve", publishing: null,
});
export const DECISION_KEYS = Object.freeze(Object.keys(DECISION_COMMANDS));
export const PUBLISHING_ROW_TEXT = "Publicare: oprită (politica media; nu se face din Hub în M11)";
/** Where „Înregistrează dreptul” goes: the existing Studio rights UI of the delivery's content project (or the library). */
export function rightsHref(view) {
  const cp = safeId(view?.delivery?.contentProjectId) || safeId(view?.clip?.contentProjectId);
  return cp ? `#/studio/${cp}?sub=rights` : "#/studio/library";
}

const pendingChip = Object.freeze({ tone: "approval", text: "în așteptarea ta" });
/** The summary block's word for one decision (`decisions.<key>`: a string or `{ state }`) — a fallback only where the record itself is not in the view. */
const claimedState = (view, key) => { const c = view?.decisions?.[key]; return up(c && typeof c === "object" ? c.state ?? c.status : c); };
function gated(action, { session = "open", busy = false } = {}) {
  if (!action || action.kind !== "command") return action;
  const gate = action.needsSession ? sessionGate(session) : { blocked: false, reason: "" };
  const label = action.needsSession ? sessionLabel(action.label, session) : action.label;
  if (!action.enabled) return { ...action, label };
  if (gate.blocked) return { ...action, label, enabled: false, reason: gate.reason };
  return { ...action, label, enabled: !busy };
}

function softwareRow(view, ctx) {
  const b = obj(view?.software?.bundle);
  const status = up(b.status);
  const present = Boolean(str(b.id));
  const current = softwareCurrent(view);
  const why = present ? notCurrentReason(view, b) : null;
  // The record decides: the bundle's own status wins over the summary block (an „accepted” the record does not show is not shown).
  // Only a bundle sent without a status falls back to the block's word.
  const record = status || (present ? claimedState(view, "software") : "");
  const state = ["OWNER_ACCEPTED", "ACCEPTED"].includes(record) ? "DONE" : record === "REJECTED" ? "REJECTED" : "PENDING";
  const displayed = str(b.sha);
  let action = null;
  if (state === "PENDING") {
    const base = { kind: "command", command: DECISION_COMMANDS.software, label: "Accept local", needsSession: true, fresh: true, enabled: true, reason: "",
      request: present ? { method: "POST", path: deliveryActionPath(str(view?.delivery?.id), "softwareAccept"), body: { bundleId: str(b.id), displayedBundleSha: displayed } } : null };
    if (!present) action = { ...base, enabled: false, reason: "Nu există încă un pachet de livrare." };
    else if (why || status === "STALE") action = { ...base, enabled: false, reason: `Pachetul nu mai corespunde codului de acum: ${why?.text || "a fost înlocuit de unul mai nou"}.` };
    else if (status !== "READY_FOR_OWNER_ACCEPTANCE") action = { ...base, enabled: false, reason: `Pachetul nu așteaptă acceptarea (stare: ${status || "necunoscută"}).` };
    else if (!/^[0-9a-f]{64}$/.test(displayed)) action = { ...base, enabled: false, reason: "Lipsește amprenta completă a pachetului afișat; reîncarcă pagina." };
    else if (captureRunning(view)) action = { ...base, enabled: false, reason: "Aștept capturile sau oprește planul: acceptarea ar opri preview-ul care se filmează." };
    else action = base;
  }
  const chip = state === "DONE" ? { tone: current ? "ok" : "neutral", text: current ? "acceptat local" : "acceptat local · pentru versiunea veche" }
    : state === "REJECTED" ? { tone: "error", text: "respins" } : !present ? { tone: "neutral", text: "încă nu e nimic de acceptat" } : pendingChip;
  return { key: "software", group: "software", title: "Acceptarea software-ului", target: present ? `${str(b.id)} · sha ${short(displayed)}` : "", state, chip,
    does: "Marchează pachetul afișat ca acceptat local (OWNER_ACCEPTED), după ce Hub-ul verifică din nou că workspace-ul e cel testat.",
    doesNot: "Nu aprobă clipul, nu acordă drepturi, nu marchează rezumatul și nu face commit, push sau publicare.",
    action: gated(action, ctx) };
}

function creativeRow(view, slotKey, slot, ctx) {
  const key = slotKey === "master" ? "creativeMaster" : "creativeVertical";
  const claimed = view?.decisions?.[key];
  // Per version: a decision recorded for another edit version never carries over to the one displayed.
  const otherVersion = claimed && typeof claimed === "object" && safeId(claimed.editVersionId) && slot.editVersionId && claimed.editVersionId !== slot.editVersionId;
  const own = otherVersion ? "PENDING" : slot.creativeKnown ? slot.creative : creativeState(claimedState(view, key));
  const state = !slot.present ? "PENDING" : own === "APPROVED" ? "DONE" : own === "REJECTED" ? "REJECTED" : own === "CHANGES" ? "CHANGES" : "PENDING";
  const v = slot.version ? `v${slot.version}` : "versiunea afișată";
  let action = null;
  if (state !== "DONE") {
    const base = { kind: "command", command: DECISION_COMMANDS[key], label: `Aprobă creația ${slot.aspect}`, needsSession: true, fresh: true, enabled: true, reason: "",
      caution: slot.qa.status === "FAIL" ? "QA automat: picat — aprobarea creativă nu îl schimbă și clipul tot nu contează ca dovadă." : slot.qa.status === "WARN" ? "QA automat are avertismente; le vezi lângă clip." : "",
      request: slot.editVersionId ? { method: "POST", path: creativeDecisionPath(slot.editVersionId), body: { kind: "CREATIVE_APPROVED", note: "" } } : null };
    if (!slot.present || !slot.editVersionId) action = { ...base, enabled: false, reason: "Nu există încă un clip de aprobat." };
    else if (slot.mode === "old") action = { ...base, enabled: false, reason: "Clipul e pentru versiunea veche; aprobarea creativă se dă pe versiunea nouă." };
    else if (!slot.playable) action = { ...base, enabled: false, reason: "Versiunea curentă nu are încă o randare de văzut." };
    else action = base;
  }
  const chip = state === "DONE" ? { tone: slot.mode === "current" ? "ok" : "neutral", text: slot.mode === "current" ? `creație aprobată (${v})` : `creație aprobată · pentru versiunea veche` }
    : state === "REJECTED" ? { tone: "error", text: "respinsă" } : state === "CHANGES" ? { tone: "warn", text: "modificări cerute" } : !slot.present ? { tone: "neutral", text: "încă nu există" } : pendingChip;
  return { key, group: "creative", title: `Aprobare creativă — ${slot.title}`, target: slot.editVersionId ? `${v} · ${slot.editVersionId}` : "", state, chip,
    does: "Spune că ACEASTĂ versiune de clip arată cum vrei. Cere Windows Hello de fiecare dată.",
    doesNot: "Nu acceptă software-ul, nu acordă drepturi de folosire publică și nu publică. O versiune nouă pornește neaprobată.",
    action: gated(action, ctx) };
}

function rightsRow(view, slots) {
  const r = rightsView(view);
  const cleared = r.scopes.filter((s) => s.cleared).length;
  const state = r.scopes.length ? (cleared === r.scopes.length ? "DONE" : cleared ? "PARTIAL" : "PENDING") : RIGHTS_OK.has(claimedState(view, "rightsPublic")) ? "DONE" : "PENDING";
  const chip = state === "DONE" ? { tone: "ok", text: "înregistrate pentru folosirile afișate" } : state === "PARTIAL" ? { tone: "warn", text: `${cleared} din ${r.scopes.length} folosiri înregistrate` }
    : { tone: "neutral", text: "neînregistrate (uzul intern nu le cere)" };
  const hasClip = slots.some((s) => s.present);
  return { key: "rightsPublic", group: "rights", title: "Drepturi pentru folosire publică", target: "", state, chip, scopes: r.scopes, internalText: r.internalText,
    does: "Înregistrezi, pentru fiecare tip de folosire publică, dreptul de a arăta clipul (în Studio, pe material).",
    doesNot: "Nu aprobă creația, nu acceptă software-ul și nu publică nimic. Prezentarea internă nu are nevoie de această înregistrare.",
    action: { kind: "link", command: DECISION_COMMANDS.rightsPublic, label: "Înregistrează dreptul (în Studio)", href: rightsHref(view), enabled: hasClip, reason: hasClip ? "" : "Nu există încă un clip." } };
}

function summaryRow(view, ctx) {
  const s = obj(view?.summary);
  const present = Boolean(str(s.documentId));
  const ap = summaryApproval(view);
  const docCurrent = present && up(s.status) === "CURRENT" && notCurrentReason(view, s) === null;
  const state = !present ? "PENDING" : ap.state === "approved" ? (docCurrent ? "DONE" : "VOID") : "PENDING";
  let action = null;
  if (state !== "DONE") {
    const base = { kind: "command", command: DECISION_COMMANDS.summaryReady, label: "Gata de prezentare", needsSession: true, fresh: false, enabled: true, reason: "",
      request: present ? { method: "POST", path: deliveryActionPath(str(view?.delivery?.id), "summaryApprove"), body: { documentId: str(s.documentId), version: s.version ?? null, displayedSha: str(s.sha) } } : null };
    if (!present) action = { ...base, enabled: false, reason: "Rezumatul nu a fost generat încă." };
    else if (!docCurrent) action = { ...base, enabled: false, reason: "Rezumatul descrie versiunea veche; aprobarea și exportul sunt refuzate până la o versiune nouă." };
    else if (!str(s.sha)) action = { ...base, enabled: false, reason: "Lipsește amprenta versiunii afișate; reîncarcă pagina." };
    else if (ctx?.summaryDirty) action = { ...base, enabled: false, reason: "Ai modificări nesalvate în rezumat: salvează-le (versiune nouă) sau renunță la ele întâi." };
    else action = base;
  }
  const chip = state === "DONE" ? { tone: "ok", text: ap.text } : state === "VOID" ? { tone: "neutral", text: "aprobarea era pentru versiunea veche" }
    : ap.state === "other_version" ? { tone: "warn", text: ap.text } : !present ? { tone: "neutral", text: "încă nu există" } : pendingChip;
  return { key: "summaryReady", group: "summary", title: "Rezumatul comercial — „gata de prezentare”", target: present ? `v${s.version ?? "?"} · sha ${short(s.sha)}` : "", state, chip,
    does: "Leagă aprobarea ta de versiunea afișată (amprenta de mai sus). Orice versiune nouă pornește neaprobată.",
    doesNot: "Nu trimite rezumatul nimănui, nu aprobă clipul și nu acceptă software-ul.",
    action: gated(action, ctx) };
}

function publishingRow(view) {
  const raw = claimedState(view, "publishing");
  return { key: "publishing", group: "publishing", title: PUBLISHING_ROW_TEXT, target: "", state: "OFF", chip: { tone: "neutral", text: "oprită" },
    does: "", doesNot: "Camera de livrare nu publică, nu încarcă și nu trimite nimic, indiferent de celelalte decizii.",
    // The Hub always reports OFF; any other value is shown as an anomaly, and there is still nothing to click.
    anomaly: raw && raw !== "OFF" ? `Hub-ul a raportat „${raw}” pentru publicare; camera de livrare tot nu publică nimic.` : "",
    action: null };
}

/**
 * The decision rows, in a fixed order: software, creative (one row per version: master, vertical), public rights, summary, publishing.
 * Each row is computed ONLY from its own record — no row's state or button depends on another decision. `ctx`: { session, busy, summaryDirty }.
 */
export function decisionRows(view, ctx = {}) {
  const slots = clipSlots(view);
  return [softwareRow(view, ctx), ...slots.map((slot) => creativeRow(view, slot.key, slot, ctx)), rightsRow(view, slots), summaryRow(view, ctx), publishingRow(view)];
}
/** The FIVE separate decisions as the panel lists them (creative approval holds one sub-row per version). */
export function decisionGroups(view, ctx = {}) {
  const rows = decisionRows(view, ctx);
  const of = (group) => rows.filter((r) => r.group === group);
  return [
    { key: "software", title: "1 · Acceptarea software-ului", rows: of("software") },
    { key: "creative", title: "2 · Aprobarea creativă (pe fiecare versiune)", rows: of("creative") },
    { key: "rights", title: "3 · Drepturi pentru folosire publică", rows: of("rights") },
    { key: "summary", title: "4 · Rezumatul „gata de prezentare”", rows: of("summary") },
    { key: "publishing", title: "5 · Publicare", rows: of("publishing") },
  ];
}
/** The request of ONE decision (what the click sends), or the Studio link for rights, or null (publishing; nothing to send). */
export function decisionRequest(view, key, ctx = {}) {
  const row = decisionRows(view, ctx).find((r) => r.key === key);
  if (!row?.action) return null;
  if (row.action.kind === "link") return { command: row.action.command, href: row.action.href };
  return row.action.request ? { command: row.action.command, ...row.action.request } : null;
}
/** How many of the owner's decisions are still open (rights are optional for an internal presentation, so they are not counted). */
export function pendingDecisions(view) {
  return decisionRows(view).filter((r) => ["software", "creativeMaster", "creativeVertical", "summaryReady"].includes(r.key) && r.state !== "DONE" && r.state !== "REJECTED").length;
}

// ---------------------------------------------------------------- 5 · the commercial summary (versioned, edited by section)

export const NOT_CONFIGURED_TEXT = SALES_NOT_CONFIGURED;
export const SUMMARY_LIMITS = Object.freeze({ sectionMax: 4000 });
const SOURCE_LABELS = Object.freeze({ template: "șablon", owner: "editat de tine", auto: "automat", service: "din serviciul din catalog", mixed: "șablon + tine" });
/**
 * GENERATED sections, with what each is generated from. The Room never offers to edit them and never builds an edit body for them
 * (the Hub refuses the same two: delivery/revision.mjs SUMMARY_SECTIONS `auto`): „Materiale video” is rewritten at every clip version,
 * „Trasabilitate” states the facts of the verified bundle. The owner's own remarks go in the editable sections.
 */
const AUTO_SECTION_NOTES = Object.freeze({
  video: "Secțiune automată: se regenerează la fiecare versiune de clip, din fișierele și QA-ul curente.",
  provenance: "Secțiune automată: se generează din faptele pachetului verificat (pachet, amprente, specificație) și nu se editează de mână. Observațiile tale le scrii într-o secțiune editabilă, de exemplu „Următorul pas”.",
});
/** A section the Hub itself marks `auto` without being one of the two above. */
const AUTO_SECTION_NOTE = "Secțiune automată: se generează din starea curentă a livrării și nu se editează de mână.";
export const AUTO_SECTION_IDS = Object.freeze(Object.keys(AUTO_SECTION_NOTES));

/** Unresolved template fields in a text (the same pattern the Hub refuses in sales/proposal.mjs findUnresolvedPlaceholders). */
export function findPlaceholders(text) {
  const found = str(text).match(/\{\{[^}]*\}\}|\$\{[^}]*\}|\[\[[^\]]*\]\]|<(?:nume|name|firma|company|oras|city|pret|price)>|\bundefined\b|\bNaN\b|\[object Object\]|\bTODO\b|\bXXX\b|\bnull\b/gi);
  return found ? [...new Set(found)] : [];
}
/** Facts only the owner (or a CONFIGURED catalog service) may state: an edit that contains one stays the owner's and is listed „de verificat”. */
export function assertedFacts(text) {
  const t = str(text);
  const out = [];
  if (/(\d[\d.,]*\s?(lei|ron|eur|euro|usd)\b)|€|\$\s?\d/i.test(t)) out.push("preț");
  if (/\d\s?%/.test(t)) out.push("procent");
  // \b is ASCII-only in JavaScript: „în” starts with a diacritic, so its boundary is checked with a Unicode look-behind.
  if (/(?<!\p{L})în\s+\d+\s+(zile|săptămâni|saptamani|luni)(?!\p{L})|(?<!\p{L})p[âa]n[ăa]\s+(la|pe)(?!\p{L})/iu.test(t)) out.push("termen");
  if (/\bgarant/i.test(t)) out.push("garanție");
  return out;
}

/** The summary as the editor shows it: sections with their source, what is not configured, and whether it is the current document. */
export function summaryView(view) {
  const s = obj(view?.summary);
  const present = Boolean(str(s.documentId));
  // The delivery-level reason comes first (it names the cause); a document that is not CURRENT is never current, whatever else says.
  const docStatus = up(s.status);
  const why = !present ? null : notCurrentReason(view, s) || (docStatus !== "CURRENT"
    ? { code: `DOCUMENT_${docStatus || "UNKNOWN"}`, text: str(s.staleReason).trim() || (docStatus === "SUPERSEDED" ? "există o versiune mai nouă a rezumatului" : "baza rezumatului s-a schimbat") } : null);
  const current = present && !why;
  const basis = obj(s.basis);
  const services = arr(basis.serviceRefs).map((r) => (typeof r === "string" ? r : `${str(r?.id)}@${str(r?.version)}`)).filter((r) => r && r !== "@");
  const bundle = str(basis.bundleId);
  const bundleSha = str(basis.bundleShaPrefix || basis.bundleSha);
  const exports = current ? ["md", "html"].filter((f) => str(obj(s.exports)[f]?.file)).map((f) => ({ format: f, file: str(s.exports[f].file), shaPrefix: short(s.exports[f].sha256),
    href: `${deliveryViewPath(str(view?.delivery?.id))}/summary/${encodeURIComponent(String(s.version))}.${f}` })) : [];
  return {
    present, current, why, documentId: str(s.documentId), version: s.version ?? null, sha: str(s.sha), shaPrefix: short(s.sha), status: docStatus,
    sections: arr(s.sections).filter((x) => safeId(x?.id)).map((x) => {
      // A generated section stays locked whatever the view says about it (`editable: true` on it is not believed).
      const auto = x.auto === true || AUTO_SECTION_IDS.includes(x.id);
      return { id: x.id, heading: str(x.heading) || x.id, text: str(x.text), source: str(x.source), sourceLabel: auto ? SOURCE_LABELS.auto : SOURCE_LABELS[str(x.source)] || str(x.source) || "—",
        needsReview: x.needsReview === true, reviewReason: str(x.reviewReason), auto, autoNote: auto ? AUTO_SECTION_NOTES[x.id] || AUTO_SECTION_NOTE : "", editable: current && !auto && x.editable !== false,
        notConfigured: str(x.text).includes(NOT_CONFIGURED_TEXT) };
    }),
    warnings: arr(s.warnings).map(str).filter(Boolean), claimsToVerify: arr(s.claimsToVerify).map(str).filter(Boolean),
    basisLines: [`Pachet: ${bundle || "—"}${bundleSha ? ` (sha ${short(bundleSha)})` : ""}`, `Serviciu din catalog: ${services.length ? services.join(", ") : "neconfigurat"}`],
    serviceBound: services.length > 0, approval: summaryApproval(view), exports,
  };
}

/** Line diff (LCS) between two section texts: `[{ op: "same" | "del" | "add", text }]`, bounded by the section limit. */
export function lineDiff(before, after) {
  const a = str(before).replace(/\r\n?/g, "\n").split("\n").slice(0, 400);
  const b = str(after).replace(/\r\n?/g, "\n").split("\n").slice(0, 400);
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out = [];
  let i = 0; let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ op: "same", text: a[i] }); i += 1; j += 1; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push({ op: "del", text: a[i] }); i += 1; }
    else { out.push({ op: "add", text: b[j] }); j += 1; }
  }
  while (i < a.length) { out.push({ op: "del", text: a[i] }); i += 1; }
  while (j < b.length) { out.push({ op: "add", text: b[j] }); j += 1; }
  return out;
}
const normText = (t) => str(t).replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
/**
 * What saving would change: one entry per section whose draft differs from the displayed text (whitespace-only edits are not changes),
 * each validated with the Hub's own rules (not empty, no unfilled placeholder, at most 4000 characters, an editable section).
 * `drafts` maps section id → text; ids the view does not have are ignored.
 */
export function summaryDiff(sections, drafts) {
  const d = obj(drafts);
  const changes = [];
  for (const s of arr(sections)) {
    if (!(s.id in d) || typeof d[s.id] !== "string") continue;
    const after = normText(d[s.id]);
    if (after === normText(s.text)) continue;
    const placeholders = findPlaceholders(after);
    const error = s.editable === false ? "Această secțiune nu se editează aici." : !after ? "O secțiune editată nu poate fi goală."
      : after.length > SUMMARY_LIMITS.sectionMax ? `Cel mult ${SUMMARY_LIMITS.sectionMax} de caractere pe secțiune (acum ${after.length}).`
        : placeholders.length ? `Textul are câmpuri necompletate: ${placeholders.slice(0, 5).join(", ")}.` : null;
    changes.push({ id: s.id, heading: s.heading, before: str(s.text), after, lines: lineDiff(s.text, after), facts: assertedFacts(after), error });
  }
  return { changes, changed: changes.length, valid: changes.length > 0 && changes.every((c) => !c.error), errors: changes.filter((c) => c.error).map((c) => `${c.heading}: ${c.error}`) };
}
/**
 * The body of delivery.summary.edit: only the changed sections (`{ sections: [{ id, text }] }`), plus the sha of the version the edit
 * was made on (`displayedSha`, so the Hub can refuse an edit of an older text) — or null when there is nothing valid to save.
 * A draft of a generated section („Materiale video”, „Trasabilitate”) is never valid, so no body is ever built with one.
 */
export function summaryEditBody(view, drafts) {
  const sv = summaryView(view);
  const diff = summaryDiff(sv.sections, drafts);
  if (!sv.current || !diff.valid) return null;
  return { sections: diff.changes.map((c) => ({ id: c.id, text: c.after })), ...(sv.sha ? { displayedSha: sv.sha } : {}) };
}
/** Catalog services for „Leagă un serviciu din catalog”: only active ones with something CONFIGURED can be bound; the rest say why not. */
export function bindableServices(list) {
  return arr(Array.isArray(list) ? list : list?.services).map(serviceView).filter((s) => s.id && s.active).map((s) => {
    const priceOk = s.price.status === "CONFIGURED";
    const leadOk = s.leadTime.status === "CONFIGURED";
    return { id: s.id, version: s.version, name: s.name || s.id, priceText: formatPrice(s.price), leadText: formatLeadTime(s.leadTime), bindable: priceOk || leadOk,
      reason: priceOk || leadOk ? "" : "neconfigurat — completează prețul sau termenul în Vânzări → Servicii", label: `${s.name || s.id} (v${s.version}) · preț: ${formatPrice(s.price)} · termen: ${formatLeadTime(s.leadTime)}` };
  });
}

// ---------------------------------------------------------------- the revision box (ONE difference card or ONE clarification)

export const REVISION_LIMITS = Object.freeze({ min: 3, max: 1000, options: 3 });
export const REVISION_STATUS = Object.freeze({ NOTED: ["info", "notat"], CLARIFY: ["warn", "aștept clarificarea ta"], PROPOSED: ["approval", "plan propus"], APPLIED: ["ok", "aplicat"],
  ROUTED_SOFTWARE: ["info", "schimbare de software (plan separat)"], REFUSED: ["error", "refuzat"], CANCELLED: ["neutral", "anulat"] });
export const REVISION_CLASS_LABELS = Object.freeze({ correction: "corectură", feedback: "feedback", tone: "ton", clip: "clip", vertical: "varianta verticală", summary: "rezumat", software: "software", unknown: "neclar" });

/** Whether the owner can send a revision sentence now, and why not (a delivery still being produced has nothing to revise). */
export function revisionAvailability(view) {
  const status = up(view?.delivery?.status);
  if (["READY", "STALE", "NEEDS_OWNER"].includes(status)) return { enabled: true, reason: "" };
  if (["PLANNED", "ARMED", "ACTIVE"].includes(status)) return { enabled: false, reason: "Livrarea e încă în lucru; poți cere schimbări după ce e gata." };
  return { enabled: false, reason: "Livrarea e închisă; cere schimbările pe livrarea curentă a proiectului." };
}
/**
 * The body of delivery.revise: `{ text, selection?: { kind: "text", id, versionId, player }, timecodeMs?, player? }` — exactly what
 * delivery/revision.mjs classify reads. The selection is sent only while it is valid on the current version, with the player it
 * belongs to. The timecode is sent only when the owner tied the sentence to the moment (it targets a clip, so it is never attached
 * silently), together with `player` — the player the moment was taken in ("master" = 16:9, "vertical" = 9:16), so a moment of the
 * 9:16 player targets the vertical variant. A moment of a player that no longer shows the current version is not sent.
 */
export function revisionBody({ text, selection = null, timecodeMs = null, player = null } = {}, view = null) {
  const t = str(text).replace(/\s+/g, " ").trim();
  if (t.length < REVISION_LIMITS.min) return { ok: false, error: "Scrie ce vrei să schimbi (cel puțin 3 caractere)." };
  if (t.length > REVISION_LIMITS.max) return { ok: false, error: `Fraza e prea lungă (cel mult ${REVISION_LIMITS.max} de caractere).` };
  const body = { text: t };
  const sel = obj(selection);
  if (sel.kind === "text" && safeId(sel.id) && safeId(sel.versionId)) {
    // With the view at hand the player is the slot that really holds the text; without it, the one the selection names (if valid).
    const slot = view ? selectionSlot(view, sel) : null;
    const pickedIn = slot ? slot.key : view ? null : playerKey(sel.player);
    if (slot || !view) body.selection = { kind: "text", id: sel.id, versionId: sel.versionId, ...(pickedIn ? { player: pickedIn } : {}) };
  }
  const ms = Number(timecodeMs);
  const from = playerKey(player);
  const timed = timecodeMs !== null && timecodeMs !== undefined && timecodeMs !== "" && Number.isFinite(ms) && ms >= 0;
  const playerGone = Boolean(from && view) && !clipSlots(view).some((slot) => slot.key === from && slot.mode === "current");
  if (timed && !playerGone) {
    body.timecodeMs = Math.round(ms);
    if (from) body.player = from;
  }
  return { ok: true, body };
}

const opsPlanOf = (r) => [r.opsPlan, r.card?.opsPlan, r.plan].find((p) => p && typeof p === "object" && /^opp_/.test(str(p.id)) && safeId(p.id)) || null;
const envelopeOf = (r) => [r.envelope, r.plan?.envelope, r.proposal?.envelope].find((e) => e && typeof e === "object" && /^env_/.test(str(e.id)) && safeId(e.id)) || null;
/**
 * The Hub's answer to a revision, reduced to exactly ONE thing to show:
 *   "question" — the ONE clarification (≤ 3 options); nothing changes until it is answered, so it wins over anything else in the answer;
 *   "ops"      — the ONE difference card (an operation plan, one confirmation: no code, no model);
 *   "envelope" — the ONE difference card of a software change (a new mission under its own confirmation);
 *   "message"  — a note (feedback recorded, a summary version saved, a refusal explained); "empty" when the answer carries nothing.
 * `notes` are extra lines (e.g. „Notat că site-ul e bine…”) shown next to it; they never add a second card.
 */
export function revisionOutcome(res) {
  const top = obj(res);
  // The command may answer directly, under `result`, or as intake step results; among several, the question comes first, then a card.
  const results = arr(top.results).filter((x) => x && typeof x === "object");
  const hasQuestion = (x) => Boolean(x.clarification || x.question || up(x.revision?.status) === "CLARIFY");
  const hasCard = (x) => Boolean(opsPlanOf(x) || envelopeOf(x));
  const node = results.find(hasQuestion) || results.find(hasCard) || results.find((x) => x.message || x.note || x.refused || x.error)
    || (top.result && typeof top.result === "object" && !Array.isArray(top.result) ? top.result : top);
  const revision = obj(node.revision || top.revision);
  const notes = [...new Set([...arr(node.notes), ...arr(top.notes), node.note, ...results.filter((x) => x !== node).map((x) => x.message || x.note)].map((n) => str(n).trim()).filter(Boolean))];
  const base = { revisionId: safeId(revision.id), status: up(revision.status), classes: arr(revision.classes).map(str), notes };
  const clar = obj(node.clarification || revision.clarification);
  const question = str(clar.question || node.question).trim();
  if (question || base.status === "CLARIFY") {
    const options = arr(clar.options || node.options).map((o, i) => (typeof o === "string" ? { id: o, label: o } : { id: str(o?.id) || String(i + 1), label: str(o?.label || o?.text || o?.id) }))
      .filter((o) => o.label).slice(0, REVISION_LIMITS.options);
    return { ...base, kind: "question", question: question || "Poți preciza la ce te referi?", options, forIntent: str(clar.forIntent) || "delivery_revise" };
  }
  const ops = opsPlanOf(node);
  if (ops) return { ...base, kind: "ops", plan: ops };
  const env = envelopeOf(node);
  if (env) return { ...base, kind: "envelope", plan: { envelope: env, summary: node.plan?.summary || node.proposal?.summary || env.summary || null } };
  const refused = node.refused || node.error;
  const message = str(typeof refused === "object" && refused ? refused.message : refused).trim() || str(node.message || node.text).trim() || notes[0] || "";
  if (!message) return { ...base, kind: "empty", message: "Hub-ul a răspuns fără nimic de arătat; nimic nu s-a schimbat." };
  return { ...base, kind: "message", tone: refused || base.status === "REFUSED" ? "warn" : "info", message, notes: notes.filter((n) => n !== message) };
}
/** The follow-up of the ONE clarification: the same sentence, the chosen option and the revision it answers. */
export function clarificationReply(outcome, option, original = {}) {
  const body = { ...obj(original.body), choice: { id: str(option?.id), forIntent: str(outcome?.forIntent) || "delivery_revise" } };
  if (outcome?.revisionId) body.revisionId = outcome.revisionId;
  return body;
}
/** Past revisions as rows (status words, classes, the plan each one produced). */
export function revisionRows(view) {
  return arr(view?.revisions).filter((r) => str(r?.id)).map((r) => {
    const status = up(r.status);
    const [tone, text] = REVISION_STATUS[status] || ["neutral", str(r.status) || "necunoscut"];
    return { id: r.id, source: r.source || "owner", sourceLabel: r.source === "hub" ? "propusă de Hub" : "cerută de tine", text: str(r.text), status, tone, statusText: text, classes: arr(r.classes).map((c) => REVISION_CLASS_LABELS[str(c)] || str(c)).filter(Boolean), planId: safeId(r.planId) };
  });
}

// ---------------------------------------------------------------- plans (progress through the ordinary ops engine)

export const PLAN_KIND_LABELS = Object.freeze({ "delivery.correct": "Corectură afirmații (clip + rezumat)", "delivery.package": "Pachetul de livrare: captură, clip, rezumat", "delivery.revise": "Revizie de clip" });
const PLAN_OPEN = new Set(["PROPOSED", "CONFIRMED", "RUNNING", "PAUSED", "NEEDS_OWNER"]);
/** The delivery's plans with their steps; `open` ones (waiting, running, paused) get the full plan card with its controls. */
export function planRows(view) {
  return arr(view?.plans).filter((p) => safeId(p?.id)).map((p) => {
    const status = up(p.status);
    const steps = arr(p.steps).map((s, i) => ({ seq: Number.isInteger(s?.seq) ? s.seq : i + 1, title: str(s?.title), status: up(s?.status), tone: stepTone(up(s?.status)), label: STEP_STATUS_LABELS[up(s?.status)] || str(s?.status) || "—" }));
    const running = steps.find((s) => s.status === "RUNNING") || null;
    return { id: p.id, kind: str(p.kind), kindLabel: PLAN_KIND_LABELS[str(p.kind)] || str(p.kind) || "Plan", status, tone: planTone(status), statusLabel: PLAN_STATUS_LABELS[status] || str(p.status) || "—",
      steps, open: PLAN_OPEN.has(status), running, progress: { done: steps.filter((s) => s.status === "DONE").length, total: steps.length } };
  });
}
/** „Pregătește un plan nou de împachetare”: offered when the delivery stopped and no plan of it is still open. */
export function repackageState(view, { session = "open", busy = false } = {}) {
  const status = up(view?.delivery?.status);
  const open = planRows(view).some((p) => p.open);
  const offered = ["FAILED", "STALE", "NEEDS_OWNER"].includes(status) && !open;
  const gate = sessionGate(session);
  return { offered, enabled: offered && !gate.blocked && !busy, reason: offered && gate.blocked ? gate.reason : "", label: sessionLabel("Pregătește un plan nou de împachetare", session),
    note: "Primești un singur card cu pașii (captură, clip, rezumat); nimic nu pornește fără confirmarea ta." };
}

// ---------------------------------------------------------------- observations

const OBS_SEVERITY = Object.freeze({ error: ["error", "problemă", 0], warning: ["warn", "avertisment", 1], warn: ["warn", "avertisment", 1], info: ["neutral", "de știut", 2] });
export const OBSERVATION_KIND_LABELS = Object.freeze({ criterion: "criteriu", finding: "constatare de review", qa: "QA media", claim: "de verificat", disclosure: "de știut", plan: "plan", stale: "învechit", limitation: "limită" });
/** Remaining observations, most severe first (stable). `target` says where a row points: a clip moment, the summary or the software panel. */
export function observationRows(view) {
  return arr(view?.observations).filter((o) => str(o?.text).trim()).map((o, i) => {
    const [tone, label, rank] = OBS_SEVERITY[str(o.severity).toLowerCase()] || OBS_SEVERITY.info;
    const ref = obj(o.ref);
    const ms = ref.ms === null || ref.ms === undefined ? NaN : Number(ref.ms);
    const target = ref.kind === "clip" && Number.isFinite(ms) && ms >= 0 ? { kind: "clip", role: ref.role === "vertical" ? "vertical" : "master", ms: Math.round(ms), label: `mergi la ${fmtClock(ms)}` }
      : ref.kind === "summary" ? { kind: "summary", id: str(ref.id), label: "vezi în rezumat" } : ref.kind === "criterion" ? { kind: "software", id: str(ref.id), label: "vezi criteriul" } : null;
    const link = o.kind === 'correction' && deliveryHref(o.ref) ? { href: deliveryHref(o.ref), label: 'Deschide livrarea curentă' } : null;
    return { key: `${i}:${str(o.kind)}`, i, rank, tone, severityLabel: label, kind: str(o.kind), kindLabel: OBSERVATION_KIND_LABELS[str(o.kind)] || str(o.kind) || "observație", text: str(o.text).trim(), target, ...(link ? { link } : {}) };
  }).sort((a, b) => a.rank - b.rank || a.i - b.i);
}

// ---------------------------------------------------------------- the progress spine (five tiles above the six deliverables)

const TILE_STATES = Object.freeze({ done: ["ok", "gata"], working: ["info", "în lucru"], waiting: ["approval", "te așteaptă"], pending: ["neutral", "urmează"], blocked: ["warn", "blocat"], stale: ["error", "învechit"], failed: ["error", "eșuat"] });
/**
 * Five tiles — software, phone-width and desktop, clip, summary, your decisions — each in exactly ONE state with a short honest line.
 * While the delivery's plan runs, the first tile that is not done shows the running step in its own words.
 */
export function spineTiles(view) {
  const d = obj(view?.delivery);
  const status = up(d.status);
  const sw = softwareView(view);
  const shots = shotRows(view);
  const slots = clipSlots(view);
  const sum = summaryView(view);
  const running = planRows(view).find((p) => ["RUNNING", "CONFIRMED"].includes(p.status))?.running || null;
  const stale = Boolean(staleBanner(view));
  const tiles = [];
  const add = (key, title, target, state, text) => tiles.push({ key, title, target, state, tone: TILE_STATES[state][0], stateLabel: TILE_STATES[state][1], text });
  if (!sw.present) add("software", "Repar și verific", "livrare-software", status === "FAILED" ? "failed" : "pending", status === "ARMED" ? "misiunea repară și verifică acum" : "încă nu există un pachet verificat");
  else if (sw.bundle.status === "REJECTED") add("software", "Repar și verific", "livrare-software", "failed", "pachetul a fost respins");
  else if (!sw.current) add("software", "Repar și verific", "livrare-software", "stale", sw.why?.text || "nu mai corespunde codului");
  else add("software", "Repar și verific", "livrare-software", "done", `${sw.counts.pass}/${sw.counts.total} criterii cu dovadă · ${sw.bundle.id}`);
  const phone = shots.some((s) => s.phone);
  const desk = shots.some((s) => !s.phone);
  const shotFail = shots.find((s) => s.evidence.label === "FAIL" || s.evidence.label === "BLOCKED");
  if (!shots.length) add("shots", "Desktop și lățime de telefon", "livrare-capturi", "pending", "nicio captură E2E încă");
  else if (shots.some((s) => !s.current)) add("shots", "Desktop și lățime de telefon", "livrare-capturi", "stale", "capturile arată versiunea veche");
  else if (shotFail) add("shots", "Desktop și lățime de telefon", "livrare-capturi", "blocked", `${shotFail.criterion}: ${shotFail.evidence.label}`);
  else if (!phone || !desk) add("shots", "Desktop și lățime de telefon", "livrare-capturi", "blocked", !phone ? `lipsește captura la ${PHONE_WORDING}` : "lipsește captura pe desktop");
  else add("shots", "Desktop și lățime de telefon", "livrare-capturi", "done", `desktop + ${PHONE_WORDING}`);
  const present = slots.filter((s) => s.present);
  if (!present.length) add("clip", "Clip", "livrare-clip", "pending", "clipul nu a fost produs încă");
  else if (present.some((s) => s.mode === "old")) add("clip", "Clip", "livrare-clip", "stale", "clipul e pentru versiunea veche");
  else if (present.some((s) => s.qa.status === "FAIL")) add("clip", "Clip", "livrare-clip", "blocked", "QA automat a picat pe o versiune");
  else if (present.length < slots.length || present.some((s) => !s.playable)) add("clip", "Clip", "livrare-clip", "pending", "lipsește o randare (16:9 sau 9:16)");
  else add("clip", "Clip", "livrare-clip", "done", `16:9 și 9:16 · ${present[0].durationText}`);
  if (!sum.present) add("summary", "Rezumat", "livrare-rezumat", "pending", "rezumatul nu a fost generat încă");
  else if (!sum.current) add("summary", "Rezumat", "livrare-rezumat", "stale", sum.why?.text || "descrie versiunea veche");
  else add("summary", "Rezumat", "livrare-rezumat", "done", `v${sum.version ?? "?"} · ${sum.approval.state === "approved" ? "gata de prezentare" : "neaprobat încă"}`);
  if (running && status === "ACTIVE") {
    const first = tiles.find((t) => t.state === "pending");
    if (first) { first.state = "working"; first.tone = TILE_STATES.working[0]; first.stateLabel = TILE_STATES.working[1]; first.text = running.title || "planul rulează"; }
  }
  const open = pendingDecisions(view);
  if (stale) add("decisions", "Deciziile tale", "livrare-decizii", "stale", "deciziile rămase se iau pe versiunea nouă");
  else if (status !== "READY" && status !== "NEEDS_OWNER") add("decisions", "Deciziile tale", "livrare-decizii", "pending", "se deschid când livrarea e gata");
  else add("decisions", "Deciziile tale", "livrare-decizii", open ? "waiting" : "done", open ? `${open} ${open === 1 ? "decizie deschisă" : "decizii deschise"}, separate` : "nicio decizie deschisă · publicarea rămâne oprită");
  return tiles;
}

/** Everything that counts as CURRENT evidence in one place (the header line, the cockpit card and the tests read the same answer). */
export function currentEvidence(view) {
  const slots = clipSlots(view);
  return { software: softwareCurrent(view), shots: shotRows(view).filter((s) => s.current && s.src).map((s) => s.criterion), clips: slots.filter((s) => s.evidence).map((s) => s.key), summary: summaryView(view).current };
}

/** The compact cockpit card (U9b renders it): status, labels, open decisions, the stale reason and the link — from the same view. */
export function cockpitDeliveryCard(view) {
  const d = obj(view?.delivery);
  const id = deliveryRoute(d.id).deliveryId;
  const banner = staleBanner(view);
  const open = pendingDecisions(view);
  return { id, title: str(d.title) || "Livrare", href: id ? `#${deliveryHref(id)}` : null, chips: headerChips(view),
    line: banner ? `${banner.title}: ${banner.reason}` : up(d.status) === "READY" ? (open ? `${open} ${open === 1 ? "decizie separată te așteaptă" : "decizii separate te așteaptă"}` : "Nicio decizie deschisă") : statusNotice(view)?.text || "",
    pendingDecisions: banner ? 0 : open, stale: Boolean(banner) };
}
