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
  // Lega (voice assistant, GPT-Live via Codex): owner consent (versioned) and session preferences.
  legaConsent: {},
  lega: { voice: "cove", maxSessionMinutes: 20, idleTimeoutS: 120 },
  ui: { reducedMotion: "system" },
  legacyImport: null,
  routingPreferences: {},
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
