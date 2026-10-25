import { HubError } from "../core/errors.mjs";
import { FACTORY_STAGES } from "./factory.mjs";
const parse = (s) => typeof s === "object" ? s || {} : JSON.parse(s || "{}");
const LABELS = { "factory.resumed": "Reîncepută", "factory.extra_cycle": "Ciclu suplimentar", "factory.turn_timeout": "Tura a depășit timpul", "factory.turn_retry": "Tură reîncercată", "factory.deadline_extended": "Termen prelungit", "factory.owner_override": "Decizie a proprietarului", "factory.rejected": "Respinsă de proprietar", "factory.stage_refused": "Etapă refuzată" };
/** Assign recorded artifacts to the actual time window, falling back to the last matching stage. */
export function traceOf({ mission, events, dispatches = [], evidence = [], reviews = [], bundle = null, now = new Date() }) {
  const stageEvents = events.filter((e) => e.type === "factory.stage").sort((a, b) => a.seq - b.seq);
  const steps = stageEvents.map((e, i) => {
    const p = parse(e.payload_json || e.payload); const stage = p.stage; const reason = p.reason || "";
    const cycle = /Ciclul\s+(\d+)\s*\/\s*(\d+)/i.exec(reason);
    const leftAt = stageEvents[i + 1]?.created_at || null;
    return { seq: e.seq, stage, at: e.created_at, leftAt, durationMs: leftAt ? Date.parse(leftAt) - Date.parse(e.created_at) : null, actor: e.source, reason, cycle: cycle ? { n: Number(cycle[1]), max: Number(cycle[2]) } : stage === "REPAIRING" ? { n: mission.repairCycles ?? mission.repair_cycles, max: mission.limits?.maxRepairCycles ?? parse(mission.limits_json).maxRepairCycles } : null, runs: [], evidence: [], reviews: [] };
  });
  const attach = (stage, at) => steps.findLast((s) => (!stage || s.stage === stage) && Date.parse(at) >= Date.parse(s.at) && (!s.leftAt || Date.parse(at) < Date.parse(s.leftAt))) || steps.findLast((s) => !stage || s.stage === stage);
  for (const d of dispatches) { if (!d.run_id) continue; const s = attach(d.stage, d.started_at || d.created_at); s?.runs.push({ runId: d.run_id, provider: d.provider ?? null, model: d.model ?? null, effort: d.effort ?? null, roleId: d.role_id ?? null, status: d.run_status ?? null, startedAt: d.started_at ?? null, finishedAt: d.finished_at ?? null, durationMs: d.started_at && d.finished_at ? Date.parse(d.finished_at) - Date.parse(d.started_at) : null }); }
  for (const e of evidence) attach(e.stage, e.created_at)?.evidence.push({ id: e.id, kind: e.kind, status: e.status, at: e.created_at, durationMs: e.duration_ms ?? null });
  for (const r of reviews) attach(null, r.created_at)?.reviews.push({ id: r.id, verdict: r.verdict, status: r.status, at: r.created_at });
  const edges = [];
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1].stage; const b = steps[i].stage;
    const work = FACTORY_STAGES.indexOf(b) >= 1 && FACTORY_STAGES.indexOf(b) <= 10;
    const kind = b === "PAUSED" ? "pause" : ["PAUSED", "BLOCKED", "NEEDS_OWNER_DECISION"].includes(a) && work ? "resume" : a === b ? "retry" : work && (b === "REPAIRING" || FACTORY_STAGES.indexOf(b) < FACTORY_STAGES.indexOf(a)) ? "repair_loop" : "next";
    edges.push({ from: i - 1, to: i, kind });
  }
  for (const s of steps) if (s.runs.length > 1) edges.push({ from: steps.indexOf(s), to: steps.indexOf(s), kind: "retry" });
  for (const e of events.filter((e) => e.type === "factory.turn_retry")) { const s = attach(parse(e.payload_json || e.payload).stage, e.created_at); if (s && !edges.some((x) => x.kind === "retry" && x.to === steps.indexOf(s))) edges.push({ from: steps.indexOf(s), to: steps.indexOf(s), kind: "retry" }); }
  return { missionId: mission.missionId || mission.mission_id, title: mission.title, projectId: mission.projectId || mission.project_id, readAt: new Date(now).toISOString(), current: { stage: mission.stage, waitReason: mission.waitReason ?? mission.wait_reason ?? "", stageReason: mission.stageReason ?? mission.stage_reason ?? "" }, steps, edges, events: events.filter((e) => LABELS[e.type]).map((e) => ({ type: e.type, at: e.created_at, label: LABELS[e.type] })), bundle: bundle ? { id: bundle.id, status: bundle.status, decidedAt: bundle.decided_at || null } : null };
}
export function factoryTrace(hub, id) {
  const db = hub.db; const mission = db.prepare("SELECT f.*, m.title, m.project_id FROM factory_missions f JOIN missions m ON m.id = f.mission_id WHERE f.mission_id = ?").get(id);
  if (!mission) throw new HubError("not_found", "Lucrare necunoscută");
  return traceOf({ mission, events: db.prepare("SELECT * FROM events WHERE (scope_type = 'mission' AND scope_id = ?) OR mission_id = ? ORDER BY seq").all(id, id), dispatches: db.prepare("SELECT d.*, r.provider, r.model, r.effort, r.role_id, r.status AS run_status, r.started_at, r.finished_at FROM factory_dispatches d LEFT JOIN agent_runs r ON r.id = d.run_id WHERE d.mission_id = ? ORDER BY d.created_at").all(id), evidence: db.prepare("SELECT * FROM factory_evidence WHERE mission_id = ? ORDER BY created_at").all(id), reviews: db.prepare("SELECT * FROM factory_reviews WHERE mission_id = ? ORDER BY created_at").all(id), bundle: db.prepare("SELECT * FROM factory_bundles WHERE mission_id = ? ORDER BY created_at DESC LIMIT 1").get(id), now: hub.config.now() });
}
