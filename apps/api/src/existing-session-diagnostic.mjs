import path from "node:path";
import { validateSubscriptionGate } from "./openclaw-subscription-gate.mjs";

export function validateSuspendedDiagnosticCertificate(gate, evidence, config, configHash, options, now = Date.now()) {
  if (gate?.status !== "suspended") throw new Error("Execution gate must stay suspended");
  for (const timestamp of [gate.verifiedAt, evidence?.verifiedAt]) {
    const age = now - Date.parse(timestamp || "");
    if (!Number.isFinite(age) || age < 0 || age > 86400000) throw new Error("Diagnostic certification expired or invalid");
  }
  if (evidence?.version !== 1 || evidence.provider !== options.provider || !evidence.agents?.[options.agentId]
    || path.resolve(evidence.receipt?.projectRoot || "") !== path.resolve(options.cwd)) throw new Error("Diagnostic evidence belongs to another route");
  // Validate the certificate only; this copy never activates or writes the execution gate.
  validateSubscriptionGate({ ...gate, status: "approved" }, config, configHash, options, now);
  return true;
}
