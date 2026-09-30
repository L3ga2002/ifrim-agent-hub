// Core state is derived ONLY from observable Hub signals (Milestone 02 §11). It never claims to visualise a
// model's internal thoughts, and waiting for a provider is shown as waiting, not as measured progress.

export const CORE_STATE_IDS = Object.freeze(["IDLE", "LISTENING", "TRANSCRIBING", "WAITING_PROVIDER", "EXECUTING",
  "VERIFYING", "WAITING_APPROVAL", "PAUSED", "ERROR", "OFFLINE"]);

/** Visual parameters per state. `hue` values are [r,g,b] in 0..1; motion is scaled down by reduced motion. */
export const CORE_VISUALS = Object.freeze({
  IDLE: { label: "În așteptare", color: [0.40, 0.85, 1.00], accent: [0.40, 0.85, 1.00], energy: 0.22, turbulence: 0.25, pulse: 0.25, shells: 3 },
  LISTENING: { label: "Ascult", color: [0.55, 0.90, 1.00], accent: [0.91, 0.71, 0.43], energy: 0.55, turbulence: 0.45, pulse: 1.00, shells: 3 },
  TRANSCRIBING: { label: "Transcriu", color: [0.55, 0.90, 1.00], accent: [0.72, 0.78, 1.00], energy: 0.70, turbulence: 0.60, pulse: 0.60, shells: 4 },
  WAITING_PROVIDER: { label: "Aștept providerul", color: [0.45, 0.70, 0.95], accent: [0.60, 0.68, 0.80], energy: 0.35, turbulence: 0.30, pulse: 0.45, shells: 3 },
  EXECUTING: { label: "Execut", color: [0.40, 0.85, 1.00], accent: [0.72, 0.92, 1.00], energy: 1.00, turbulence: 0.85, pulse: 0.30, shells: 4 },
  VERIFYING: { label: "Verific", color: [0.53, 0.86, 0.73], accent: [0.40, 0.85, 1.00], energy: 0.50, turbulence: 0.40, pulse: 0.40, shells: 3 },
  WAITING_APPROVAL: { label: "Aștept aprobarea ta", color: [0.91, 0.71, 0.43], accent: [0.91, 0.71, 0.43], energy: 0.45, turbulence: 0.30, pulse: 0.90, shells: 2 },
  PAUSED: { label: "Pauză", color: [0.60, 0.66, 0.74], accent: [0.60, 0.66, 0.74], energy: 0.10, turbulence: 0.10, pulse: 0.10, shells: 2 },
  ERROR: { label: "Atenție", color: [1.00, 0.56, 0.52], accent: [1.00, 0.56, 0.52], energy: 0.25, turbulence: 0.55, pulse: 0.20, shells: 2 },
  OFFLINE: { label: "Deconectat", color: [0.45, 0.50, 0.58], accent: [0.45, 0.50, 0.58], energy: 0.05, turbulence: 0.05, pulse: 0.00, shells: 1 },
});

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * @param {object} input
 * @param {object|null} input.hub  /api/state projection
 * @param {string} input.connection  "live" | "connecting" | "reconnecting"
 * @param {string} input.voicePhase  "idle" | "listening" | "transcribing" (local push-to-talk)
 * @param {string} input.legaPhase  "off" | "connecting" | "listening" | "user-speaking" | "speaking" | "delegating" (Lega session)
 * @returns {{ state: string, reason: string, label: string }}
 */
export function deriveCoreState({ hub, connection = "live", voicePhase = "idle", legaPhase = "off" } = {}) {
  const out = pickCoreState({ hub, connection, voicePhase, legaPhase });
  return { ...out, label: out.label || CORE_VISUALS[out.state].label };
}

function pickCoreState({ hub, connection, voicePhase, legaPhase }) {
  if (!hub) return { state: connection === "live" ? "IDLE" : "OFFLINE", reason: connection === "live" ? "Se încarcă starea Hub-ului" : "Hub-ul nu răspunde; interfața se reconectează" };
  if (connection !== "live") return { state: "OFFLINE", reason: "Fluxul de evenimente este întrerupt; reconectare și reluare fără pierderi de la ultimul eveniment primit" };
  // A decision you owe always wins: a long voice session must never hide a pending approval.
  if (hub.pendingApprovals > 0) return { state: "WAITING_APPROVAL", reason: `${plural(hub.pendingApprovals, "aprobare așteaptă", "aprobări așteaptă")} decizia ta` };
  if (voicePhase === "listening") return { state: "LISTENING", reason: "Microfonul este activ cât ții apăsat butonul" };
  if (voicePhase === "transcribing") return { state: "TRANSCRIBING", reason: "Se transcrie ce ai spus; textul rămâne editabil" };
  if (legaPhase === "connecting") return { state: "WAITING_PROVIDER", label: "Lega se conectează", reason: "Aștept confirmarea sesiunii vocale (nu este progres măsurat)" };
  if (legaPhase === "user-speaking") return { state: "LISTENING", label: "Lega te ascultă", reason: "Vorbești cu Lega (GPT-Live, audio trimis la OpenAI)" };
  if (legaPhase === "speaking") return { state: "TRANSCRIBING", label: "Lega vorbește", reason: "Lega îți răspunde; vorbește peste ea ca s-o întrerupi" };
  if (legaPhase === "delegating") return { state: "EXECUTING", label: "Lega lucrează", reason: "Lega a predat cererea agentului din spate; tot ce are efecte cere click-ul tău" };
  if (legaPhase === "listening") return { state: "LISTENING", label: "Lega ascultă", reason: "Sesiune Lega activă; spune „Lega, oprește tot” sau apasă Oprește" };
  return pickWork(hub);
}

function pickWork(hub) {
  const runs = hub.activeRuns || [];
  const streaming = runs.filter((r) => r.phase === "streaming");
  if (streaming.length) return { state: "EXECUTING", reason: `${plural(streaming.length, "execuție primește", "execuții primesc")} răspuns de la provider` };
  if (runs.length) return { state: "WAITING_PROVIDER", reason: `${plural(runs.length, "execuție așteaptă", "execuții așteaptă")} primul răspuns (nu este progres măsurat)` };
  if (hub.backupRunning > 0) return { state: "VERIFYING", reason: "Backup în curs, cu verificare prin restaurare" };
  if (hub.verifyingTasks > 0) return { state: "VERIFYING", reason: `${plural(hub.verifyingTasks, "task așteaptă", "taskuri așteaptă")} verificare cu dovezi` };
  const breakerOpen = Object.values(hub.breakers || {}).some((b) => b?.state === "open");
  if (breakerOpen) return { state: "ERROR", reason: "Un circuit breaker este deschis după eșecuri de infrastructură" };
  if (hub.recentFailures?.length) return { state: "ERROR", reason: `${plural(hub.recentFailures.length, "eșec", "eșecuri")} în ultimele 30 de minute` };
  const gate = hub.executionGate?.status;
  if (hub.mode !== "BUILD_SAFE" && gate !== "open") return { state: "PAUSED", reason: `Poarta de execuție este suspendată${hub.executionGate?.reason ? `: ${hub.executionGate.reason}` : ""}` };
  if (hub.mode === "BUILD_SAFE") return { state: "IDLE", reason: "BUILD_SAFE: nicio execuție cu model nu poate porni" };
  return { state: "IDLE", reason: "Nicio execuție activă" };
}
