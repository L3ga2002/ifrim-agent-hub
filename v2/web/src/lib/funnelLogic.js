export const PIPELINE_ORDER = ["IDENTIFIED", "PROPOSAL_DRAFT", "READY_FOR_OWNER_REVIEW", "APPROVED_INTERNAL", "CONTACTED", "IN_DISCUSSION", "WON"];
export function clampThreshold(value) { const n = Number(value); return Number.isFinite(n) && String(value).trim() ? Math.max(1, Math.min(365, Math.round(n))) : 21; }
export function orderedStages(stages = []) { return [...stages].sort((a, b) => PIPELINE_ORDER.indexOf(a.status) - PIPELINE_ORDER.indexOf(b.status)); }
export function conversionLabel(c) { return c?.state === "ok" && Number.isFinite(c.rate) ? `${Math.round(c.rate * 100)}%` : "Date insuficiente"; }
