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
  // M07: which of preview / E2E / review the attestation covers in the environment (C18 / C19 / C20); the rest stays on Windows.
  const byId = env.attestation?.latest?.byId || {};
  const stages = [["C18", "preview"], ["C19", "E2E"], ["C20", "review"]];
  const inEnv = stages.filter(([id]) => byId[id] === "PASS").map(([, n]) => n);
  const outside = stages.filter(([id]) => byId[id] !== "PASS").map(([, n]) => n);
  const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} și ${xs.at(-1)}` : xs[0] || "");
  const tail = outside.length ? `${list(outside)} ${outside.length > 1 ? "rămân" : "rămâne"} pe Windows` : "toate etapele rulează în mediu";
  const covered = ["writer-ul", "verificările", "QA", ...inEnv];
  return {
    tone: env.simulated ? "warn" : testReady ? "info" : "warn",
    text: env.simulated ? "Mediu SIMULAT (fixture de test): nimic de aici nu e o dovadă WSL"
      : realReady ? `${list(covered).replace(/^w/, "W")} pot rula aici și pe proiecte reale; ${tail}${outside.length ? " (R2 deschis)" : ""}; proba live: ${live ? "făcută" : "nerulată"}`
        : testReady ? `${list(covered).replace(/^w/, "W")} pot rula aici pe proiecte de test; ${tail}; proiectele reale cer aprobarea (b); proba live: ${live ? "făcută" : "nerulată"}`
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

/** Canary result rows in a stable order (C1…C20), with NOT_RUN for what did not run; C18–C20 are optional coverage. */
export function canaryRows(byId = {}) {
  return Array.from({ length: 20 }, (_, i) => `C${i + 1}`).map((id) => ({ id, status: byId[id] || "NOT_RUN", optional: ["C18", "C19", "C20"].includes(id) }));
}
