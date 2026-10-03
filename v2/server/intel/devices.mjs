import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";

/**
 * Personal Mission Control (M08 §18): a compact phone view over the same control plane. A phone has its OWN pairing and session —
 * it never inherits the PC's Windows Hello session — with explicit, revocable permissions. In M08 a paired device may VIEW and use
 * the FAIL-SAFE controls (Stop all, pause or stop a mission); anything that adds authority (confirming a plan, accepting a bundle,
 * raising autonomy) needs the owner's own authenticated session on that device (its own passkey), which this milestone does not
 * create. Device commands go through the ordinary command bus on the "companion" channel with actor device:<id>, are idempotent
 * (a retried key returns the first result) and carry the state version the phone saw: a command built on a stale view is refused
 * instead of being replayed later. Nothing here opens the Hub to the network: it listens on localhost; a phone needs an approved
 * connection that this milestone does not configure (no port forward, no public tunnel, no paid service).
 */
export const DEVICE_PERMISSIONS = Object.freeze(["view", "stop_all", "pause_mission", "stop_mission"]);
export const DEVICE_COOKIE = "ifrim_device";
const PAIRING_TTL_MS = 10 * 60 * 1000;
const MAX_PAIRING_ATTEMPTS = 5;
const STALE_COMMAND_MS = 2 * 60 * 1000;
const hash = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");

export function createDevices({ db, bus, clock, commands, factory, envelopes, warroom }) {
  const iso = (d = clock()) => d.toISOString();
  const rowTo = (r) => r && ({ id: r.id, label: r.label, permissions: parse(r.permissions_json, []), pairedBy: r.paired_by, createdAt: r.created_at, lastSeenAt: r.last_seen_at, revokedAt: r.revoked_at, revokedBy: r.revoked_by });

  /** Starts a pairing from the owner's authenticated session on the PC: a 6-digit code valid for 10 minutes, shown once. */
  function startPairing({ ownerSession, actor }) {
    if (!ownerSession) throw new HubError("authentication", "Asocierea unui telefon pornește din sesiunea ta de proprietar (Windows Hello)");
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    const id = newId("dpr");
    const t = clock();
    bus.transaction(() => {
      db.prepare("UPDATE device_pairings SET consumed_at = ? WHERE consumed_at IS NULL AND created_by = ?").run(iso(t), String(actor).slice(0, 80)); // one live code at a time
      db.prepare("INSERT INTO device_pairings (id, code_hash, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").run(id, hash(code), String(actor).slice(0, 80), new Date(t.getTime() + PAIRING_TTL_MS).toISOString(), iso(t));
      bus.append({ type: "device.pairing_started", scopeType: "device", scopeId: id, source: actor, payload: { expiresInS: PAIRING_TTL_MS / 1000 } });
    });
    return { pairingId: id, code, expiresAt: new Date(t.getTime() + PAIRING_TTL_MS).toISOString(), permissions: DEVICE_PERMISSIONS,
      note: "Introdu codul pe telefon. Telefonul primește doar vizualizare și opriri; confirmările cer sesiunea ta pe acel dispozitiv." };
  }

  /** The phone presents the code: a device and its token (returned once; only its hash is stored). */
  function pair({ code, label = "Telefon" }) {
    const c = String(code || "").replace(/\D/g, "");
    if (c.length !== 6) throw new HubError("validation", "Codul are 6 cifre");
    const live = db.prepare("SELECT * FROM device_pairings WHERE consumed_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1").get(iso());
    if (!live) throw new HubError("authentication", "Niciun cod de asociere valid; pornește asocierea din nou pe PC");
    if (live.attempts >= MAX_PAIRING_ATTEMPTS) throw new HubError("authentication", "Prea multe încercări; pornește asocierea din nou pe PC");
    const ok = crypto.timingSafeEqual(Buffer.from(hash(c)), Buffer.from(live.code_hash));
    if (!ok) {
      bus.transaction(() => db.prepare("UPDATE device_pairings SET attempts = attempts + 1 WHERE id = ?").run(live.id));
      throw new HubError("authentication", "Cod greșit");
    }
    const token = crypto.randomBytes(32).toString("base64url");
    const id = newId("dev");
    bus.transaction(() => {
      db.prepare("INSERT INTO devices (id, label, token_hash, permissions_json, paired_by, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, String(label).slice(0, 60) || "Telefon", hash(token), json(DEVICE_PERMISSIONS), live.created_by, iso(), iso());
      db.prepare("UPDATE device_pairings SET consumed_at = ?, device_id = ? WHERE id = ?").run(iso(), id, live.id);
      bus.append({ type: "device.paired", scopeType: "device", scopeId: id, source: `device:${id}`, payload: { label: String(label).slice(0, 60) } });
    });
    return { device: rowTo(db.prepare("SELECT * FROM devices WHERE id = ?").get(id)), token };
  }

  /** The device behind a token, or null (revoked or unknown). Touches last_seen_at at most once a minute. */
  function authenticate(token) {
    if (!token) return null;
    const row = db.prepare("SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL").get(hash(token));
    if (!row) return null;
    if (!row.last_seen_at || clock() - new Date(row.last_seen_at) > 60000) db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(iso(), row.id);
    return rowTo(row);
  }

  function revoke(deviceId, { actor, ownerSession = null, device = null }) {
    const row = db.prepare("SELECT * FROM devices WHERE id = ?").get(deviceId);
    if (!row) throw new HubError("not_found", "Dispozitiv necunoscut");
    // The owner revokes any device; a device may revoke only itself (fail-safe).
    if (!ownerSession && device?.id !== deviceId) throw new HubError("authentication", "Revocarea se face din sesiunea ta sau de pe dispozitivul însuși");
    if (row.revoked_at) return rowTo(row);
    bus.transaction(() => {
      db.prepare("UPDATE devices SET revoked_at = ?, revoked_by = ? WHERE id = ?").run(iso(), String(actor).slice(0, 80), deviceId);
      bus.append({ type: "device.revoked", scopeType: "device", scopeId: deviceId, source: actor, payload: {} });
    });
    return rowTo(db.prepare("SELECT * FROM devices WHERE id = ?").get(deviceId));
  }

  /** The compact state a phone shows; `serverTime` lets it mark itself stale when updates stop. */
  function mobileState() {
    const missions = factory.list();
    const pick = (f) => ({ missionId: f.missionId, title: f.title, stage: f.stage, reason: String(f.stageReason || "").slice(0, 160), projectId: f.projectId });
    const lastEvent = db.prepare("SELECT seq FROM events ORDER BY seq DESC LIMIT 1").get()?.seq || 0;
    return {
      serverTime: iso(), stateVersion: lastEvent,
      running: missions.filter((f) => !["DELIVERY_READY", "ACCEPTED", "REJECTED", "CANCELLED", "SPEC_DRAFT", "PAUSED", "NEEDS_OWNER_DECISION", "BLOCKED"].includes(f.stage)).map(pick),
      blocked: missions.filter((f) => ["PAUSED", "NEEDS_OWNER_DECISION", "BLOCKED"].includes(f.stage)).map(pick),
      ready: missions.filter((f) => f.stage === "DELIVERY_READY").map(pick),
      decisions: envelopes.pending().map((e) => ({ envelopeId: e.id, headline: e.summary?.headline, where: "PC (sesiunea ta)" })),
      incidents: warroom.list({ open: true }).map((i) => ({ incidentId: i.id, title: i.title, status: i.status, impactConfirmed: Boolean(i.impactConfirmed) })),
      permissions: DEVICE_PERMISSIONS,
    };
  }

  const DEVICE_COMMANDS = { stop_all: "system.stop_all", pause_mission: "factory.pause", stop_mission: "factory.stop" };
  /**
   * A fail-safe command from the phone. Idempotent per key; refused when built on a view older than 2 minutes (a queued tap is not
   * replayed after a disconnection). Goes through the ordinary command bus (channel "companion", actor device:<id>).
   */
  async function command(device, { type, missionId = null, idempotencyKey, observedAt }) {
    if (!device) throw new HubError("authentication", "Dispozitiv neasociat sau revocat");
    if (!DEVICE_COMMANDS[type]) throw new HubError("policy", "De pe telefon: doar Stop tot, pauză sau oprire de misiune. Confirmările cer sesiunea ta de proprietar.");
    if (!device.permissions.includes(type)) throw new HubError("policy", "Dispozitivul nu are această permisiune");
    const key = String(idempotencyKey || "").slice(0, 120);
    if (key.length < 8) throw new HubError("validation", "Comanda cere o cheie de idempotență");
    const prior = db.prepare("SELECT * FROM device_commands WHERE idempotency_key = ?").get(key);
    if (prior) {
      if (prior.device_id !== device.id) throw new HubError("conflict", "Cheie folosită de alt dispozitiv");
      return { duplicate: true, result: parse(prior.result_json, null) };
    }
    const seen = new Date(observedAt || 0);
    if (Number.isNaN(seen.getTime()) || clock() - seen > STALE_COMMAND_MS) throw new HubError("conflict", "Starea de pe telefon e veche; reîmprospătează înainte de comandă (nu trimit o comandă dintr-o coadă veche)");
    if (type !== "stop_all" && !missionId) throw new HubError("validation", "Care misiune?");
    const result = await commands.dispatch({ type: DEVICE_COMMANDS[type], channel: "companion", actor: `device:${device.id}`, payload: type === "stop_all" ? { reason: "Stop de pe telefon" } : type === "stop_mission" ? { missionId, reason: "Oprit de pe telefon" } : { missionId } });
    const summary = { type, missionId, at: iso(), ok: true, commandId: result.command?.id || null };
    bus.transaction(() => db.prepare("INSERT INTO device_commands (idempotency_key, device_id, type, result_json, created_at) VALUES (?, ?, ?, ?, ?)").run(key, device.id, type, json(summary), iso()));
    return { duplicate: false, result: summary };
  }

  const list = () => db.prepare("SELECT * FROM devices ORDER BY created_at DESC").all().map(rowTo);
  return { startPairing, pair, authenticate, revoke, mobileState, command, list, permissions: DEVICE_PERMISSIONS };
}
