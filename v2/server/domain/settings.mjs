import { json, parse } from "../storage/db.mjs";

export const DEFAULT_SETTINGS = Object.freeze({
  mode: "BUILD_SAFE",
  executionGate: { status: "suspended", reason: "Prima pornire V2: execuția live rămâne suspendată până o deschizi tu.", changedAt: null, changedBy: "system" },
  operationalEnabled: false,
  usageReservePercent: 20,
  maxConcurrentAiRuns: 2,
  // strictLocal: never use a browser speech service that may send audio online (no hidden cloud fallback).
  voice: { enabled: false, wakeWord: false, pushToTalk: true, ttsEnabled: false, voiceURI: "", language: "ro-RO", strictLocal: true, rate: 1, volume: 1 },
  billingAttestations: {},
  // Owner consent to the persistent DENY ACEs the Codex Windows sandbox writes for the Hub profile (M02 §05).
  isolationConsent: {},
  // R2 still open, accepted by the owner per project (path-bound, time-limited); never a claim of isolation (M03 §05).
  r2Acceptance: {},
  // M05: execution route per project ({ [projectId]: { environment: "wsl-runner", setAt, setBy } }); absent = Windows route.
  // Selecting a route never weakens the gate: a project on wsl-runner is refused when the environment is not attested,
  // and never falls back to Windows.
  projectEnvironments: {},
  // M05 (b): the owner's approval of host_isolation = environment for real projects, bound to one attestation and its
  // fingerprint ({ "wsl-runner": { approvedAt, text, attestationId, fingerprintHash } }). Absent = not approved.
  environmentPolicy: {},
  // M05: optional sandbox warm-up when the Hub starts (no model, a trivial command in an empty scratch folder). Off by default.
  environmentWarmup: { onBoot: false },
  // M04: the owner's company profile used in proposals (name, signature, confirmed materials); nothing is invented.
  salesOwner: { companyName: "Ifrim Digital", signatureName: "", materials: [] },
  // Lega (voice assistant, GPT-Live via Codex): owner consent (versioned) and session preferences.
  legaConsent: {},
  lega: { voice: "cove", maxSessionMinutes: 20, idleTimeoutS: 120 },
  ui: { reducedMotion: "system" },
  // M06: the product policy. "legacy" (default) = every effect needs its own UI click, as in M01–M05; "voice_first" = the owner
  // confirms one exact mission envelope in an authenticated session and the Hub derives the technical grants from it.
  ownerPolicy: { mode: "legacy" },
  // M06: the WebAuthn user handle of the owner (random; no personal data).
  ownerIdentity: {},
  // M06: autonomy level per project ({ [projectId]: { level, version, setAt, setBy } }); absent = the default of its kind.
  projectAutonomy: {},
  // M06: projects frozen by the owner ("Îngheață X"): no new step starts on them until unfrozen.
  projectFreeze: {},
  // M06: the owner's interruption preferences (quiet hours, "only decisions", voice notifications).
  ownerPrefs: { onlyDecisions: false, quietHours: null, voiceNotifications: false },
  // M06: which envelope switched the Hub from BUILD_SAFE to LIVE_VALIDATION (released when its missions end).
  envelopeModeHold: {},
  // M06: local voice gate (speaker verification before anything is sent). Off until the owner enrols and enables it.
  voiceGate: { enabled: false, strict: true, profileId: null },
  legacyImport: null,
  routingPreferences: {},
  // M08 Zero-Menu: what opens first — the project cockpit or the big Lega screen ("stage"). A preference, never an authority.
  startView: "cockpit",
  // M08 package B3: extra verification commands the owner allowed for the factory (keys of EXTRA_COMMAND_PATTERNS); none by default.
  factoryExtraCommands: [],
  // M08 Simulation: the owner's own estimates reused by "ce se întâmplă dacă…" (never invented; empty until the owner saves them).
  simulationDefaults: {},
  // M09-A2: billing evidence per provider ({ [provider]: { declaration, reports[], reverify } }); see policy/billing-evidence.mjs.
  // The legacy billingAttestations stay read-only for rollback.
  billingEvidence: {},
  // M09-A2: the random salt of the pseudonymous account identity (HMAC-SHA256, 16 hex). Created at first use; never returned
  // by the API (/api/settings strips it) and redacted in command logs (the key name matches the secret pattern).
  billingIdentitySecret: null,
  // M09 Content Studio policy. Every external effect is OFF by default and is not switched on by the existence of code: live
  // capture (OBS / screen), live upload to a platform and automatic publication each need their own owner decision.
  mediaPolicy: { autoPublish: false, liveUpload: false, liveCapture: false, renderConcurrency: 1, diskReserveGb: 15, libraryQuotaGb: 40,
    interactivePriority: true, transcriptionMedia: true },
  // M09: pinned media tools ({ ffmpeg: { path, version, sha256, pinnedAt }, ffprobe: {...} }); filled at first verified use.
  mediaToolPins: {},
});

export function createSettings(db, bus, clock = () => new Date()) {
  const getRow = db.prepare("SELECT value_json FROM settings WHERE key = ?");
  const upsert = db.prepare(`INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`);

  const get = (key) => {
    const row = getRow.get(key);
    return row ? parse(row.value_json, DEFAULT_SETTINGS[key]) : structuredClone(DEFAULT_SETTINGS[key]);
  };

  /** Must be called inside bus.transaction so the change and its event commit together. */
  const set = (key, value, actor = "system", reason = "") => {
    if (!(key in DEFAULT_SETTINGS)) throw new Error(`Unknown setting ${key}`);
    upsert.run(key, json(value), clock().toISOString());
    bus.append({ type: "settings.changed", scopeType: "settings", scopeId: key, source: actor, payload: { key, reason } });
    return value;
  };

  const all = () => Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((key) => [key, get(key)]));
  return { get, set, all };
}
