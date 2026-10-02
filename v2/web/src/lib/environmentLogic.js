// Pure helpers of the Environments view (M05 §24). Separate facts, never one green light: installed, adapter, account,
// canary, policy (b), live probe and per-stage eligibility each keep their own state.

export const STEP_LABELS = Object.freeze({
  installed: "Instalat", adapter: "Adaptor", account: "Cont (C16)", canary: "Canary C1–C17", policy: "Aprobare (b)", live: "Probă live (c)",
});

export const BOUNDARY = Object.freeze({
  environment: { tone: "ok", label: "în mediul atestat" },
  "windows-sandbox": { tone: "warn", label: "Windows (R2 deschis)" },
  "windows-browser": { tone: "warn", label: "browser Windows (preview din afara mediului)" },
  tool: { tone: "warn", label: "graniță de unealtă" },
  "no-workspace": { tone: "info", label: "fără workspace" },
  blocked: { tone: "error", label: "blocat" },
});

export const boundaryOf = (boundary) => BOUNDARY[boundary] || { tone: "neutral", label: boundary || "—" };

/** One line per environment: which rungs are done, which are not (in order), and whether real projects may use it. */
export function environmentSummary(env) {
  if (!env) return { tone: "neutral", text: "Mediul nu a fost inspectat încă" };
  const ladder = (env.ladder || []).filter((l) => !l.informational);
  const missing = ladder.filter((l) => !l.ok).map((l) => STEP_LABELS[l.step] || l.step);
  const testReady = ladder.filter((l) => ["installed", "account", "canary"].includes(l.step)).every((l) => l.ok);
  const realReady = testReady && ladder.find((l) => l.step === "policy")?.ok;
  const live = ladder.find((l) => l.step === "live")?.ok;
  // Never a plain "ok": even fully approved, preview, E2E and review stay outside this environment.
  return {
    tone: env.simulated ? "warn" : testReady ? "info" : "warn",
    text: env.simulated ? "Mediu SIMULAT (fixture de test): nimic de aici nu e o dovadă WSL"
      : realReady ? `Writer-ul, verificările și QA pot rula aici și pe proiecte reale; preview, E2E și review rămân pe Windows (R2 deschis); proba live: ${live ? "făcută" : "nerulată"}`
        : testReady ? `Writer-ul, verificările și QA pot rula aici pe proiecte de test; proiectele reale cer aprobarea (b); proba live: ${live ? "făcută" : "nerulată"}`
          : `Lipsește: ${missing.join(", ") || "—"}`,
    missing,
    testReady: Boolean(testReady),
    realReady: Boolean(realReady),
  };
}

/** Why the (b) approval button stays disabled (null when it may be sent). The server checks all of it again. */
export function policyFormProblem({ text, policyText, fingerprintHash, attestationValid }) {
  if (!attestationValid) return "Mediul nu are o atestare validă pe amprenta curentă";
  if (!fingerprintHash) return "Amprenta mediului nu este cunoscută (inspectează mediul)";
  if (text !== policyText) return "Textul tastat nu este identic cu textul afișat";
  return null;
}

/** Canary result rows in a stable order (C1…C17), with NOT_RUN for what did not run. */
export function canaryRows(byId = {}) {
  return Array.from({ length: 17 }, (_, i) => `C${i + 1}`).map((id) => ({ id, status: byId[id] || "NOT_RUN" }));
}
