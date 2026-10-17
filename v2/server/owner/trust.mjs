import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { b64url, verifyRegistration, verifyAssertion } from "./webauthn.mjs";
import { DEV_CREDENTIAL_PREFIX, DEV_SESSION_HOURS, isDevCredential } from "./dev-profile.mjs";

/**
 * Trusted owner session (M06 §07) and the versioned product policy (M06 §02, §21).
 *
 * - Authentication is WebAuthn (Windows Hello, PIN, a security key): the OS runs the ceremony, the Hub verifies challenge,
 *   origin, RP ID, UP/UV flags and the signature. The voice is never an authentication factor here (NIST SP 800-63B-4 does
 *   not accept voice biometrics); the local speaker gate only filters what reaches the assistant.
 * - A session has an id, the credential that opened it, the origin, an absolute expiry, an idle timeout, a re-authentication
 *   time for sensitive steps and can be revoked. The browser holds an HttpOnly cookie; the database keeps only its hash.
 * - The policy starts as "legacy" (every effect needs its own UI click, as in M01–M05). "voice_first" is activated only by
 *   the owner in a freshly re-authenticated session, with the exact text; deactivating it is fail-safe from any channel.
 *   Historical approvals and audit rows are never rewritten.
 */
export const OWNER_POLICY_VERSION = 1;
export const OWNER_POLICY_TEXT = "Activez politica voice-first: într-o sesiune autentificată cu autentificatorul meu confirm o singură dată planul exact al unei misiuni, iar Hub-ul emite intern granturile tehnice doar în limitele lui. Vocea nu mă autentifică. Deploy, bani, acces, instalări, ștergeri și trimiteri externe cer în continuare o confirmare separată.";
export const OWNER_SETUP_TEXT = "Înregistrez autentificatorul acestui calculator pentru sesiunea mea de proprietar în Hub.";
// rotateMinutes: a re-authentication in the last minutes of a session opens a NEW session (new cookie, full lifetime) instead of
// renewing one that is about to end (M10.1: "open your session again" must actually help, e.g. for a Lega start).
export const SESSION_DEFAULTS = Object.freeze({ maxHours: 8, idleMinutes: 30, reauthMinutes: 5, challengeSeconds: 120, rotateMinutes: 10 });
export const SESSION_COOKIE = "ifrim_owner";
const MAX_CREDENTIALS = 5;

export function createTrust({ db, bus, clock, settings, config, devProfile = () => ({ enabled: false, reason: "absent" }) }) {
  const now = () => clock();
  const iso = (d = now()) => d.toISOString();
  const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");
  const rowToCredential = (row) => row && ({ id: row.id, label: row.label, publicKey: parse(row.public_key_jwk, {}), alg: row.alg, signCount: row.sign_count, aaguid: row.aaguid,
    transports: parse(row.transports_json, []), userVerified: Boolean(row.uv_initialized), backupEligible: Boolean(row.backup_eligible), attestationFmt: row.attestation_fmt,
    rpId: row.rp_id, origin: row.origin, status: row.status, createdAt: row.created_at, lastUsedAt: row.last_used_at, revokedAt: row.revoked_at });
  const rowToSession = (row) => row && ({ id: row.id, credentialId: row.credential_id, origin: row.origin, policyVersion: row.policy_version, userVerified: Boolean(row.user_verified),
    status: row.status, createdAt: row.created_at, lastSeenAt: row.last_seen_at, expiresAt: row.expires_at, reauthAt: row.reauth_at, revokedAt: row.revoked_at,
    revokeReason: row.revoke_reason, userAgent: row.user_agent });
  const activeCredentials = () => db.prepare("SELECT * FROM owner_credentials WHERE status = 'active' ORDER BY created_at").all().map(rowToCredential);
  // Stage before M12: the local development profile is a credential of its own kind (never a WebAuthn one): active only while the
  // instance's profile file is on, names this machine and account, and carries the same id.
  const devCredential = (id) => {
    const p = devProfile();
    return { id, label: "Profil de dezvoltare locală", kind: "dev_profile", publicKey: null, userVerified: false, status: p.enabled && id === `${DEV_CREDENTIAL_PREFIX}${p.id}` ? "active" : "revoked" };
  };
  const credential = (id) => (isDevCredential(id) ? devCredential(id) : rowToCredential(db.prepare("SELECT * FROM owner_credentials WHERE id = ?").get(id)));

  /** WebAuthn needs a domain RP ID: the Hub's origin on "localhost" (an IP address such as 127.0.0.1 cannot be an RP ID). */
  function relyingParty(origin) {
    const expected = `http://localhost:${config.port}`;
    if (origin !== expected) {
      throw new HubError("policy", `Sesiunea de proprietar se deschide doar de pe ${expected} (WebAuthn nu acceptă o adresă IP ca identitate a site-ului)`, { data: { expectedOrigin: expected } });
    }
    return { rpId: "localhost", origin: expected, name: "Ifrim Agent Hub" };
  }

  function ownerUserId() {
    const current = settings.get("ownerIdentity") || {};
    if (current.userId) return current.userId;
    const value = { userId: b64url.encode(crypto.randomBytes(16)), createdAt: iso() };
    bus.transaction(() => settings.set("ownerIdentity", value, "hub", "Owner WebAuthn user handle created"));
    return value.userId;
  }

  function issueChallenge(kind, purpose, origin) {
    const challenge = b64url.encode(crypto.randomBytes(32));
    const id = newId("chl");
    const t = now();
    db.prepare("INSERT INTO owner_challenges (id, kind, challenge, purpose, origin, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, kind, challenge, purpose, origin, new Date(t.getTime() + SESSION_DEFAULTS.challengeSeconds * 1000).toISOString(), iso(t));
    // Old challenges are pruned (they are single-use and short-lived).
    db.prepare("DELETE FROM owner_challenges WHERE expires_at < ?").run(new Date(t.getTime() - 3600000).toISOString());
    return { id, challenge };
  }

  /** Takes a challenge exactly once; an expired, unknown, reused or mismatched one is refused. */
  function takeChallenge(id, kind, origin) {
    const row = db.prepare("SELECT * FROM owner_challenges WHERE id = ?").get(String(id || ""));
    if (!row || row.kind !== kind) throw new HubError("policy", "Provocare necunoscută; începe din nou");
    if (row.origin !== origin) throw new HubError("policy", "Provocarea a fost emisă pentru alt origin");
    if (row.used_at) throw new HubError("policy", "Provocarea a fost deja folosită (răspuns reluat)");
    if (new Date(row.expires_at) <= now()) throw new HubError("policy", "Provocarea a expirat; încearcă din nou");
    const changed = db.prepare("UPDATE owner_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL").run(iso(), row.id).changes;
    if (changed !== 1) throw new HubError("policy", "Provocarea a fost deja folosită (răspuns reluat)");
    return row;
  }

  // ---------- registration ----------
  /**
   * The first credential is the bootstrap: the owner types the setup text in the Hub UI (the same trust as every earlier UI
   * consent). Every later credential needs a freshly re-authenticated session, so a process that only knows the per-boot
   * API token cannot add its own authenticator once one exists.
   */
  function beginRegistration({ origin, setupText = "", session = null }) {
    const rp = relyingParty(origin);
    const existing = activeCredentials();
    if (existing.length >= MAX_CREDENTIALS) throw new HubError("policy", `Cel mult ${MAX_CREDENTIALS} autentificatoare; revocă unul înainte`);
    if (existing.length === 0) {
      if (setupText !== OWNER_SETUP_TEXT) throw new HubError("validation", "Textul de configurare nu corespunde");
    } else requireFresh(session, "adăugarea unui autentificator");
    const { id, challenge } = issueChallenge("register", existing.length ? "add" : "bootstrap", rp.origin);
    return { challengeId: id, publicKey: {
      challenge, rp: { id: rp.rpId, name: rp.name },
      user: { id: ownerUserId(), name: "proprietar", displayName: "Proprietar Ifrim Hub" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }, { type: "public-key", alg: -8 }],
      authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
      attestation: "none", timeout: SESSION_DEFAULTS.challengeSeconds * 1000,
      excludeCredentials: existing.map((c) => ({ type: "public-key", id: c.id, transports: c.transports })),
    } };
  }

  function finishRegistration({ origin, challengeId, credential: response, label = "", actor = "owner" }) {
    const rp = relyingParty(origin);
    const row = takeChallenge(challengeId, "register", rp.origin);
    const result = verifyRegistration(response, { challenge: row.challenge, origin: rp.origin, rpId: rp.rpId });
    if (credential(result.credentialId)) throw new HubError("conflict", "Credențialul este deja înregistrat");
    const name = String(label || "").replace(/\s+/g, " ").trim().slice(0, 60) || (result.transports.includes("internal") ? "Autentificatorul calculatorului" : "Cheie de securitate");
    bus.transaction(() => {
      db.prepare(`INSERT INTO owner_credentials (id, label, public_key_jwk, alg, sign_count, aaguid, transports_json, uv_initialized, backup_eligible, attestation_fmt, rp_id, origin, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`).run(result.credentialId, name, json(result.publicKey), result.alg, result.signCount, result.aaguid || "",
        json(result.transports), result.userVerified ? 1 : 0, result.backupEligible ? 1 : 0, result.attestation.fmt, rp.rpId, rp.origin, iso());
      bus.append({ type: "owner.credential_registered", scopeType: "owner", scopeId: "credentials", source: actor,
        payload: { credential: result.credentialId.slice(0, 10), label: name, alg: result.alg, purpose: row.purpose, attestation: result.attestation.verified } });
    });
    return { credentialId: result.credentialId, label: name, alg: result.alg, attestation: result.attestation };
  }

  // ---------- authentication & sessions ----------
  function beginAuthentication({ origin, purpose = "unlock" }) {
    const rp = relyingParty(origin);
    const creds = activeCredentials();
    if (!creds.length) throw new HubError("policy", "Niciun autentificator înregistrat; configurează întâi sesiunea de proprietar");
    const { id, challenge } = issueChallenge("authenticate", String(purpose).slice(0, 40), rp.origin);
    return { challengeId: id, publicKey: { challenge, rpId: rp.rpId, userVerification: "required", timeout: SESSION_DEFAULTS.challengeSeconds * 1000,
      allowCredentials: creds.map((c) => ({ type: "public-key", id: c.id, transports: c.transports })) } };
  }

  /**
   * A verified assertion opens a session, or re-authenticates the current one (same browser cookie) for a sensitive step.
   * Returns the raw token once (for the cookie); the database keeps only its hash.
   */
  function finishAuthentication({ origin, challengeId, credential: response, currentToken = null, userAgent = "" }) {
    const rp = relyingParty(origin);
    const row = takeChallenge(challengeId, "authenticate", rp.origin);
    const stored = credential(String(response?.rawId || response?.id || ""));
    if (!stored || stored.status !== "active") throw new HubError("policy", "Credențial necunoscut sau revocat");
    const result = verifyAssertion(response, { challenge: row.challenge, origin: rp.origin, rpId: rp.rpId, stored });
    const t = now();
    const policyVersion = settings.get("ownerPolicy")?.version || 0;
    const existing = currentToken ? resolveRow(currentToken, rp.origin) : null;
    const nearEnd = Boolean(existing) && Date.parse(existing.expires_at) - t.getTime() < SESSION_DEFAULTS.rotateMinutes * 60000;
    return bus.transaction(() => {
      db.prepare("UPDATE owner_credentials SET sign_count = ?, last_used_at = ? WHERE id = ?").run(result.signCount, iso(t), stored.id);
      if (existing && nearEnd) {
        // Rotation: the old session ends (audited) and a new one is issued below, in the same transaction.
        const n = db.prepare("UPDATE owner_sessions SET status = 'ended', revoked_at = ?, revoke_reason = 'rotated' WHERE id = ? AND status = 'active'").run(iso(t), existing.id).changes;
        if (n) bus.append({ type: "owner.session_ended", scopeType: "owner", scopeId: existing.id, source: "owner", payload: { reason: "rotated" } });
      } else if (existing && existing.credential_id === stored.id) {
        db.prepare("UPDATE owner_sessions SET reauth_at = ?, last_seen_at = ? WHERE id = ?").run(iso(t), iso(t), existing.id);
        bus.append({ type: "owner.session_reauthenticated", scopeType: "owner", scopeId: existing.id, source: "owner", payload: { purpose: row.purpose } });
        return { sessionId: existing.id, token: null, expiresAt: existing.expires_at, reauthAt: iso(t), renewed: true };
      }
      const token = b64url.encode(crypto.randomBytes(32));
      const id = newId("osn");
      const expiresAt = new Date(t.getTime() + SESSION_DEFAULTS.maxHours * 3600000).toISOString();
      db.prepare(`INSERT INTO owner_sessions (id, token_hash, credential_id, origin, policy_version, user_verified, status, created_at, last_seen_at, expires_at, reauth_at, user_agent)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`).run(id, hashToken(token), stored.id, rp.origin, policyVersion, result.userVerified ? 1 : 0, iso(t), iso(t), expiresAt, iso(t), String(userAgent).slice(0, 200));
      bus.append({ type: "owner.session_opened", scopeType: "owner", scopeId: id, source: "owner", payload: { credential: stored.id.slice(0, 10), purpose: row.purpose, expiresAt } });
      return { sessionId: id, token, expiresAt, reauthAt: iso(t), renewed: false };
    });
  }

  function resolveRow(token, origin) {
    if (!token || typeof token !== "string" || token.length > 200) return null;
    const row = db.prepare("SELECT * FROM owner_sessions WHERE token_hash = ?").get(hashToken(token));
    if (!row || row.status !== "active") return null;
    if (origin && row.origin !== origin) return null;
    const t = now();
    if (new Date(row.expires_at) <= t) { expireSession(row.id, "expired"); return null; }
    // A dev-profile session does not idle out (the page would reopen it without a dialog anyway); its absolute expiry still holds.
    if (!isDevCredential(row.credential_id) && t.getTime() - new Date(row.last_seen_at).getTime() > SESSION_DEFAULTS.idleMinutes * 60000) { expireSession(row.id, "idle"); return null; }
    const cred = credential(row.credential_id);
    if (!cred || cred.status !== "active") { expireSession(row.id, "credential-revoked"); return null; }
    return row;
  }

  function expireSession(id, reason) {
    bus.transaction(() => {
      const changed = db.prepare("UPDATE owner_sessions SET status = 'ended', revoked_at = ?, revoke_reason = ? WHERE id = ? AND status = 'active'").run(iso(), reason, id).changes;
      if (changed) bus.append({ type: "owner.session_ended", scopeType: "owner", scopeId: id, source: "hub", payload: { reason } });
    });
  }

  /** The session behind a cookie (or null). Touches the idle timer. */
  function resolveSession(token, { origin = null, touch = true } = {}) {
    const row = resolveRow(token, origin);
    if (!row) return null;
    if (touch) db.prepare("UPDATE owner_sessions SET last_seen_at = ? WHERE id = ?").run(iso(), row.id);
    return describe(rowToSession(db.prepare("SELECT * FROM owner_sessions WHERE id = ?").get(row.id)));
  }

  function describe(s) {
    if (!s) return null;
    const t = now().getTime();
    // A dev-profile session has no ceremony to be "fresh" from: its authority is the instance profile, re-read at every check.
    if (isDevCredential(s.credentialId)) return { ...s, authority: "local_dev_profile", fresh: true, freshUntil: s.expiresAt, idleExpiresAt: s.expiresAt };
    const freshUntil = new Date(new Date(s.reauthAt).getTime() + SESSION_DEFAULTS.reauthMinutes * 60000).toISOString();
    return { ...s, authority: "webauthn", fresh: t < Date.parse(freshUntil), freshUntil, idleExpiresAt: new Date(Date.parse(s.lastSeenAt) + SESSION_DEFAULTS.idleMinutes * 60000).toISOString() };
  }

  /** A session must exist (re-read from the database: a revoked one fails even with a cached object). */
  function requireSession(session, what = "această acțiune") {
    const row = session?.id ? db.prepare("SELECT * FROM owner_sessions WHERE id = ?").get(session.id) : null;
    // A dev-profile session ends as soon as the instance's profile is off (or names another machine, account or id).
    const devOff = Boolean(row) && isDevCredential(row.credential_id) && credential(row.credential_id).status !== "active";
    if (devOff && row.status === "active") expireSession(row.id, "dev-profile-off");
    if (!row || devOff || row.status !== "active" || new Date(row.expires_at) <= now()) throw new HubError("authentication", `Pentru ${what} deschide sesiunea de proprietar (Windows Hello / cheia ta)`);
    return describe(rowToSession(row));
  }
  function requireFresh(session, what) {
    const s = requireSession(session, what);
    if (!s.fresh) throw new HubError("authentication", `Pentru ${what} confirmă din nou cu autentificatorul (ultima verificare e mai veche de ${SESSION_DEFAULTS.reauthMinutes} minute)`, { data: { reauth: true } });
    return s;
  }

  // ---------- the local development profile (stage before M12) ----------
  /**
   * Opens an owner session from the instance's local development profile: no WebAuthn ceremony, user_verified = 0, credential
   * "devprofile:<id>", authority local_dev_profile in every event. Only for the canonical localhost origin (the HTTP layer adds: a loopback
   * peer, a same-origin request, the per-boot token, never the agent or CLI channels). Refused while the profile is off.
   */
  function openDevSession({ origin, userAgent = "", currentToken = null }) {
    const rp = relyingParty(origin);
    const p = devProfile();
    if (!p.enabled) throw new HubError("policy", `Profilul de dezvoltare locală nu este activ pe această instanță (${p.reason || "absent"}).`, { code: "DEV_PROFILE_OFF" });
    const credentialId = `${DEV_CREDENTIAL_PREFIX}${p.id}`;
    const existing = currentToken ? resolveRow(currentToken, rp.origin) : null;
    if (existing && existing.credential_id === credentialId) return { sessionId: existing.id, token: null, expiresAt: existing.expires_at, renewed: true, authority: "local_dev_profile" };
    const t = now();
    const token = b64url.encode(crypto.randomBytes(32));
    const id = newId("osn");
    const expiresAt = new Date(t.getTime() + DEV_SESSION_HOURS * 3600000).toISOString();
    const policyVersion = settings.get("ownerPolicy")?.version || 0;
    bus.transaction(() => {
      db.prepare(`INSERT INTO owner_sessions (id, token_hash, credential_id, origin, policy_version, user_verified, status, created_at, last_seen_at, expires_at, reauth_at, user_agent)
        VALUES (?, ?, ?, ?, ?, 0, 'active', ?, ?, ?, ?, ?)`).run(id, hashToken(token), credentialId, rp.origin, policyVersion, iso(t), iso(t), expiresAt, iso(t), String(userAgent).slice(0, 200));
      bus.append({ type: "owner.session_opened", scopeType: "owner", scopeId: id, source: "hub", payload: { authority: "local_dev_profile", profile: p.id, machine: p.machine, user: p.user, userVerified: false, expiresAt } });
    });
    return { sessionId: id, token, expiresAt, renewed: false, authority: "local_dev_profile" };
  }

  /**
   * Stage before M12 (the owner's decision of 2026-10-09: „expirarea sesiunii UI nu trebuie confundată cu revocarea autorizației unei
   * misiuni deja aprobate”): the authority a confirmation gave outlives the browser. A session that ended because the page idled, expired,
   * logged out or rotated keeps backing what it ALREADY confirmed, bounded by that plan's own time limit, action budget, Stop, pause and
   * cancel. A security revocation ends it: the authenticator revoked, every session revoked, the development profile turned off. It never
   * opens anything new: new confirmations still need an open session (requireSession).
   */
  const ENDED_KEEPS_AUTHORITY = new Set(["idle", "expired", "logout", "rotated"]);
  /**
   * M12 review R5/R11 (DP-05 „a revoked authenticator or revoke-all end it”, one rule in one place): „Închide toate sesiunile” is a
   * revocation also for a session that had ALREADY ended by idle, expiry, logout or rotation (its row is no longer active, so revoke-all
   * cannot rewrite it). Such a session keeps no authority once an owner.sessions_revoked event (any count, written even with no session
   * open) follows its opening. Event order (seq), never the clock: it holds with a fixed clock and in the same millisecond.
   */
  function revokedAfterOpening(sessionId) {
    const opened = Number(db.prepare("SELECT MAX(seq) AS seq FROM events WHERE scope_type = 'owner' AND scope_id = ? AND type = 'owner.session_opened'").get(String(sessionId))?.seq || 0);
    return Boolean(db.prepare("SELECT 1 FROM events WHERE scope_type = 'owner' AND scope_id = 'sessions' AND type = 'owner.sessions_revoked' AND seq > ? LIMIT 1").get(opened));
  }
  function confirmedAuthority(sessionId) {
    const row = sessionId ? db.prepare("SELECT * FROM owner_sessions WHERE id = ?").get(String(sessionId)) : null;
    if (!row) return { ok: false, reason: "unknown-session" };
    const cred = credential(row.credential_id);
    if (!cred || cred.status !== "active") return { ok: false, reason: isDevCredential(row.credential_id) ? "dev-profile-off" : "credential-revoked" };
    if (row.status === "active" && new Date(row.expires_at) > now()) return { ok: true, sessionOpen: true };
    if (row.status === "active" || ENDED_KEEPS_AUTHORITY.has(String(row.revoke_reason || ""))) {
      if (revokedAfterOpening(row.id)) return { ok: false, reason: "revocare-toate-sesiunile", endedBecause: row.status === "active" ? "expired" : row.revoke_reason };
      return { ok: true, sessionOpen: false, endedBecause: row.status === "active" ? "expired" : row.revoke_reason };
    }
    return { ok: false, reason: String(row.revoke_reason || "revoked") };
  }

  function endSession(session, reason = "logout", actor = "owner") {
    if (!session?.id) return { ended: false };
    const changed = bus.transaction(() => {
      const n = db.prepare("UPDATE owner_sessions SET status = 'ended', revoked_at = ?, revoke_reason = ? WHERE id = ? AND status = 'active'").run(iso(), reason, session.id).changes;
      if (n) bus.append({ type: "owner.session_ended", scopeType: "owner", scopeId: session.id, source: actor, payload: { reason } });
      return n;
    });
    return { ended: changed === 1 };
  }

  /**
   * Ends every open session. The event is written even when none was open (count 0): revoke-all is also the security boundary
   * for decisions confirmed earlier in a session that has since ended by logout or idle (M12 review P1-F1: a Sales decision
   * made before it must not execute after it). Its listeners only re-check what they hold (Lega's derived voice session).
   */
  function revokeAllSessions(reason, actor = "owner") {
    return bus.transaction(() => {
      const ids = db.prepare("SELECT id FROM owner_sessions WHERE status = 'active'").all().map((r) => r.id);
      db.prepare("UPDATE owner_sessions SET status = 'ended', revoked_at = ?, revoke_reason = ? WHERE status = 'active'").run(iso(), reason);
      bus.append({ type: "owner.sessions_revoked", scopeType: "owner", scopeId: "sessions", source: actor, payload: { count: ids.length, reason } });
      return ids.length;
    });
  }

  function revokeCredential(id, session) {
    requireFresh(session, "revocarea unui autentificator");
    return bus.transaction(() => {
      const changed = db.prepare("UPDATE owner_credentials SET status = 'revoked', revoked_at = ? WHERE id = ? AND status = 'active'").run(iso(), id).changes;
      if (!changed) throw new HubError("not_found", "Autentificator necunoscut sau deja revocat");
      const sessions = db.prepare("UPDATE owner_sessions SET status = 'ended', revoked_at = ?, revoke_reason = 'credential-revoked' WHERE credential_id = ? AND status = 'active'").run(iso(), id).changes;
      bus.append({ type: "owner.credential_revoked", scopeType: "owner", scopeId: "credentials", source: "owner", payload: { credential: id.slice(0, 10), sessionsEnded: sessions } });
      return { revoked: true, sessionsEnded: sessions };
    });
  }

  // ---------- product policy ----------
  const policy = () => {
    const value = settings.get("ownerPolicy") || {};
    return value.mode === "voice_first" && value.version === OWNER_POLICY_VERSION ? { ...value, active: true } : { mode: "legacy", active: false, previous: value.mode === "voice_first" ? value : null };
  };

  function activatePolicy({ session, text }) {
    const s = requireFresh(session, "activarea politicii voice-first");
    if (text !== OWNER_POLICY_TEXT) throw new HubError("validation", "Textul politicii nu corespunde");
    const value = { mode: "voice_first", version: OWNER_POLICY_VERSION, activatedAt: iso(), sessionId: s.id, credentialId: s.credentialId.slice(0, 10), text: OWNER_POLICY_TEXT };
    bus.transaction(() => settings.set("ownerPolicy", value, "owner", "Voice-first policy activated in an authenticated owner session"));
    return policy();
  }

  /** Fail-safe: any channel may return to the legacy policy (it only removes authority). */
  function deactivatePolicy(actor = "owner", reason = "") {
    bus.transaction(() => settings.set("ownerPolicy", { mode: "legacy", version: OWNER_POLICY_VERSION, deactivatedAt: iso(), by: actor, reason: String(reason).slice(0, 200) }, actor, "Back to the legacy policy"));
    return policy();
  }

  function status(session = null) {
    const creds = activeCredentials();
    return {
      policy: policy(), policyText: OWNER_POLICY_TEXT, policyVersion: OWNER_POLICY_VERSION, setupText: OWNER_SETUP_TEXT,
      origin: `http://localhost:${config.port}`, rpId: "localhost", defaults: SESSION_DEFAULTS,
      credentials: creds.map((c) => ({ id: c.id, short: c.id.slice(0, 10), label: c.label, alg: c.alg, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt, attestationFmt: c.attestationFmt, backupEligible: c.backupEligible })),
      bootstrapNeeded: creds.length === 0,
      devProfile: (() => { const p = devProfile(); return p.enabled ? { enabled: true, id: p.id, machine: p.machine, user: p.user, enabledAt: p.enabledAt } : { enabled: false, reason: p.reason || "absent" }; })(),
      session: session ? describe(session) : null,
      activeSessions: db.prepare("SELECT COUNT(*) AS n FROM owner_sessions WHERE status = 'active' AND expires_at > ?").get(iso()).n,
    };
  }

  return { openDevSession, confirmedAuthority, devProfile, relyingParty, beginRegistration, finishRegistration, beginAuthentication, finishAuthentication, resolveSession, requireSession, requireFresh,
    endSession, revokeAllSessions, revokeCredential, policy, activatePolicy, deactivatePolicy, status, credential, activeCredentials };
}
