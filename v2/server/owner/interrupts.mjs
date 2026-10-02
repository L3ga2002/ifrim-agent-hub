import { HubError } from "../core/errors.mjs";
import { ACTIVE_STAGES } from "../factory/factory.mjs";

/**
 * InterruptionPolicy (M06 §25): distinct meanings, reported only as far as the Hub could confirm them.
 *
 *  - „Taci” / „Nu mai vorbi”: stops Lega's voice only (handled in the browser + lega.silence); the work continues.
 *  - „Pauză”: no new step starts; the active step of each mission in scope is interrupted and will be redone on resume
 *    (an interrupted step is not counted as an attempt). Without a project, the execution gate is also suspended.
 *  - „Oprește Codex/Claude”: interrupts that worker; inside a factory mission this is a pause of the mission (explicit).
 *  - „Îngheață X”: no new step on X until unfrozen (gate check), its active missions paused, its open envelope revoked.
 *  - „Oprește tot”: Stop All (the existing local path; no model is consulted).
 *  - „Preiau eu”: pause + revoke + wait until nothing runs on the project + checkpoint; control is released only after the
 *    stop is confirmed.
 * Reducing activity never requires re-authentication; unfreezing (which allows work again) needs the UI or the owner session.
 * A cancellation is never reported as confirmed just because it was requested.
 */
export function createInterrupts({ db, bus, clock, settings, runs, factory, envelopes, checkpoints, projects, live }) {
  const iso = () => clock().toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const projectOfRun = (r) => db.prepare("SELECT project_id FROM conversations WHERE id = ?").get(r.conversationId)?.project_id || null;
  const missionOfRun = (r) => (r.taskId ? db.prepare("SELECT mission_id FROM tasks WHERE id = ?").get(r.taskId)?.mission_id || null : null);
  const activeMissions = (projectId) => factory.list().filter((f) => ACTIVE_STAGES.has(f.stage) && f.stage !== "CANCEL_REQUESTED" && (!projectId || f.projectId === projectId));

  /** Waits (bounded) until none of the runs is active; returns which ones stopped and which are still unconfirmed. */
  async function confirmStopped(runIds, timeoutMs = 8000) {
    const started = Date.now();
    let still = runIds;
    while (still.length && Date.now() - started < timeoutMs) {
      const active = new Set(runs.activeRuns().map((r) => r.runId));
      still = runIds.filter((id) => active.has(id));
      if (still.length) await sleep(100);
    }
    return { confirmed: runIds.filter((id) => !still.includes(id)), unconfirmed: still };
  }

  async function pauseMissions(list, actor) {
    const out = [];
    for (const f of list) {
      try { const v = await factory.pause(f.missionId, { actor }); out.push({ missionId: f.missionId, title: f.title, from: f.stage, stage: v.factory.stage, note: "pasul activ a fost întrerupt; se reia la „Reia” (nu se numără ca încercare)" }); }
      catch (error) { out.push({ missionId: f.missionId, title: f.title, from: f.stage, error: error.message }); }
    }
    return out;
  }

  async function pause({ projectId = null, actor = "owner", reason = "Pauză" } = {}) {
    const before = runs.activeRuns().filter((r) => !projectId || projectOfRun(r) === projectId).map((r) => r.runId);
    const paused = await pauseMissions(activeMissions(projectId), actor);
    let gate = settings.get("executionGate").status;
    if (!projectId && gate === "open") {
      bus.transaction(() => settings.set("executionGate", { status: "suspended", reason: `${reason} (fără pași noi)`, changedAt: iso(), changedBy: actor }, actor, reason));
      gate = "suspended";
    }
    const { confirmed, unconfirmed } = await confirmStopped(before);
    bus.emit({ type: "owner.interrupt", scopeType: "owner", scopeId: projectId || "all", source: actor, payload: { kind: "pause", missions: paused.length, confirmed: confirmed.length, unconfirmed: unconfirmed.length } });
    return { kind: "pause", projectId, gate, missions: paused, runsStopped: confirmed, runsUnconfirmed: unconfirmed,
      summary: paused.length ? `${paused.length} misiun${paused.length === 1 ? "e pusă" : "i puse"} pe pauză${unconfirmed.length ? `; ${unconfirmed.length} execuții încă neconfirmate ca oprite` : ""}` : "Nicio misiune activă; nimic nou nu pornește" };
  }

  async function stopWorker({ provider, actor = "owner" }) {
    if (!["codex", "claude", "any"].includes(provider)) throw new HubError("validation", "Worker necunoscut");
    const targets = runs.activeRuns().filter((r) => provider === "any" || r.provider === provider);
    if (!targets.length) return { kind: "stop_worker", provider, stopped: [], summary: `${provider === "claude" ? "Claude" : provider === "codex" ? "Codex" : "Niciun agent"} nu rulează acum` };
    const missionsPaused = []; const interrupted = [];
    for (const r of targets) {
      const missionId = missionOfRun(r);
      const f = missionId ? factory.list().find((x) => x.missionId === missionId) : null;
      if (f && ACTIVE_STAGES.has(f.stage)) { missionsPaused.push(...(await pauseMissions([f], actor))); }
      else { await runs.interrupt(r.runId, actor).catch(() => {}); interrupted.push(r.runId); }
    }
    const { confirmed, unconfirmed } = await confirmStopped(targets.map((r) => r.runId));
    bus.emit({ type: "owner.interrupt", scopeType: "owner", scopeId: provider, source: actor, payload: { kind: "stop_worker", confirmed: confirmed.length, unconfirmed: unconfirmed.length } });
    return { kind: "stop_worker", provider, missions: missionsPaused, runsStopped: confirmed, runsUnconfirmed: unconfirmed,
      summary: unconfirmed.length ? `Oprire cerută; ${unconfirmed.length} execuții încă neconfirmate` : `Oprit (${confirmed.length} execuții confirmate ca oprite)${missionsPaused.length ? "; misiunea e pe pauză" : ""}` };
  }

  async function freeze({ projectId, actor = "owner" }) {
    const project = projects.get(projectId);
    if (!project) throw new HubError("not_found", "Proiect necunoscut");
    bus.transaction(() => settings.set("projectFreeze", { ...settings.get("projectFreeze"), [project.id]: { at: iso(), by: actor } }, actor, `Project frozen: ${project.name}`));
    const open = envelopes.openFor(project.id);
    if (open) envelopes.revoke(open.id, { actor, reason: `Proiect înghețat: ${project.name}` });
    const paused = await pauseMissions(activeMissions(project.id), actor);
    bus.emit({ type: "owner.interrupt", scopeType: "project", scopeId: project.id, projectId: project.id, source: actor, payload: { kind: "freeze", missions: paused.length } });
    return { kind: "freeze", projectId: project.id, missions: paused, envelopeRevoked: open?.id || null, summary: `${project.name} e înghețat: niciun pas nou nu pornește până îl dezgheți` };
  }

  function unfreeze({ projectId, actor = "owner" }) {
    const project = projects.get(projectId);
    if (!project) throw new HubError("not_found", "Proiect necunoscut");
    const value = { ...settings.get("projectFreeze") }; delete value[project.id];
    bus.transaction(() => settings.set("projectFreeze", value, actor, `Project unfrozen: ${project.name}`));
    return { kind: "unfreeze", projectId: project.id, summary: `${project.name} nu mai e înghețat; misiunile rămân pe pauză până le reiei` };
  }

  /** „Preiau eu”: the Hub stops working on the project and hands over, with a checkpoint, once the stop is confirmed. */
  async function takeover({ projectId, actor = "owner" }) {
    const project = projects.get(projectId);
    if (!project) throw new HubError("not_found", "Proiect necunoscut");
    const open = envelopes.openFor(project.id);
    if (open) envelopes.revoke(open.id, { actor, reason: "Proprietarul preia controlul" });
    const before = runs.activeRuns().filter((r) => projectOfRun(r) === project.id).map((r) => r.runId);
    const paused = await pauseMissions(activeMissions(project.id), actor);
    for (const id of before) await runs.interrupt(id, actor).catch(() => {});
    const { confirmed, unconfirmed } = await confirmStopped(before, 12000);
    let checkpoint = null;
    if (!unconfirmed.length) {
      try { checkpoint = await checkpoints.create({ scopeType: "project", scopeId: project.id, label: "Preiau eu", nextAction: "Proprietarul lucrează manual; misiunile rămân pe pauză", kind: "operational" }, actor); }
      catch (error) { checkpoint = { error: error.message }; }
    }
    bus.emit({ type: "owner.interrupt", scopeType: "project", scopeId: project.id, projectId: project.id, source: actor, payload: { kind: "takeover", confirmed: confirmed.length, unconfirmed: unconfirmed.length, checkpoint: checkpoint?.id || null } });
    return { kind: "takeover", projectId: project.id, missions: paused, envelopeRevoked: open?.id || null, runsStopped: confirmed, runsUnconfirmed: unconfirmed, checkpoint,
      released: unconfirmed.length === 0,
      summary: unconfirmed.length ? `Oprirea nu e încă confirmată pentru ${unconfirmed.length} execuții; nu-ți predau controlul până nu se opresc` : `Controlul e al tău: nimic nu mai rulează pe ${project.name}${checkpoint?.id ? ` (checkpoint ${checkpoint.id})` : ""}` };
  }

  function mute({ actor = "owner" } = {}) {
    live?.publish({ type: "lega.silence", sessionId: null, all: true });
    return { kind: "mute", summary: "Am tăcut; munca continuă" };
  }

  return { pause, stopWorker, freeze, unfreeze, takeover, mute };
}
