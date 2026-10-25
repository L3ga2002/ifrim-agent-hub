import { bucharestParts } from "./roText.js";
const normalize = v => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function searchNodes(nodes = [], query = "") { const q = normalize(query.trim()); return nodes.filter(n => !q || normalize([n.label, n.id, n.stateText, ...(n.facts || []).flatMap(f => [f.label, f.value])].join(" ")).includes(q)); }
export function freshnessWords(at, now = Date.now()) { const age = now - Date.parse(at); if (!Number.isFinite(age))
    return "niciodată"; return `acum ${age >= 3600000 ? `${Math.floor(age / 3600000)} h` : `${Math.max(0, Math.floor(age / 60000))} min`}${age >= 86400000 ? " · vechi" : ""}`; }
export function yesNo(value) { return value === true ? "da" : value === false ? "nu" : "necunoscut"; }

export const STATE_ICONS = { ok: "✓", warn: "⚠", error: "✕", off: "○", unknown: "?" };
export function systemFields(node, now = Date.now()) {
  return [["installed", "instalat"], ["configured", "configurat"], ["available", "disponibil"], ["running", "rulează"]].filter(([key]) => Object.hasOwn(node, key)).map(([key, label]) => ({ key, label: key === "available" ? `${label} (verificat ${freshnessWords(node.available?.checkedAt, now)})` : label, value: yesNo(key === "available" ? node.available?.ok : node[key]) }));
}

export function systemFact(value) {
 if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && Number.isFinite(Date.parse(value))) { const p = bucharestParts(value); return `${p.dateShort}, ${p.time}`; }
 return value;
}
