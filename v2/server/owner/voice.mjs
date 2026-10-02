import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";

/**
 * SpeakerVerifier + profile store (M06 §08–§10).
 *
 * 1:1 verification against the ONE profile the owner enrolled explicitly; never identification of people in the room.
 * The browser captures and analyses audio locally and sends only summary features of a speech segment (no audio); the
 * Hub compares them with the profile kept in the private data folder (separate from LLM memory, never in the general
 * audit) and answers MATCH, NON_MATCH, INSUFFICIENT_AUDIO or UNCERTAIN.
 *
 * The built-in verifier is a BASELINE (MFCC statistics + cosine). It has no calibrated error rates: it is a convenience
 * filter for what reaches the assistant, it is labelled as such, and its MATCH never grants authority on its own
 * (`eligibleForAuthority: false`). A stronger local model (e.g. an ECAPA/WeSpeaker embedding) needs the owner's install
 * approval and plugs in behind the same interface. Voice is never an authentication factor (NIST SP 800-63B-4).
 */
export const VOICE_CONSENT_VERSION = 1;
export const VOICE_CONSENT_TEXT = "Înregistrez local un profil al vocii mele, folosit doar ca filtru înainte ca vocea să ajungă la Lega. Nu este autentificare. Audio-ul brut nu se păstrează după înscriere, profilul nu pleacă de pe acest calculator și îl pot șterge oricând.";
export const VERIFIER = Object.freeze({ id: "mfcc-stats-baseline-v1", eligibleForAuthority: false, calibrated: false,
  description: "Statistici MFCC (medie și dispersie) + similaritate cosinus; fără rate de eroare măsurate pe populație" });
export const VOICE_RESULTS = Object.freeze(["MATCH", "NON_MATCH", "INSUFFICIENT_AUDIO", "UNCERTAIN"]);
const ENROLL = Object.freeze({ minSamples: 5, maxSamples: 12, minSpeechMs: 1800, minSnrDb: 10, maxClipping: 0.01 });
const VERIFY = Object.freeze({ minSpeechMs: 800, minSnrDb: 6, uncertainBand: 0.08 });
const DIM_MIN = 8; const DIM_MAX = 256;

function checkFeatures(f, label) {
  if (!f || typeof f !== "object") throw new HubError("validation", `${label}: caracteristici lipsă`);
  const emb = f.embedding;
  if (!Array.isArray(emb) || emb.length < DIM_MIN || emb.length > DIM_MAX || emb.some((x) => typeof x !== "number" || !Number.isFinite(x))) throw new HubError("validation", `${label}: vector invalid`);
  for (const k of ["speechMs", "snrDb", "clipping"]) if (typeof f[k] !== "number" || !Number.isFinite(f[k])) throw new HubError("validation", `${label}: ${k} lipsă`);
  return { embedding: emb, speechMs: f.speechMs, snrDb: f.snrDb, clipping: f.clipping, dims: emb.length };
}
const norm = (v) => { const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1; return v.map((x) => x / n); };
const cosine = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 1) s += a[i] * b[i]; return s; };
const mean = (vs) => vs[0].map((_, i) => vs.reduce((s, v) => s + v[i], 0) / vs.length);

export function createVoice({ db, bus, clock, settings, config, trust }) {
  const dir = path.join(config.dataDir, "voice");
  const iso = () => clock().toISOString();
  const rowTo = (r) => r && ({ id: r.id, version: r.version, verifier: r.verifier, status: r.status, samples: r.samples, quality: parse(r.quality_json, {}), calibration: parse(r.calibration_json, {}), createdAt: r.created_at, revokedAt: r.revoked_at });
  const active = () => rowTo(db.prepare("SELECT * FROM voice_profiles WHERE status = 'active' ORDER BY created_at DESC LIMIT 1").get());
  const fileOf = (id) => path.join(dir, `profile-${id}.json`);
  const readVectors = (id) => { try { return JSON.parse(fs.readFileSync(fileOf(id), "utf8")); } catch { return null; } };

  /** Enrolment: consent, several guided samples, quality checks, a versioned profile. Needs the owner session. */
  function enroll({ samples, consentText, session }) {
    trust.requireSession(session, "înscrierea profilului vocal");
    if (consentText !== VOICE_CONSENT_TEXT) throw new HubError("validation", "Textul acordului nu corespunde");
    if (!Array.isArray(samples) || samples.length < ENROLL.minSamples || samples.length > ENROLL.maxSamples) throw new HubError("validation", `Sunt necesare ${ENROLL.minSamples}–${ENROLL.maxSamples} mostre`);
    const checked = samples.map((s, i) => checkFeatures(s, `mostra ${i + 1}`));
    const dims = checked[0].dims;
    if (checked.some((c) => c.dims !== dims)) throw new HubError("validation", "Mostrele au dimensiuni diferite");
    const problems = [];
    checked.forEach((c, i) => {
      if (c.speechMs < ENROLL.minSpeechMs) problems.push(`mostra ${i + 1}: vorbire prea scurtă (${Math.round(c.speechMs)} ms)`);
      if (c.snrDb < ENROLL.minSnrDb) problems.push(`mostra ${i + 1}: prea mult zgomot (${c.snrDb.toFixed(1)} dB)`);
      if (c.clipping > ENROLL.maxClipping) problems.push(`mostra ${i + 1}: semnal saturat`);
    });
    if (problems.length) throw new HubError("validation", `Calitate insuficientă: ${problems.slice(0, 4).join("; ")}`, { data: { problems } });
    const vectors = checked.map((c) => norm(c.embedding));
    const centroid = norm(mean(vectors));
    // Leave-one-out scores: how close each sample is to the profile built from the others (the only calibration available).
    const loo = vectors.map((v, i) => cosine(v, norm(mean(vectors.filter((_, j) => j !== i)))));
    const minLoo = Math.min(...loo);
    const matchAt = Math.max(0.5, minLoo - 0.02);
    const calibration = { method: "leave-one-out pe mostrele tale", samples: vectors.length, matchAt: Number(matchAt.toFixed(4)), rejectBelow: Number((matchAt - VERIFY.uncertainBand).toFixed(4)), populationErrorRates: "nemăsurate" };
    const id = newId("vpr");
    const version = (db.prepare("SELECT MAX(version) AS v FROM voice_profiles").get().v || 0) + 1;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fileOf(id), JSON.stringify({ id, verifier: VERIFIER.id, dims, centroid, createdAt: iso() }), { mode: 0o600 });
    bus.transaction(() => {
      db.prepare("UPDATE voice_profiles SET status = 'superseded' WHERE status = 'active'").run();
      db.prepare(`INSERT INTO voice_profiles (id, version, verifier, status, samples, quality_json, calibration_json, file_ref, consent_version, created_at) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`)
        .run(id, version, VERIFIER.id, vectors.length, json({ speechMs: checked.map((c) => Math.round(c.speechMs)), snrDb: checked.map((c) => Math.round(c.snrDb)) }), json(calibration), path.basename(fileOf(id)), VOICE_CONSENT_VERSION, iso());
      settings.set("voiceGate", { ...settings.get("voiceGate"), profileId: id }, "owner", "Voice profile enrolled");
      bus.append({ type: "voice.profile_enrolled", scopeType: "owner", scopeId: "voice", source: "owner", payload: { profileId: id, version, samples: vectors.length, verifier: VERIFIER.id } });
    });
    // Older profile files are removed: a superseded profile is not kept.
    for (const name of fs.readdirSync(dir)) if (name.startsWith("profile-") && name !== path.basename(fileOf(id))) { try { fs.rmSync(path.join(dir, name)); } catch { /* retried at next enrolment */ } }
    return { profile: rowTo(db.prepare("SELECT * FROM voice_profiles WHERE id = ?").get(id)), verifier: VERIFIER };
  }

  /**
   * One segment → a decision. Flags from the browser's local checks (Lega's own voice in the microphone, a virtual or
   * loop-back device, playback-like bandwidth) make the result UNCERTAIN or NON_MATCH and never "authorize".
   */
  function verify({ features, flags = {} }) {
    const profile = active();
    if (!profile) return { result: "UNCERTAIN", reason: "Niciun profil înscris", authority: false, verifier: VERIFIER.id };
    const vectors = readVectors(profile.id);
    if (!vectors?.centroid) return { result: "UNCERTAIN", reason: "Profilul nu poate fi citit; refă înscrierea", authority: false, verifier: VERIFIER.id };
    const f = checkFeatures(features, "segment");
    if (f.dims !== vectors.dims) return { result: "UNCERTAIN", reason: "Caracteristicile nu corespund profilului (altă versiune)", authority: false, verifier: VERIFIER.id };
    const suspicious = [];
    if (flags.legaOverlap > 0.3 || flags.envelopeCorrelation > 0.6) suspicious.push("vocea Lega se aude în microfon");
    if (flags.virtualDevice) suspicious.push("dispozitiv audio virtual / loopback");
    if (flags.playbackLike) suspicious.push("spectru tipic redării dintr-un difuzor");
    let result; let reason;
    if (f.speechMs < VERIFY.minSpeechMs || f.snrDb < VERIFY.minSnrDb) { result = "INSUFFICIENT_AUDIO"; reason = f.speechMs < VERIFY.minSpeechMs ? "segment prea scurt" : "prea mult zgomot"; }
    else {
      const score = cosine(norm(f.embedding), vectors.centroid);
      result = score >= profile.calibration.matchAt ? "MATCH" : score < profile.calibration.rejectBelow ? "NON_MATCH" : "UNCERTAIN";
      reason = result === "MATCH" ? "apropiat de profilul tău" : result === "NON_MATCH" ? "diferit de profilul tău" : "zonă de incertitudine";
    }
    if (suspicious.length && result === "MATCH") { result = flags.virtualDevice || flags.envelopeCorrelation > 0.6 ? "NON_MATCH" : "UNCERTAIN"; reason = `semnale suspecte: ${suspicious.join(", ")}`; }
    return { result, reason, flags: suspicious, authority: false, verifier: VERIFIER.id, calibrated: VERIFIER.calibrated, profileVersion: profile.version };
  }

  function remove({ session, reason = "la cererea ta" }) {
    trust.requireSession(session, "ștergerea profilului vocal");
    const current = active();
    bus.transaction(() => {
      db.prepare("UPDATE voice_profiles SET status = 'revoked', revoked_at = ? WHERE status IN ('active','superseded')").run(iso());
      settings.set("voiceGate", { ...settings.get("voiceGate"), enabled: false, profileId: null }, "owner", "Voice profile deleted");
      bus.append({ type: "voice.profile_deleted", scopeType: "owner", scopeId: "voice", source: "owner", payload: { profileId: current?.id || null, reason: String(reason).slice(0, 120) } });
    });
    try { if (fs.existsSync(dir)) for (const name of fs.readdirSync(dir)) if (name.startsWith("profile-")) fs.rmSync(path.join(dir, name)); } catch { /* reported by status */ }
    return status();
  }

  function setGate({ enabled, strict, session }) {
    trust.requireSession(session, "schimbarea filtrului vocal");
    if (enabled && !active()) throw new HubError("validation", "Înscrie întâi profilul vocal");
    const value = { ...settings.get("voiceGate"), enabled: Boolean(enabled), strict: strict === undefined ? settings.get("voiceGate").strict !== false : Boolean(strict) };
    bus.transaction(() => settings.set("voiceGate", value, "owner", "Voice gate settings"));
    return status();
  }

  function status() {
    const profile = active();
    const gate = settings.get("voiceGate") || {};
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.startsWith("profile-")).length : 0;
    return { verifier: VERIFIER, consentText: VOICE_CONSENT_TEXT, consentVersion: VOICE_CONSENT_VERSION, enroll: ENROLL, gate: { enabled: Boolean(gate.enabled), strict: gate.strict !== false },
      profile: profile ? { id: profile.id, version: profile.version, samples: profile.samples, createdAt: profile.createdAt, calibration: { method: profile.calibration.method, populationErrorRates: profile.calibration.populationErrorRates } } : null,
      storedFiles: files, localTranscription: { available: false, reason: "Nicio transcriere locală instalată (cere aprobarea pachetului vocal); confirmarea vocală a misiunilor rămâne blocată" } };
  }

  return { enroll, verify, remove, setGate, status, hashFeatures: (f) => crypto.createHash("sha256").update(JSON.stringify(f)).digest("hex").slice(0, 12) };
}
