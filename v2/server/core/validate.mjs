import { HubError } from "./errors.mjs";

/**
 * Minimal declarative validator for API bodies. Spec example:
 * { title: { type: "string", required: true, min: 3, max: 200 }, kind: { enum: [...] } }
 */
export function validate(body, spec, label = "request") {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HubError("validation", `${label}: JSON object expected`);
  const out = {};
  const problems = [];
  for (const [key, rule] of Object.entries(spec)) {
    let value = body[key];
    if (value === undefined || value === null || value === "") {
      if (rule.required) problems.push(`${key} is required`);
      else if (rule.default !== undefined) out[key] = typeof rule.default === "function" ? rule.default() : rule.default;
      continue;
    }
    if (rule.enum && !rule.enum.includes(value)) { problems.push(`${key} must be one of ${rule.enum.join(", ")}`); continue; }
    const type = rule.type || (rule.enum ? typeof rule.enum[0] : "string");
    if (type === "string") {
      if (typeof value !== "string") { problems.push(`${key} must be a string`); continue; }
      value = rule.trim === false ? value : value.trim();
      if (rule.min && value.length < rule.min) problems.push(`${key} must have at least ${rule.min} characters`);
      if (rule.max && value.length > rule.max) problems.push(`${key} must have at most ${rule.max} characters`);
      if (rule.pattern && !rule.pattern.test(value)) problems.push(`${key} has an invalid format`);
    } else if (type === "number" || type === "integer") {
      if (typeof value !== "number" || !Number.isFinite(value) || (type === "integer" && !Number.isInteger(value))) { problems.push(`${key} must be a ${type}`); continue; }
      if (rule.min !== undefined && value < rule.min) problems.push(`${key} must be >= ${rule.min}`);
      if (rule.max !== undefined && value > rule.max) problems.push(`${key} must be <= ${rule.max}`);
    } else if (type === "boolean") {
      if (typeof value !== "boolean") { problems.push(`${key} must be a boolean`); continue; }
    } else if (type === "array") {
      if (!Array.isArray(value)) { problems.push(`${key} must be an array`); continue; }
      if (rule.max && value.length > rule.max) problems.push(`${key} may have at most ${rule.max} items`);
      if (rule.items === "string" && value.some((item) => typeof item !== "string" || item.length > (rule.itemMax || 2000))) problems.push(`${key} must contain short strings`);
    } else if (type === "object") {
      if (typeof value !== "object" || Array.isArray(value)) { problems.push(`${key} must be an object`); continue; }
    } else if (type === "any") {
      // Any JSON value (e.g. the value of a piece of evidence), bounded in size.
      if (JSON.stringify(value).length > (rule.max || 10000)) { problems.push(`${key} is too large`); continue; }
    }
    out[key] = value;
  }
  if (problems.length) throw new HubError("validation", `${label}: ${problems.join("; ")}`, { data: { problems } });
  return out;
}
