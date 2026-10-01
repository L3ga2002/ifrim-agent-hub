export const SERVICES = Object.freeze(["consultanta", "mentenanta", "audit"]);

/**
 * Validează o solicitare de serviciu. Returnează { ok, errors, value }.
 * Câmpuri: name (obligatoriu), email (obligatoriu, format simplu), service (din SERVICES).
 */
export function validateRequest(input = {}) {
  const errors = {};
  const name = typeof input.name === "string" ? input.name : "";
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const service = typeof input.service === "string" ? input.service.trim() : "";
  if (!name) errors.name = "Numele este obligatoriu";
  if (!email) errors.email = "E-mailul este obligatoriu";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "E-mailul nu este valid";
  if (!SERVICES.includes(service)) errors.service = "Alege un serviciu din listă";
  const ok = Object.keys(errors).length === 0;
  return { ok, errors, value: ok ? { name: name.trim(), email: email.toLowerCase(), service } : null };
}
