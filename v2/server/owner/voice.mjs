import fs from "node:fs";
import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { decodePcm16, analyseQuality, sha256, normalize, cosine, centroidOf, isLikelyHallucination, trimToSpeech, pcm16ToBuffer, VOICE_SAMPLE_RATE } from "./audio.mjs";
import { resolveIntent, normalize as normalizeText } from "./intents.mjs";

/**
 * Local voice (M06 profile store, M07 server-side engines).
 *
 * The owner's authenticated page sends each speech segment to the Hub as raw PCM (16 kHz mono); the HUB measures its quality,
 * computes the speaker embedding with a local model (3D-Speaker CAM++) and — only for the owner's matched speech — transcribes
 * it locally (whisper.cpp, Romanian). The decision and the transcript are held server-side in a `voice_utterances` row; a voice
 * confirmation must point to that row, so no client can claim "verified locally" any more. The audio itself is never stored
 * (only its SHA-256), other people's speech is never transcribed, and the profile is a single centroid in the private data
 * folder (never in Git, never sent to a provider).
 *
 * Voice is a FILTER and a convenience, never an authentication factor (NIST SP 800-63B-4): the authority is the WebAuthn owner
 * session; a speaker MATCH only lets a sentence through to Lega or count as the spoken form of a confirmation the session is
 * already allowed to make. Results: MATCH, NON_MATCH, UNCERTAIN, INSUFFICIENT_AUDIO — the score itself is never returned.
 */
export const VOICE_CONSENT_VERSION = 2;
export const VOICE_CONSENT_TEXT = "Înregistrez local un profil al vocii mele, folosit doar ca filtru înainte ca vocea să ajungă la Lega și ca formă vorbită a confirmărilor din sesiunea mea autentificată. Nu este autentificare. Audio-ul se analizează doar pe acest calculator și nu se păstrează; profilul nu pleacă de pe acest calculator și îl pot șterge oricând.";
export const VERIFIER = Object.freeze({ id: "campplus-voxceleb-v1", eligibleForAuthority: false, calibrated: "doar pe mostrele tale (fără voci negative autorizate)",
  description: "3D-Speaker CAM++ (VoxCeleb, 512 dimensiuni, Apache-2.0) prin sherpa-onnx, similaritate cosinus față de profilul tău; rulează local" });
export const VOICE_RESULTS = Object.freeze(["MATCH", "NON_MATCH", "INSUFFICIENT_AUDIO", "UNCERTAIN"]);
export const VOICE_PURPOSES = Object.freeze(["gate", "confirm", "probe"]);
/** Guided enrolment: varied Romanian sentences (diacritics, names the owner says, a negation, a short confirmation). */
export const ENROLL_PHRASES = Object.freeze([
  "Lega, deschide cockpitul proiectului de test.",
  "Arată-mi planul înainte să pornești ceva.",
  "Da, execută planul afișat acum.",
  "Nu porni încă, vreau să văd diferențele.",
  "Hai să lucrăm la ProDelivery, dar fără deploy.",
  "Oprește tot și spune-mi ce s-a întâmplat.",
  "Ce a găsit Claude în review-ul de azi?",
  "Pauză. Taci un moment, te rog.",
]);
const ENROLL = Object.freeze({ minSamples: 5, maxSamples: 8, minSpeechMs: 1200, minSnrDb: 12, maxClipping: 0.01, minPhraseMatch: 0.5, draftMinutes: 20 });
// Calibrated on the real pipeline (CAM++ cosine, browser capture, silence trimmed; M07 live enrolment): one speaker's samples
// agree at ~0.5–0.85 leave-one-out; CAM++'s reference threshold is ~0.39. A sample under minConsistency is an outlier.
const VERIFY = Object.freeze({ minSpeechMs: 600, minSnrDb: 6, floorMatch: 0.35, ceilMatch: 0.55, margin: 0.1, rejectGap: 0.1, rejectMax: 0.28, minConsistency: 0.45 });
const UTTERANCE_TTL_MS = 2 * 60000; // a spoken "yes" counts for this long, once
const RATE = Object.freeze({ perMinute: 40 });

/** Word overlap of what was heard and what was shown (diacritics and punctuation ignored): 0..1. */
export function phraseMatch(heard, expected) {
  const words = (s) => normalizeText(s).replace(/[^a-z0-9\s-]+/g, " ").split(/\s+/).filter((w) => w.length > 1);
  const want = words(expected);
  const got = new Set(words(heard));
  if (!want.length) return 0;
  return want.filter((w) => got.has(w)).length / want.length;
}

export function createVoice({ db, bus, clock, settings, config, trust, engine }) {
  // The profile (a voice template) lives next to the engines, under the user's profile — NOT in the project's .ifrim/private,
  // which sits inside a OneDrive-synced folder and would leave this computer (review M07). Tests keep it in their data dir.
  const dir = config.voiceProfileDir || (config.testMode || !engine.paths?.root ? path.join(config.dataDir, "voice") : path.join(engine.paths.root, "profiles"));
  const iso = () => clock().toISOString();
  const now = () => clock().getTime();
  const rowTo = (r) => r && ({ id: r.id, version: r.version, verifier: r.verifier, status: r.status, samples: r.samples, quality: parse(r.quality_json, {}), calibration: parse(r.calibration_json, {}), createdAt: r.created_at, revokedAt: r.revoked_at });
  // Only a profile of THIS verifier counts: an M06 baseline profile (another feature space) is not comparable.
  const active = () => rowTo(db.prepare("SELECT * FROM voice_profiles WHERE status = 'active' AND verifier = ? ORDER BY created_at DESC LIMIT 1").get(VERIFIER.id));
  const fileOf = (id) => path.join(dir, `profile-${id}.json`);
  const readProfile = (id) => { try { return JSON.parse(fs.readFileSync(fileOf(id), "utf8")); } catch { return null; } };
  const drafts = new Map(); // owner session id → { samples: [{ embedding, quality, phraseIndex, match }], startedAt }
  const rate = new Map(); // owner session id → [timestamps]
  // A profile of an earlier verifier left active (M06) is superseded at start-up and the gate it fed is turned off: the owner
  // re-enrols once instead of every segment silently coming back UNCERTAIN.
  try {
    const stale = db.prepare("SELECT id FROM voice_profiles WHERE status = 'active' AND verifier != ?").all(VERIFIER.id);
    if (stale.length) bus.transaction(() => {
      db.prepare("UPDATE voice_profiles SET status = 'superseded' WHERE status = 'active' AND verifier != ?").run(VERIFIER.id);
      if (settings.get("voiceGate")?.enabled) settings.set("voiceGate", { ...settings.get("voiceGate"), enabled: false, profileId: null }, "hub", "Voice profile of an earlier verifier: re-enrolment needed");
      bus.append({ type: "voice.profile_stale", scopeType: "owner", scopeId: "voice", source: "hub", payload: { profiles: stale.map((r) => r.id), verifier: VERIFIER.id } });
    });
  } catch { /* a database without the table is migrated before this runs */ }
  const utteranceRow = (r) => r && ({ id: r.id, ownerSessionId: r.owner_session_id, purpose: r.purpose, legaSessionId: r.lega_session_id, envelopeId: r.envelope_id,
    durationMs: r.duration_ms, speechMs: r.speech_ms, snrDb: r.snr_db, audioSha256: r.audio_sha256, result: r.speaker_result, reason: r.speaker_reason, verifier: r.verifier,
    profileId: r.profile_id, profileVersion: r.profile_version, flags: parse(r.flags_json, []), transcript: r.transcript, transcriptStatus: r.transcript_status,
    sttEngine: r.stt_engine, sttMs: r.stt_ms, svMs: r.sv_ms, consumedBy: r.consumed_by, consumedAt: r.consumed_at, expiresAt: r.expires_at, createdAt: r.created_at });

  function limit(session) {
    const list = (rate.get(session.id) || []).filter((t) => now() - t < 60000);
    if (list.length >= RATE.perMinute) throw new HubError("conflict", "Prea multe segmente vocale într-un minut; așteaptă puțin");
    list.push(now());
    rate.set(session.id, list);
  }

  /**
   * Quality, embedding and (optionally) transcript of one segment, all computed here. The speaker model sees ONLY the spoken
   * part (silence trimmed: silence makes every embedding alike); the transcription engine gets the whole segment.
   */
  async function measure(buffer, { transcribe }) {
    const pcm = decodePcm16(buffer);
    const quality = analyseQuality(pcm);
    const audioSha256 = sha256(buffer);
    const speech = trimToSpeech(pcm);
    const out = await engine.analyze(speech.length === pcm.length ? buffer : pcm16ToBuffer(speech), { embed: true, transcribe: false });
    if (!Array.isArray(out.embedding) || !out.embedding.length) throw new HubError("tool", "Modelul de vorbitor nu a produs un rezultat (segment prea scurt?)");
    let transcript = null; let sttMs = null; let sttEngine = null;
    if (transcribe) {
      const t = await engine.analyze(buffer, { embed: false, transcribe: true });
      transcript = typeof t.transcript === "string" ? t.transcript.trim().slice(0, 500) : "";
      if (isLikelyHallucination(transcript, quality)) transcript = "";
      sttMs = t.sttMs ?? null; sttEngine = t.sttEngine || null;
    }
    return { quality, audioSha256, embedding: normalize(out.embedding), transcript, sttMs, svMs: out.svMs ?? null, sttEngine };
  }

  // ---------- enrolment (guided, server-side; the samples' audio is never kept) ----------
  function draftOf(session) {
    const d = drafts.get(session.id);
    if (d && now() - d.startedAt > ENROLL.draftMinutes * 60000) { drafts.delete(session.id); return null; }
    return d || null;
  }

  async function enrollSample({ session, buffer, phraseIndex }) {
    trust.requireSession(session, "înscrierea profilului vocal");
    const index = Number(phraseIndex);
    if (!Number.isInteger(index) || index < 0 || index >= ENROLL_PHRASES.length) throw new HubError("validation", "Fraza de înscriere e necunoscută");
    let draft = draftOf(session);
    if (!draft) { draft = { samples: [], startedAt: now() }; drafts.set(session.id, draft); }
    if (draft.samples.length >= ENROLL.maxSamples) throw new HubError("validation", `Ai deja ${ENROLL.maxSamples} mostre; finalizează sau reia`);
    limit(session);
    const m = await measure(buffer, { transcribe: true });
    const problems = [];
    if (m.quality.speechMs < ENROLL.minSpeechMs) problems.push(`vorbire prea scurtă (${m.quality.speechMs} ms)`);
    if (m.quality.snrDb < ENROLL.minSnrDb) problems.push(`prea mult zgomot (${m.quality.snrDb} dB)`);
    if (m.quality.clipping > ENROLL.maxClipping) problems.push("semnal saturat (prea aproape de microfon / volum prea mare)");
    const match = m.transcript ? phraseMatch(m.transcript, ENROLL_PHRASES[index]) : 0;
    if (match < ENROLL.minPhraseMatch) problems.push("nu am recunoscut fraza afișată");
    if (draft.samples.some((x) => x.audioSha256 === m.audioSha256)) problems.push("aceeași înregistrare a fost deja trimisă");
    const accepted = problems.length === 0;
    if (accepted) draft.samples.push({ embedding: m.embedding, quality: m.quality, phraseIndex: index, match, audioSha256: m.audioSha256 });
    // The heard text goes back to the owner (who just spoke it); it is not stored.
    return { accepted, problems, heard: m.transcript || "", phraseMatch: Number(match.toFixed(2)), quality: m.quality, samples: draft.samples.length, needed: ENROLL.minSamples, sttMs: m.sttMs, sttEngine: m.sttEngine };
  }

  function enrollReset({ session }) {
    trust.requireSession(session, "înscrierea profilului vocal");
    drafts.delete(session.id);
    return { samples: 0, needed: ENROLL.minSamples };
  }

  /** The profile: centroid of the accepted samples, calibrated on them (leave-one-out); older profiles removed. */
  function enrollFinish({ session, consentText }) {
    trust.requireSession(session, "înscrierea profilului vocal");
    if (consentText !== VOICE_CONSENT_TEXT) throw new HubError("validation", "Textul acordului nu corespunde");
    const draft = draftOf(session);
    const samples = draft?.samples || [];
    if (samples.length < ENROLL.minSamples) throw new HubError("validation", `Sunt necesare cel puțin ${ENROLL.minSamples} mostre acceptate (ai ${samples.length})`);
    const vectors = samples.map((s) => s.embedding);
    const centroid = centroidOf(vectors);
    const loo = vectors.map((v, i) => cosine(v, centroidOf(vectors.filter((_, j) => j !== i))));
    const minLoo = Math.min(...loo);
    // Samples that do not agree with each other (another voice in one of them, a very different microphone) would only lower
    // the threshold: the least consistent one is dropped and that phrase is asked again, instead of saving a weak profile.
    if (minLoo < VERIFY.minConsistency) {
      const worst = loo.indexOf(minLoo);
      const removed = samples.splice(worst, 1)[0];
      throw new HubError("validation", `Mostrele nu se potrivesc destul între ele (consecvență ${minLoo.toFixed(2)}); am eliminat mostra pentru „${ENROLL_PHRASES[removed.phraseIndex]}” — înregistreaz-o din nou, în aceleași condiții`, { data: { droppedPhrase: removed.phraseIndex } });
    }
    const matchAt = Math.min(VERIFY.ceilMatch, Math.max(VERIFY.floorMatch, minLoo - VERIFY.margin));
    const rejectBelow = Math.min(VERIFY.rejectMax, matchAt - VERIFY.rejectGap);
    const calibration = { method: "leave-one-out pe mostrele tale (CAM++)", samples: vectors.length, looMin: Number(minLoo.toFixed(3)), looMean: Number((loo.reduce((a, b) => a + b, 0) / loo.length).toFixed(3)),
      matchAt: Number(matchAt.toFixed(3)), rejectBelow: Number(rejectBelow.toFixed(3)), negatives: "nemăsurate: fără mostre de la alte voci autorizate", populationErrorRates: "nemăsurate pe vocea ta" };
    const id = newId("vpr");
    const version = (db.prepare("SELECT MAX(version) AS v FROM voice_profiles").get().v || 0) + 1;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fileOf(id), JSON.stringify({ id, verifier: VERIFIER.id, dims: centroid.length, centroid, createdAt: iso() }), { mode: 0o600 });
    bus.transaction(() => {
      db.prepare("UPDATE voice_profiles SET status = 'superseded' WHERE status = 'active'").run();
      db.prepare(`INSERT INTO voice_profiles (id, version, verifier, status, samples, quality_json, calibration_json, file_ref, consent_version, created_at) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`)
        .run(id, version, VERIFIER.id, vectors.length, json({ speechMs: samples.map((s) => s.quality.speechMs), snrDb: samples.map((s) => s.quality.snrDb), phraseMatch: samples.map((s) => Number(s.match.toFixed(2))) }),
          json(calibration), path.basename(fileOf(id)), VOICE_CONSENT_VERSION, iso());
      settings.set("voiceGate", { ...settings.get("voiceGate"), profileId: id }, "owner", "Voice profile enrolled");
      bus.append({ type: "voice.profile_enrolled", scopeType: "owner", scopeId: "voice", source: "owner", payload: { profileId: id, version, samples: vectors.length, verifier: VERIFIER.id } });
    });
    drafts.delete(session.id);
    for (const name of fs.readdirSync(dir)) if (name.startsWith("profile-") && name !== path.basename(fileOf(id))) { try { fs.rmSync(path.join(dir, name)); } catch { /* retried at next enrolment */ } }
    return { profile: rowTo(db.prepare("SELECT * FROM voice_profiles WHERE id = ?").get(id)), verifier: VERIFIER, calibration };
  }

  // ---------- one segment → a server-held decision ----------
  function decide(m, profile, centroid, flags) {
    const suspicious = [];
    if (Number(flags.legaOverlap) > 0.3 || Number(flags.envelopeCorrelation) > 0.6) suspicious.push("vocea Lega se aude în microfon");
    if (flags.virtualDevice === true) suspicious.push("dispozitiv audio virtual / loopback");
    if (flags.playbackLike === true) suspicious.push("spectru tipic redării dintr-un difuzor");
    let result; let reason;
    if (m.quality.speechMs < VERIFY.minSpeechMs || m.quality.snrDb < VERIFY.minSnrDb) { result = "INSUFFICIENT_AUDIO"; reason = m.quality.speechMs < VERIFY.minSpeechMs ? "segment prea scurt" : "prea mult zgomot"; }
    else {
      const score = cosine(m.embedding, centroid);
      // The ceiling also applies to a profile calibrated earlier with a higher one (short confirmations score lower than the
      // 2–4 s enrolment phrases: measured on the live owner flow).
      const matchAt = Math.min(profile.calibration.matchAt, VERIFY.ceilMatch);
      result = score >= matchAt ? "MATCH" : score < profile.calibration.rejectBelow ? "NON_MATCH" : "UNCERTAIN";
      reason = result === "MATCH" ? "apropiat de profilul tău" : result === "NON_MATCH" ? "diferit de profilul tău" : "zonă de incertitudine";
    }
    // The page's own checks can only lower a result, never raise it.
    if (suspicious.length && result === "MATCH") { result = flags.virtualDevice === true || Number(flags.envelopeCorrelation) > 0.6 ? "NON_MATCH" : "UNCERTAIN"; reason = `semnale suspecte: ${suspicious.join(", ")}`; }
    return { result, reason, suspicious };
  }

  /**
   * POST /api/voice/utterances. "gate": the strict filter before Lega's cloud route (transcribed only when it is the owner,
   * asynchronously); "confirm": the spoken answer to the plan shown (transcribed synchronously; carries the envelope id);
   * "probe": the check right after enrolment. Every row belongs to the owner session that sent it.
   */
  async function analyzeUtterance({ session, buffer, purpose, legaSessionId = null, envelopeId = null, flags = {} }) {
    const s = trust.requireSession(session, "verificarea vocii");
    if (!VOICE_PURPOSES.includes(purpose)) throw new HubError("validation", "Scop necunoscut pentru segmentul vocal");
    if (purpose === "confirm" && !envelopeId) throw new HubError("validation", "Confirmarea vocală trebuie legată de planul afișat");
    limit(s);
    const profile = active();
    const stored = profile ? readProfile(profile.id) : null;
    const id = newId("utt");
    const base = { id, owner_session_id: s.id, purpose, lega_session_id: legaSessionId ? String(legaSessionId).slice(0, 80) : null, envelope_id: envelopeId ? String(envelopeId).slice(0, 80) : null };
    let m;
    let decision;
    if (!profile || !stored?.centroid) {
      const pcm = decodePcm16(buffer);
      const quality = analyseQuality(pcm);
      m = { quality, audioSha256: sha256(buffer), transcript: null, sttMs: null, svMs: null, sttEngine: null };
      decision = { result: "UNCERTAIN", reason: profile ? "Profilul nu poate fi citit; refă înscrierea" : "Niciun profil vocal înscris", suspicious: [] };
    } else {
      // The speaker decision comes FIRST, without transcription: speech that is not the owner's is never turned into text.
      m = await measure(buffer, { transcribe: false });
      decision = stored.centroid.length !== m.embedding.length
        ? { result: "UNCERTAIN", reason: "Profilul vine de la alt verificator; refă înscrierea", suspicious: [] }
        : decide(m, profile, stored.centroid, flags || {});
      // Only then, for the owner's matched speech where the answer needs the words (confirm, probe), the local transcript.
      if (decision.result === "MATCH" && purpose !== "gate") {
        const out = await engine.analyze(buffer, { embed: false, transcribe: true });
        let text = String(out.transcript || "").trim().slice(0, 500);
        if (isLikelyHallucination(text, m.quality)) text = "";
        m = { ...m, transcript: text, sttMs: out.sttMs ?? null, sttEngine: out.sttEngine || null };
      }
    }
    const created = iso(); // the decision time (after the local analysis), which the bypass check compares with
    // Only the owner's matched speech is ever transcribed and kept as text.
    const transcript = decision.result === "MATCH" && m.transcript !== null ? m.transcript : null;
    const transcriptStatus = decision.result !== "MATCH" ? "skipped" : purpose === "gate" ? "pending" : transcript ? "final" : "empty";
    db.prepare(`INSERT INTO voice_utterances (id, owner_session_id, purpose, lega_session_id, envelope_id, duration_ms, speech_ms, snr_db, sample_rate, audio_sha256, speaker_result, speaker_reason,
      verifier, profile_id, profile_version, flags_json, transcript, transcript_status, stt_engine, stt_ms, sv_ms, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, base.owner_session_id, purpose, base.lega_session_id, base.envelope_id, m.quality.durationMs, m.quality.speechMs, m.quality.snrDb, VOICE_SAMPLE_RATE, m.audioSha256,
        decision.result, decision.reason, VERIFIER.id, profile?.id || null, profile?.version || null, json(decision.suspicious), transcript, transcriptStatus,
        transcript !== null ? m.sttEngine : null, transcript !== null ? m.sttMs : null, m.svMs, new Date(now() + UTTERANCE_TTL_MS).toISOString(), created, created);
    bus.emit({ type: "voice.utterance", scopeType: "owner", scopeId: "voice", source: "owner", payload: { id, purpose, result: decision.result, transcriptStatus, legaSessionId: base.lega_session_id } });
    // The gate's text follows on its own (Lega already heard the sentence once released); it feeds the bypass check.
    if (purpose === "gate" && decision.result === "MATCH") {
      engine.analyze(buffer, { embed: false, transcribe: true }).then((out) => {
        let text = String(out.transcript || "").trim().slice(0, 500);
        if (isLikelyHallucination(text, m.quality)) text = "";
        db.prepare("UPDATE voice_utterances SET transcript = ?, transcript_status = ?, stt_engine = ?, stt_ms = ?, updated_at = ? WHERE id = ?").run(text || null, text ? "final" : "empty", out.sttEngine || null, out.sttMs ?? null, iso(), id);
      }).catch(() => { try { db.prepare("UPDATE voice_utterances SET transcript_status = 'failed', updated_at = ? WHERE id = ?").run(iso(), id); } catch { /* closing */ } });
    }
    return { utteranceId: id, purpose, result: decision.result, reason: decision.reason, flags: decision.suspicious, transcript: purpose === "gate" ? null : transcript, final: transcriptStatus !== "pending",
      transcriptStatus, sttMs: transcript !== null ? m.sttMs : null, svMs: m.svMs, quality: { speechMs: m.quality.speechMs, snrDb: m.quality.snrDb }, authority: false, verifier: VERIFIER.id, profileVersion: profile?.version || null };
  }

  function getUtterance({ id, session }) {
    const s = trust.requireSession(session, "citirea segmentului vocal");
    const row = utteranceRow(db.prepare("SELECT * FROM voice_utterances WHERE id = ?").get(String(id)));
    if (!row || row.ownerSessionId !== s.id) throw new HubError("not_found", "Segment necunoscut");
    const { audioSha256, ...rest } = row;
    return { ...rest, audioSha256: audioSha256.slice(0, 12) };
  }

  /**
   * The server-held evidence for a spoken confirmation of ONE envelope (M07 §15). Checked here, consumed by the caller inside
   * the transaction that confirms the plan (consume() must change exactly one row). Refuses: another session's segment, a
   * segment not recorded for this plan, not the owner (MATCH with the CURRENT profile), no final local transcript, expired,
   * already used, or a sentence that is not an unambiguous "yes" to exactly this plan (negations, quotes, two plans waiting).
   */
  function claimForConfirmation({ utteranceId, session, envelope, pendingEnvelopes = [] }) {
    const row = utteranceRow(db.prepare("SELECT * FROM voice_utterances WHERE id = ?").get(String(utteranceId || "")));
    const refuse = (why) => { throw new HubError("policy", `Confirmarea vocală nu e valabilă: ${why}. Confirmă cu tasta sau butonul, ori repetă „Da, execută planul”.`); };
    if (!row) refuse("segmentul nu există");
    if (row.ownerSessionId !== session.id) refuse("segmentul a fost înregistrat în altă sesiune");
    // "confirm" = recorded with the plan's mic button; "gate" = spoken to Lega while the page showed THIS plan (the page tags
    // the segment with the plan on screen). Either way the segment must name this plan.
    if (!["confirm", "gate"].includes(row.purpose) || row.envelopeId !== envelope.id) refuse("segmentul nu a fost înregistrat pentru planul acesta");
    if (row.consumedAt) refuse("fraza a fost deja folosită");
    if (new Date(row.expiresAt).getTime() < now()) refuse("au trecut mai mult de 2 minute de la frază");
    const profile = active();
    if (row.result !== "MATCH" || !profile || row.profileId !== profile.id) refuse(row.result === "MATCH" ? "profilul vocal s-a schimbat între timp" : `vocea nu a fost recunoscută (${row.result})`);
    if (row.transcriptStatus !== "final" || !row.transcript) refuse("nu am o transcriere locală finală a frazei");
    // "Da?" is a question, not an answer.
    if (/\?/.test(row.transcript)) refuse(`am auzit o întrebare („${row.transcript.slice(0, 80)}”), nu o confirmare`);
    // Through Lega's conversation a bare "da" may answer something Lega asked: there the sentence must name the plan
    // ("Da, execută planul" / "Confirm planul"). The plan's own mic button (purpose "confirm") accepts the short forms.
    if (row.purpose === "gate") {
      const n = normalizeText(row.transcript);
      if (!/\bplanul\b/.test(n) || !/\b(execut|executa|confirm|confirma|porneste)/.test(n)) refuse(`în conversația cu Lega, confirmarea trebuie să numească planul („Da, execută planul”); am auzit „${row.transcript.slice(0, 80)}”`);
    }
    const resolved = resolveIntent(row.transcript, { projects: [], missions: [], departments: [], pendingEnvelopes: pendingEnvelopes.map((e) => ({ id: e.id, title: e.title || "" })),
      awaiting: "envelope_confirmation", source: "voice-local" });
    if (resolved.clarification) refuse(resolved.clarification.question || "e nevoie de o clarificare");
    // "Da. Execută planul." is two clauses that both say yes to the same plan; anything else in the sentence (a negation, a
    // condition, another request) makes it not a clean confirmation.
    const clean = resolved.steps.length > 0 && resolved.steps.every((st) => st.intent === "confirm" && st.args.envelopeId === envelope.id);
    if (!clean || resolved.refused.length) refuse(`am auzit „${row.transcript.slice(0, 80)}”, nu o confirmare clară a acestui plan`);
    const evidence = { utteranceId: row.id, speaker: row.result, verifier: row.verifier, profileVersion: row.profileVersion, transcriptSource: "local", sttEngine: row.sttEngine,
      heard: row.transcript.slice(0, 120), audioSha256: row.audioSha256.slice(0, 16), recordedAt: row.createdAt };
    const consume = (by) => db.prepare("UPDATE voice_utterances SET consumed_by = ?, consumed_at = ?, updated_at = ? WHERE id = ? AND consumed_at IS NULL AND owner_session_id = ?")
      .run(String(by).slice(0, 80), iso(), iso(), row.id, session.id).changes;
    return { evidence, consume };
  }

  /** owner.intent from a spoken sentence: the text and the "voice-local" source come from the server-held row. */
  function utteranceForIntent({ utteranceId, session }) {
    const row = utteranceRow(db.prepare("SELECT * FROM voice_utterances WHERE id = ?").get(String(utteranceId || "")));
    if (!row || row.ownerSessionId !== session?.id) throw new HubError("not_found", "Segment vocal necunoscut");
    if (row.result !== "MATCH") throw new HubError("policy", `Vocea nu a fost recunoscută (${row.result})`);
    if (row.transcriptStatus !== "final" || !row.transcript) throw new HubError("conflict", "Transcrierea locală nu e gata pentru acest segment");
    if (new Date(row.expiresAt).getTime() < now()) throw new HubError("conflict", "Segmentul a expirat");
    return row;
  }

  /** The bypass check (M07 §14): a released (MATCH) gate segment of this Lega session in the last window. */
  function recentGateRelease(legaSessionId, windowMs = 30000) {
    if (!legaSessionId) return false;
    const since = new Date(now() - windowMs).toISOString();
    // A sentence released while the session was still being set up carries no Lega session id yet; it counts too.
    return Boolean(db.prepare("SELECT 1 FROM voice_utterances WHERE (lega_session_id = ? OR lega_session_id IS NULL) AND purpose = 'gate' AND speaker_result = 'MATCH' AND created_at >= ? LIMIT 1").get(String(legaSessionId), since));
  }

  function remove({ session, reason = "la cererea ta" }) {
    trust.requireSession(session, "ștergerea profilului vocal");
    const current = active();
    bus.transaction(() => {
      db.prepare("UPDATE voice_profiles SET status = 'revoked', revoked_at = ? WHERE status IN ('active','superseded')").run(iso());
      settings.set("voiceGate", { ...settings.get("voiceGate"), enabled: false, profileId: null }, "owner", "Voice profile deleted");
      bus.append({ type: "voice.profile_deleted", scopeType: "owner", scopeId: "voice", source: "owner", payload: { profileId: current?.id || null, reason: String(reason).slice(0, 120) } });
    });
    drafts.clear();
    try { if (fs.existsSync(dir)) for (const name of fs.readdirSync(dir)) if (name.startsWith("profile-")) fs.rmSync(path.join(dir, name)); } catch { /* reported by status */ }
    return status();
  }

  function setGate({ enabled, session }) {
    trust.requireSession(session, "schimbarea filtrului vocal");
    if (enabled && !active()) throw new HubError("validation", "Înscrie întâi profilul vocal");
    // The filter is strict or off: a "non-strict" mode that lets everything through would only look like a filter.
    const value = { ...settings.get("voiceGate"), enabled: Boolean(enabled), strict: true };
    bus.transaction(() => settings.set("voiceGate", value, "owner", "Voice gate settings"));
    return status();
  }

  function status(session = null) {
    const profile = active();
    const gate = settings.get("voiceGate") || {};
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.startsWith("profile-")).length : 0;
    let eng = engine.status();
    // The owner opened the voice page: warm the engines in the background (hash check + models, ~30 s the first time), so
    // the first sentence does not wait. Only with a session and an installed, not-yet-started engine; failures show here.
    const retry = eng.engine === "failed" && eng.failedAt && now() - new Date(eng.failedAt).getTime() > 60000;
    if (session && eng.installed && (eng.engine === "stopped" || retry || (eng.engine === "integrity_failed" && eng.integrityStale))) { engine.ensure().catch(() => {}); eng = engine.status(); }
    const draft = session ? draftOf(session) : null;
    const ready = eng.installed && eng.integrity?.ok !== false && !["integrity_failed", "failed"].includes(eng.engine);
    return { verifier: VERIFIER, consentText: VOICE_CONSENT_TEXT, consentVersion: VOICE_CONSENT_VERSION, enroll: { ...ENROLL, phrases: ENROLL_PHRASES }, gate: { enabled: Boolean(gate.enabled), strict: true },
      profile: profile ? { id: profile.id, version: profile.version, samples: profile.samples, createdAt: profile.createdAt,
        calibration: { method: profile.calibration.method, matchAt: Math.min(profile.calibration.matchAt, VERIFY.ceilMatch), calibratedMatchAt: profile.calibration.matchAt, looMin: profile.calibration.looMin, negatives: profile.calibration.negatives, populationErrorRates: profile.calibration.populationErrorRates } } : null,
      draft: draft ? { samples: draft.samples.length, phrases: draft.samples.map((s) => s.phraseIndex) } : null,
      storedFiles: files, engine: eng,
      localTranscription: ready ? { available: true, engine: eng.components.stt, state: eng.engine, gpu: eng.gpu }
        : { available: false, reason: eng.installed ? `Motorul local nu e utilizabil: ${eng.detail || eng.integrity?.problems?.join("; ") || eng.engine}` : `Lipsește: ${eng.missing.join(", ")}` } };
  }

  /** Housekeeping: unused rows expire after a day (a consumed confirmation stays as evidence); the engine may idle-stop. */
  function tick() {
    try { db.prepare("DELETE FROM voice_utterances WHERE consumed_at IS NULL AND created_at < ?").run(new Date(now() - 24 * 3600000).toISOString()); } catch { /* closing */ }
    for (const [sid, d] of drafts) if (now() - d.startedAt > ENROLL.draftMinutes * 60000) drafts.delete(sid);
    for (const [sid, list] of rate) { const fresh = list.filter((t) => now() - t < 60000); if (fresh.length) rate.set(sid, fresh); else rate.delete(sid); }
    try { engine.tick(); } catch { /* engine state is reported by status */ }
  }

  return { enrollSample, enrollReset, enrollFinish, analyzeUtterance, getUtterance, claimForConfirmation, utteranceForIntent, recentGateRelease, remove, setGate, status, tick, active };
}
