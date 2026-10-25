import { stateOf } from "./stateVocab.js";
export function durationText(ms) { if (!Number.isFinite(ms) || ms < 0)
    return "necunoscut"; if (ms < 1000) return "sub 1 s"; const s = Math.floor(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`; }
export const finalMission = stage => ["CLOSED", "ACCEPTED", "OWNER_ACCEPTED", "REJECTED", "CANCELLED"].includes(stage);
export const waitingStage = stage => ["decide", "block", "paused"].includes(stateOf("mission", stage)) || /WAIT/.test(stage || "");
export function isCurrentStep(step, index, count, currentStage = step.stage) { return index === count - 1 && step.leftAt === null && !finalMission(currentStage); }
export function traceStepState(step, index, count, currentStage) { return isCurrentStep(step, index, count, currentStage) ? stateOf("mission", step.stage) : "closed"; }
export function stepDuration(step, now = Date.now(), current = step.leftAt === null, currentStage = step.stage) {
 if (finalMission(currentStage)) return "Încheiat · final";
 return current ? `${waitingStage(currentStage) ? "așteaptă" : "în curs"} de ${durationText(now - Date.parse(step.at))}` : durationText(step.durationMs);
}
export function evidenceText(count) { return count > 0 ? `${count} dovezi` : "fără dovezi"; }
export function traceLayout(steps = [], edges = [], columns = 5) {
 const cols = Math.max(1, Math.min(5, columns)), rowHeight = 310;
 const nodes = steps.map((s,i) => ({ ...s, x: 110 + i % cols * 240, y: 80 + Math.floor(i / cols) * rowHeight }));
 return { nodes, columns: cols, width: Math.max(240, Math.min(cols, steps.length) * 240), height: Math.max(rowHeight, Math.ceil(steps.length / cols) * rowHeight), edges: edges.filter(e => !(e.kind === "repair_loop" && steps[e.to]?.stage === "REPAIRING" && edges.some(next => next.from === e.to && next.kind === "repair_loop"))).map(e => {
 const a = nodes[e.from], b = nodes[e.to]; if (!a || !b) return null;
 return { ...e, labelX: (a.x+b.x)/2, labelY: Math.min(a.y,b.y)-40, path: e.kind === "next" && a.y === b.y ? `M ${a.x} ${a.y} L ${b.x} ${b.y}` : `M ${a.x} ${a.y} Q ${(a.x+b.x)/2} ${Math.min(a.y,b.y)-80} ${b.x} ${b.y}` };
 }).filter(Boolean) };
}
export function defaultMission(missions = []) { return [...missions].filter(m => !["CLOSED", "CANCELLED", "REJECTED", "OWNER_ACCEPTED", "ACCEPTED"].includes(m.stage)).sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0))[0]; }
