import crypto from "node:crypto";

/**
 * M09-A2 — billing evidence. The provider-side overage setting (Claude usage credits / extra usage, Codex automatic reload)
 * cannot be read by the Hub before inference, so the route needs EVIDENCE: the owner's declaration, made in the authenticated
 * owner session and bound to the account the Hub verified, plus what the provider itself reports during a turn. Credits are
 * never inferred from a login. Everything here is pure (no database, no clock of its own): the callers pass the stored
 * evidence (`settings.billingEvidence`), the current account identity (from a fresh probe) and `now`.
 *
 * Stored shape: { [provider]: { declaration, reports: [≤ 10], reverify: { required, reasons[], since, by } | null, legacyConvertedAt? } }
 * Evidence item: { id, provider, kind: "declaration"|"provider_report", source, accountIdentity, recordedAt, expiresAt, text,
 *                  textVersion, recordedBy: { channel, actor, sessionId, credentialId10 } }
 *
 * The account identity is pseudonymous, not anonymous: an HMAC-SHA256 of the account e-mail (or, when the client reports
 * none, of a tuple of plan facts) under a random salt kept in the same database, truncated to 16 hex. The clear-text
 * identifier never leaves the adapter that read it. A tuple identity cannot tell apart two accounts on the same plan.
 */

export const IDENTITY_SCHEME = "sha256-salted:v1";
export const EVIDENCE_MAX_AGE_DAYS = 30;
/** A declaration names the account of a probe at most this old (the same freshness the gate requires). */
export const DECLARE_PROBE_MAX_AGE_H = 24;
export const MAX_REPORTS = 10;
export const EVIDENCE_REASONS = Object.freeze(["expired", "account_changed", "identity_unavailable", "text_version_changed", "latched", "legacy_unbound", "owner_withdrawn", "provider_report_overage"]);
/** Reasons that only a latch carries (each comes with "latched"). */
const LATCH_REASONS = new Set(["legacy_unbound", "owner_withdrawn", "provider_report_overage"]);

export const REASON_TEXT = Object.freeze({
  expired: "declarația a expirat (sau are o dată din viitor)",
  account_changed: "contul verificat acum nu este contul pentru care ai declarat",
  identity_unavailable: "contul curent nu poate fi identificat (rulează „Verifică contul”)",
  text_version_changed: "textul declarației s-a schimbat de la înregistrare",
  latched: "o reconfirmare este cerută",
  legacy_unbound: "declarația veche (din UI, înainte de M09) nu era legată de un cont",
  owner_withdrawn: "ai retras declarația",
  provider_report_overage: "providerul a raportat consum peste plan (usage credits / overage)",
  missing: "nu există nicio declarație",
});

const DAY_MS = 86400000;
const PROVIDERS = new Set(["codex", "claude"]);
const iso = (d) => (d instanceof Date ? d : new Date(d)).toISOString();
const validDate = (v) => { const t = typeof v === "string" || v instanceof Date ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? t : NaN; };

/** Version of a declaration text: a change of the exact text is a change of version (no manual bump to forget). */
export function textVersionOf(text) {
  if (typeof text !== "string" || !text) return "unknown";
  return `t-${crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12)}`;
}

/**
 * The pseudonymous account identity. `email` wins (basis "email"); otherwise `tuple` (basis "tuple", weak). `extra` (e.g. an
 * organisation id reported by the client) is appended in both bases. Returns null without a usable salt or any material.
 */
export function deriveAccountIdentity({ salt, email = null, tuple = [], extra = [], plan = null } = {}) {
  if (typeof salt !== "string" || salt.length < 16) return null;
  const clean = (v) => (v === null || v === undefined ? "" : String(v).trim().toLowerCase().slice(0, 320));
  const mail = typeof email === "string" ? clean(email) : "";
  const tail = (Array.isArray(extra) ? extra : []).map(clean).filter(Boolean);
  const parts = mail ? [mail, ...tail] : [...(Array.isArray(tuple) ? tuple : []).map(clean), ...tail];
  if (!parts.some(Boolean)) return null;
  const basis = mail ? "email" : "tuple";
  const value = crypto.createHmac("sha256", salt).update(`${IDENTITY_SCHEME}\n${basis}\n${parts.join("\n")}`, "utf8").digest("hex").slice(0, 16);
  return { scheme: IDENTITY_SCHEME, value, basis, plan: plan ? String(plan).slice(0, 40) : null };
}

export const sameIdentity = (a, b) => Boolean(a && b && a.scheme === b.scheme && typeof a.value === "string" && a.value === b.value);
/** What the UI shows: the first 8 hex of the pseudonym (never a clear-text identifier). */
export const shortIdentity = (identity) => (identity?.value ? String(identity.value).slice(0, 8) : null);
const cleanIdentity = (identity) => (identity && typeof identity.value === "string" && /^[0-9a-f]{16}$/.test(identity.value)
  ? { scheme: String(identity.scheme || IDENTITY_SCHEME), value: identity.value, basis: identity.basis === "email" ? "email" : "tuple", plan: identity.plan ? String(identity.plan).slice(0, 40) : null } : null);

/** One provider's evidence record, normalised (a missing or malformed record is an empty one). */
export function evidenceOf(evidence, provider) {
  const raw = evidence && typeof evidence === "object" ? evidence[provider] : null;
  const value = raw && typeof raw === "object" ? raw : {};
  return {
    declaration: value.declaration && typeof value.declaration === "object" ? value.declaration : null,
    reports: Array.isArray(value.reports) ? value.reports.slice(-MAX_REPORTS) : [],
    reverify: value.reverify && typeof value.reverify === "object" ? value.reverify : null,
    legacyConvertedAt: value.legacyConvertedAt || null,
  };
}

/** The effective expiry: the stored one, never later than recordedAt + the CURRENT maximum age. */
export function effectiveExpiry(declaration) {
  const recorded = validDate(declaration?.recordedAt);
  if (!Number.isFinite(recorded)) return NaN;
  const stored = validDate(declaration?.expiresAt);
  const cap = recorded + EVIDENCE_MAX_AGE_DAYS * DAY_MS;
  return Number.isFinite(stored) ? Math.min(stored, cap) : cap;
}

/**
 * The evidence state of a provider route: valid | reverify_required | missing, with the reasons. `identity` is the account
 * identity of the route that will run (its own probe, younger than 24 h; null otherwise); `currentText` the exact text the
 * declaration must have been made for. Unknown or absent fields never make anything valid.
 */
export function evidenceState(provider, { evidence = {}, identity = null, now = new Date(), currentText = null } = {}) {
  const record = evidenceOf(evidence, provider);
  const declaration = record.declaration;
  const latchReasons = record.reverify?.required ? ["latched", ...(Array.isArray(record.reverify.reasons) ? record.reverify.reasons : []).filter((r) => LATCH_REASONS.has(r))] : [];
  if (!PROVIDERS.has(provider)) return { state: "missing", reasons: ["missing"], declaration: null, reverify: record.reverify };
  if (!declaration) return { state: "missing", reasons: [...new Set(["missing", ...latchReasons])], declaration: null, reverify: record.reverify };
  const reasons = [];
  const t = (now instanceof Date ? now : new Date(now)).getTime();
  const recorded = validDate(declaration.recordedAt);
  const expiry = effectiveExpiry(declaration);
  if (!Number.isFinite(recorded) || recorded > t || !Number.isFinite(expiry) || t >= expiry) reasons.push("expired");
  const bound = cleanIdentity(declaration.accountIdentity);
  if (declaration.accountIdentity && !bound) reasons.push("identity_unavailable"); // a malformed stored identity never matches
  else if (bound) {
    const current = cleanIdentity(identity);
    if (!current) reasons.push("identity_unavailable");
    else if (!sameIdentity(bound, current)) reasons.push("account_changed");
  }
  if (currentText !== null && declaration.textVersion !== textVersionOf(currentText)) reasons.push("text_version_changed");
  reasons.push(...latchReasons);
  const unique = [...new Set(reasons)];
  return { state: unique.length ? "reverify_required" : "valid", reasons: unique, declaration, expiresAt: Number.isFinite(expiry) ? iso(expiry) : null, reverify: record.reverify };
}

/** A readable sentence for the reasons (Romanian, for the gate detail and the UI). */
export const describeReasons = (reasons = []) => reasons.filter((r) => r !== "latched" || reasons.length === 1).map((r) => REASON_TEXT[r] || r).join("; ");

/** The single place the gate, the router and the HTTP summary read their billing inputs from (they cannot diverge). */
export function billingInputs(settings, inspection, now = new Date()) {
  return {
    evidence: settings.get("billingEvidence") || {},
    identity: inspection?.auth?.accountIdentity || null,
    now,
    usage: inspection?.usage || null,
    reservePercent: settings.get("usageReservePercent"),
  };
}

/** A new declaration record (the caller has checked the session, the exact text and the identity). */
export function buildDeclaration({ id, provider, text, identity, now, recordedBy, source, route = "windows" }) {
  const at = now instanceof Date ? now : new Date(now);
  return {
    id, provider, kind: "declaration", source, route, accountIdentity: cleanIdentity(identity), recordedAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + EVIDENCE_MAX_AGE_DAYS * DAY_MS).toISOString(), text, textVersion: textVersionOf(text),
    recordedBy: { channel: recordedBy?.channel || null, actor: recordedBy?.actor || null, sessionId: recordedBy?.sessionId || null, credentialId10: recordedBy?.credentialId10 ? String(recordedBy.credentialId10).slice(0, 10) : null },
  };
}

const withProvider = (evidence, provider, record) => ({ ...(evidence && typeof evidence === "object" ? evidence : {}), [provider]: record });

/** Records a declaration and clears the latch (the owner re-confirmed in the owner session). */
export function applyDeclaration(evidence, provider, declaration) {
  const record = evidenceOf(evidence, provider);
  return withProvider(evidence, provider, { ...record, declaration, reverify: null, previousReverify: record.reverify?.required ? record.reverify : undefined });
}

/** Sets (or extends) the reverify latch. Fail-safe: works with or without a declaration, idempotent per reason. */
export function applyLatch(evidence, provider, { reason, now, by }) {
  if (!LATCH_REASONS.has(reason)) throw new Error(`Unknown latch reason ${reason}`);
  const record = evidenceOf(evidence, provider);
  const previous = record.reverify?.required ? record.reverify : null;
  const reasons = [...new Set([...(previous?.reasons || []), reason])];
  return withProvider(evidence, provider, { ...record, reverify: { required: true, reasons, since: previous?.since || iso(now), by: previous?.by || by, lastAt: iso(now), lastBy: by } });
}

/** Appends a provider report (bounded to the last MAX_REPORTS). */
export function appendReport(evidence, provider, report) {
  const record = evidenceOf(evidence, provider);
  return withProvider(evidence, provider, { ...record, reports: [...record.reports, report].slice(-MAX_REPORTS) });
}

/**
 * Boot conversion of the legacy `billingAttestations` (idempotent; the legacy key stays untouched for rollback). Each record
 * becomes a declaration with source "legacy_ui" and no account. Claude gets the latch `legacy_unbound`: its credits are never
 * read by the Hub, so Claude inference waits for a declaration in the owner session. Codex stays valid until its expiry (its
 * credit balance is read before every turn). An owner declaration already present is never overwritten.
 */
export function convertLegacyAttestations({ attestations = {}, evidence = {}, now = new Date() }) {
  let next = evidence && typeof evidence === "object" ? { ...evidence } : {};
  const converted = [];
  for (const provider of ["codex", "claude"]) {
    const legacy = attestations?.[provider];
    if (!legacy?.confirmedAt) continue;
    const record = evidenceOf(next, provider);
    if (record.legacyConvertedAt || record.declaration) continue;
    const recordedAt = Number.isFinite(validDate(legacy.confirmedAt)) ? new Date(legacy.confirmedAt).toISOString() : String(legacy.confirmedAt).slice(0, 40);
    const recordedMs = validDate(recordedAt);
    const declaration = {
      id: `bde_legacy_${provider}`, provider, kind: "declaration", source: "legacy_ui", route: "windows", accountIdentity: null, recordedAt,
      expiresAt: Number.isFinite(recordedMs) ? new Date(recordedMs + EVIDENCE_MAX_AGE_DAYS * DAY_MS).toISOString() : null,
      text: typeof legacy.text === "string" ? legacy.text.slice(0, 400) : null, textVersion: textVersionOf(legacy.text),
      recordedBy: { channel: "ui", actor: "legacy", sessionId: null, credentialId10: null },
    };
    next = withProvider(next, provider, { ...record, declaration, legacyConvertedAt: iso(now),
      reverify: provider === "claude" ? { required: true, reasons: ["legacy_unbound"], since: iso(now), by: "hub" } : record.reverify });
    converted.push(provider);
  }
  return { evidence: next, converted };
}

// ---------- Claude stream-json rate_limit_event (a provider report: a tripwire, never the pre-inference proof) ----------

/** The documented fields of rate_limit_info (Agent SDK; credit fields from CLI 2.1.181), plus overage names NOT yet verified live. */
const RATE_STRING = { status: 40, resetsAt: 40, rateLimitType: 40, errorCode: 60, overageStatus: 40, overageResetsAt: 40, overageDisabledReason: 80 };
const RATE_BOOL = ["canUserPurchaseCredits", "hasChargeableSavedPaymentMethod", "isUsingOverage"];
const RATE_NUMBER = ["utilization", "surpassedThreshold"];
const KNOWN_RATE_FIELDS = new Set([...Object.keys(RATE_STRING), ...RATE_BOOL, ...RATE_NUMBER]);

/** Keeps only known fields with the expected types; unknown field NAMES are listed (never their values). */
export function normalizeClaudeRateLimit(info, capturedAt = new Date().toISOString()) {
  const raw = info && typeof info === "object" && !Array.isArray(info) ? info : {};
  const out = { source: "claude stream-json rate_limit_event", capturedAt, windows: [] };
  for (const [key, max] of Object.entries(RATE_STRING)) {
    const v = raw[key];
    if (typeof v === "string") out[key] = v.slice(0, max);
    else if (typeof v === "number" && Number.isFinite(v) && (key === "resetsAt" || key === "overageResetsAt")) out[key] = new Date(v > 1e12 ? v : v * 1000).toISOString();
  }
  for (const key of RATE_BOOL) if (typeof raw[key] === "boolean") out[key] = raw[key];
  for (const key of RATE_NUMBER) if (typeof raw[key] === "number" && Number.isFinite(raw[key])) out[key] = raw[key];
  out.limitReached = out.status === "rejected";
  const unknown = Object.keys(raw).filter((k) => !KNOWN_RATE_FIELDS.has(k)).slice(0, 12).map((k) => String(k).slice(0, 40));
  if (unknown.length) out.unknownFields = unknown;
  return out;
}

/**
 * What a normalised report means. Only explicit overage signals latch the reverify (overage in use or available); a
 * `credits_required` rejection is a quota stop (the plan is exhausted and credits are off), not a reverify. Nothing here ever
 * returns "verified": absence of a signal is not evidence that credits are off.
 */
export function classifyClaudeRateLimit(snapshot) {
  const signals = [];
  if (snapshot?.isUsingOverage === true) signals.push("isUsingOverage=true");
  if (snapshot?.rateLimitType === "overage") signals.push("rateLimitType=overage");
  if (snapshot?.overageStatus === "allowed" || snapshot?.overageStatus === "allowed_warning") signals.push(`overageStatus=${snapshot.overageStatus}`);
  // Fields about credits/overage (rateLimitType alone names a window such as five_hour: not billing evidence by itself).
  const creditFields = ["errorCode", "canUserPurchaseCredits", "hasChargeableSavedPaymentMethod", "isUsingOverage", "overageStatus", "overageDisabledReason"].some((k) => snapshot?.[k] !== undefined) || snapshot?.rateLimitType === "overage";
  return { overage: signals.length > 0, signals, creditsRequired: snapshot?.errorCode === "credits_required", creditFields };
}

/** A provider-report evidence item for the stored record (no clear-text identity, bounded fields). */
export function buildProviderReport({ id, provider, source, snapshot, identity = null, now, runId = null, signals = [] }) {
  const fields = {};
  for (const key of [...Object.keys(RATE_STRING), ...RATE_BOOL, ...RATE_NUMBER, "unknownFields"]) if (snapshot?.[key] !== undefined) fields[key] = snapshot[key];
  return { id, provider, kind: "provider_report", source, accountIdentity: cleanIdentity(identity), recordedAt: iso(now), expiresAt: null, text: null, textVersion: null,
    recordedBy: { channel: "provider", actor: runId ? `run:${runId}` : "provider", sessionId: null, credentialId10: null }, fields, signals: signals.slice(0, 5) };
}

/** The evidence summary the HTTP layer returns (pseudonyms shortened; nothing else). */
export function evidenceSummary(provider, { evidence, identity, now, currentText }) {
  const state = evidenceState(provider, { evidence, identity, now, currentText });
  const record = evidenceOf(evidence, provider);
  const d = record.declaration;
  return {
    state: state.state, reasons: state.reasons, reasonText: describeReasons(state.reasons),
    declaration: d ? { id: d.id, source: d.source, route: d.route || "windows", recordedAt: d.recordedAt, expiresAt: state.expiresAt || d.expiresAt || null, textVersion: d.textVersion,
      identity: d.accountIdentity ? { short: shortIdentity(d.accountIdentity), basis: d.accountIdentity.basis, plan: d.accountIdentity.plan || null } : null,
      recordedBy: { channel: d.recordedBy?.channel || null, sessionId: d.recordedBy?.sessionId || null } } : null,
    reverify: record.reverify?.required ? { reasons: record.reverify.reasons || [], since: record.reverify.since || null, by: record.reverify.by || null } : null,
    reports: record.reports.slice(-3).map((r) => ({ source: r.source, recordedAt: r.recordedAt, signals: r.signals || [], status: r.fields?.status || null, errorCode: r.fields?.errorCode || null })),
    currentIdentity: identity?.value ? { value: identity.value, short: shortIdentity(identity), basis: identity.basis, plan: identity.plan || null } : null,
    maxAgeDays: EVIDENCE_MAX_AGE_DAYS,
  };
}
