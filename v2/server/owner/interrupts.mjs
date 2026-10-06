import { HubError } from "../core/errors.mjs";
import { ACTIVE_STAGES } from "../factory/factory.mjs";
import { credentialTag, nextSuspension, classifySuspension, STOPPED_BY } from "../policy/gate-state.mjs";

/** D14: every refusal of „Continuă” for a suspension that is not the owner's own pause says where it IS reopened (never „Sistem”). */
const REARM_HERE = "o redeschid aici, în cockpit, cu Windows Hello (cardul „Redeschide poarta”); nimic vechi nu repornește singur";

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
 *  - „Continuă” (M10.2): reopens the gate only after the owner's OWN pause (same credential, no Stop All since) and resumes the
 *    plan missions that pause stopped, within their unchanged authority. Any other suspension (Stop All, a gate suspension, a pause
 *    without the owner's session, the shutdown) is reopened by the contextual rearm card in the cockpit (owner/gate-rearm.mjs:
 *    the owner session with a fresh Windows Hello, bound to that exact suspension); the typed OPEN GATE is only the legacy path.
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
      // Review M10.2 #6: the note names the commands that really resume it — „Continuă” (owner session) under the confirmed plan, or
      // „Reia misiunea …” — not the Factory's „Reia” button the zero-form owner never sees.
      try { const v = await factory.pause(f.missionId, { actor }); out.push({ missionId: f.missionId, title: f.title, from: f.stage, stage: v.factory.stage, note: "pasul activ a fost întrerupt; îl reiau când spui „Continuă” (sub planul confirmat) sau „Reia misiunea” (nu se numără ca încercare)" }); }
      catch (error) { out.push({ missionId: f.missionId, title: f.title, from: f.stage, error: error.message }); }
    }
    return out;
  }

  // ---------------------------------------------------------------- operation plans (review M10.2 #7)
  /**
   * The operation-plan service (ops/plans.mjs) is created after this module in hub.mjs; the intake attaches it (owner/intake.mjs),
   * so EVERY pause path — the typed „Pauză”, the spoken „Lega, pauză” (legaLate.ownerPause), the UI owner.interrupt — pauses the
   * running Studio / desktop plans in ONE place instead of a copy per caller (the spoken one used to leave a render running).
   */
  let opsPlans = null;
  const attachOpsPlans = (service) => { opsPlans = service && typeof service.active === "function" && typeof service.pause === "function" ? service : null; };
  /**
   * Pauses every RUNNING / CONFIRMED operation plan (fail-safe: nothing is undone or closed; resuming still needs opsPlans.resume in
   * an owner session). Never throws: a pause must always complete; a plan that refuses is skipped.
   */
  function pauseOpsPlans({ actor = "owner", reason = "Pauză (Lega)" } = {}) {
    if (!opsPlans) return [];
    let list = [];
    try { list = opsPlans.active().filter((p) => ["RUNNING", "CONFIRMED"].includes(p.status)); } catch { return []; }
    const paused = [];
    for (const p of list) { try { opsPlans.pause(p.id, { reason, actor }); paused.push(p.id); } catch { /* already settled */ } }
    return paused;
  }

  /**
   * A reference to the credential behind an owner session (re-read from the database; null without an active session). Only a
   * hash prefix is stored in the gate setting (settings are shown in the UI): enough to compare, nothing to reuse.
   */
  const credentialOf = (session) => {
    if (!session?.id) return null;
    const row = db.prepare("SELECT credential_id, status, expires_at FROM owner_sessions WHERE id = ?").get(String(session.id));
    return row && row.status === "active" && new Date(row.expires_at) > clock() ? credentialTag(row.credential_id) : null;
  };
  /** The channel of a pause from its actor when the caller did not name it (owner:<session>, voice[:<lega>], device:<id>). */
  const channelOfActor = (actor) => (/^owner:/.test(String(actor)) ? "owner" : /^voice/.test(String(actor)) ? "voice" : /^device:/.test(String(actor)) ? "companion" : actor === "agent" ? "agent" : null);

  async function pause({ projectId = null, actor = "owner", reason = "Pauză", session = null, channel = null } = {}) {
    const before = runs.activeRuns().filter((r) => !projectId || projectOfRun(r) === projectId).map((r) => r.runId);
    const paused = await pauseMissions(activeMissions(projectId), actor);
    let gate = settings.get("executionGate").status;
    if (!projectId && gate === "open") {
      // M10.2 (U11, owner decision 13): the suspension records WHOSE pause it is (the credential of the owner session that said it, the
      // time and the missions it paused), so „Continuă” in a session of that same credential can reopen exactly this — and nothing a
      // Stop All, a boot or another credential suspended. A pause without a session (a device, a provider transcript) records no
      // credential: it is reopened by the rearm card in the cockpit (owner session + fresh Windows Hello), never by „Continuă”.
      // M10.2.1 (D17): the same record every suspension writes (id, since, channel, actor), plus the missions this pause stopped.
      const credential = credentialOf(session);
      bus.transaction(() => {
        const at = iso();
        const suspendedBy = nextSuspension(settings.get("executionGate"), { kind: "pause", at, channel: channel || channelOfActor(actor), actor, credential,
          sessionId: session?.id || null, deviceId: /^device:/.test(String(actor)) ? String(actor).slice(7, 87) : null,
          extra: { missions: paused.filter((m) => !m.error).map((m) => m.missionId).slice(0, 20) } });
        settings.set("executionGate", { status: "suspended", reason: `${reason} (fără pași noi)`, changedAt: at, changedBy: actor, suspendedBy }, actor, reason);
      });
      gate = "suspended";
    }
    // A global pause also stops new operations of running operation plans (review #7: one place for every pause path).
    const plansPaused = projectId ? [] : pauseOpsPlans({ actor, reason: `${reason} (Lega)` });
    const { confirmed, unconfirmed } = await confirmStopped(before);
    bus.emit({ type: "owner.interrupt", scopeType: "owner", scopeId: projectId || "all", source: actor, payload: { kind: "pause", missions: paused.length, confirmed: confirmed.length, unconfirmed: unconfirmed.length, plansPaused: plansPaused.length } });
    return { kind: "pause", projectId, gate, missions: paused, plansPaused, runsStopped: confirmed, runsUnconfirmed: unconfirmed,
      summary: `${paused.length ? `${paused.length} misiun${paused.length === 1 ? "e pusă" : "i puse"} pe pauză${unconfirmed.length ? `; ${unconfirmed.length} execuții încă neconfirmate ca oprite` : ""}` : "Nicio misiune activă; nimic nou nu pornește"}${plansPaused.length ? `; ${plansPaused.length === 1 ? "un plan de operare oprit" : `${plansPaused.length} planuri de operare oprite`} (le reiei cu „Continuă”)` : ""}` };
  }

  /**
   * „Continuă” after the owner's OWN pause (M10.2 U11, owner decision 13). Reopens the execution gate only when ALL hold: the gate is
   * suspended by a pause (suspendedBy.kind = "pause") recorded with a credential, the session saying „Continuă” is an active owner
   * session of that SAME credential, no Stop All happened since that pause, and no lease is retained. Then the missions that pause
   * stopped resume — only those still PAUSED under a plan still in force, within their unchanged authority (factory.resume refuses
   * any widening). Anything else — a Stop All, a gate suspension, a pause without the owner's session or of another credential, the
   * shutdown, the first start — is refused here with `rearm: true`: the caller shows the contextual rearm card (owner/gate-rearm.mjs,
   * a fresh Windows Hello bound to that exact suspension), never an administration pointer. Called by the intake for the owner
   * channel (typed or locally verified voice); a provider transcript never reaches it (effect class).
   * Refusals: { reopened: false, code, reason, rearm }.
   */
  async function resumeOwnPause({ session = null, actor = "owner" } = {}) {
    const g = settings.get("executionGate") || {};
    const none = (why, code, rearm = false) => ({ kind: "continue", reopened: false, gate: g.status || "suspended", missions: [], reason: why, code, rearm });
    if (g.status === "open") return none("Poarta e deschisă; nu era nimic de redeschis.", "OPEN");
    const by = g.suspendedBy;
    if (!by || by.kind !== "pause") {
      const cls = classifySuspension(g).cls;
      return none(`Poarta e oprită ${STOPPED_BY[cls] || STOPPED_BY.legacy_unknown}, nu de pauza ta: ${REARM_HERE}.`, "NOT_OWN_PAUSE", true);
    }
    const credential = credentialOf(session);
    if (!credential) throw new HubError("authentication", "„Continuă” redeschide poarta doar în sesiunea ta de proprietar (Windows Hello / cheia ta)");
    if (!by.credential) return none(`Pauza a fost pusă fără sesiunea ta de proprietar (de pe un dispozitiv sau dintr-o transcriere): ${REARM_HERE}.`, "NOT_OWN_PAUSE", true);
    if (by.credential !== credential) return none(`Pauza a fost pusă din altă sesiune a ta (alt autentificator): ${REARM_HERE}.`, "OTHER_CREDENTIAL", true);
    const stopAll = db.prepare("SELECT seq FROM events WHERE type = 'system.stop_all' AND created_at >= ? ORDER BY seq DESC LIMIT 1").get(String(by.at || ""));
    if (stopAll) return none(`După pauza ta a urmat un Stop All: ${REARM_HERE}.`, "STOP_ALL_AFTER", true);
    const retained = db.prepare("SELECT COUNT(*) AS n FROM leases WHERE status = 'retained'").get().n;
    if (retained) return none(`${retained === 1 ? "Un spațiu de lucru e încă rezervat" : `${retained} spații de lucru sunt încă rezervate`} după o oprire neconfirmată (lease-uri reținute); până nu sunt eliberate nu redeschid poarta.`, "LEASES");
    const opened = { status: "open", reason: "Continuă după pauza ta", changedAt: iso(), changedBy: actor, reopenedAfter: { at: by.at, sessionId: session.id } };
    // Compare-and-set: a Stop All (or any other write) landing meanwhile is never overwritten.
    const done = bus.transaction(() => {
      const now_ = settings.get("executionGate") || {};
      if (now_.status !== "suspended" || now_.suspendedBy?.at !== by.at || now_.suspendedBy?.credential !== by.credential) return false;
      settings.set("executionGate", opened, actor, "Continuă după pauza proprietarului");
      return true;
    });
    if (!done) { const nowOpen = (settings.get("executionGate") || {}).status === "open"; return none("Starea porții s-a schimbat între timp; nu o redeschid.", "CHANGED", !nowOpen); }
    const resumed = [];
    for (const missionId of by.missions || []) {
      const f = factory.list().find((x) => x.missionId === missionId);
      const plan = envelopes?.envelopeOfMission ? envelopes.envelopeOfMission(missionId) : null;
      // Review #8: a mission whose plan closed meanwhile continues through a CONTINUATION plan (one confirmation of what remains),
      // said as the sentence that prepares it — never "din Fabrică", a form the zero-form owner does not use.
      if (!f || f.stage !== "PAUSED" || !plan) { resumed.push({ missionId, title: f?.title || null, resumed: false, planClosed: Boolean(f) && !plan, note: !plan ? `nu mai e sub un plan în vigoare: spune „Reia misiunea ${f?.title || missionId}” pentru un plan de continuare` : `e în ${f?.stage || "—"}` }); continue; }
      try { const v = await factory.resume(missionId, { actor }); resumed.push({ missionId, title: f.title, resumed: true, stage: v.factory.stage }); }
      catch (error) { resumed.push({ missionId, title: f.title, resumed: false, note: error.message }); }
    }
    bus.emit({ type: "owner.interrupt", scopeType: "owner", scopeId: "all", source: actor, payload: { kind: "continue", missions: resumed.filter((m) => m.resumed).length, pausedAt: by.at } });
    const n = resumed.filter((m) => m.resumed).length;
    // M10.2.1 (D20): a mission whose plan closed (expired) during the pause is named with its continuation pointer, never left unsaid.
    const closed = resumed.filter((m) => m.planClosed && m.title).slice(0, 3);
    return { kind: "continue", reopened: true, gate: "open", missions: resumed,
      summary: `Am redeschis poarta după pauza ta${n ? `; ${n} misiun${n === 1 ? "e reluată" : "i reluate"} în aceleași limite` : ""}.${closed.length
        ? ` ${closed.map((m) => `„${m.title}”`).join(", ")} nu ${closed.length === 1 ? "mai e" : "mai sunt"} sub un plan în vigoare: spune Reia misiunea „${closed[0].title}” și îți pregătesc un plan de continuare (îl confirmi o dată).` : ""}` };
  }

  async function stopWorker({ provider, actor = "owner", session = null }) {
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
    // Review M10.2 #6: the missions this stop paused and the credential reference of the owner session that said it (a hash prefix,
    // as in the gate setting; null without a session) are kept in the audit event — never in the gate setting — so „Continuă” in a
    // session of that credential knows the pause was the owner's own (resumeStopped below).
    bus.emit({ type: "owner.interrupt", scopeType: "owner", scopeId: provider, source: actor, payload: { kind: "stop_worker", confirmed: confirmed.length, unconfirmed: unconfirmed.length,
      missions: missionsPaused.filter((m) => !m.error).map((m) => m.missionId).slice(0, 20), credential: credentialOf(session) } });
    return { kind: "stop_worker", provider, missions: missionsPaused, runsStopped: confirmed, runsUnconfirmed: unconfirmed,
      summary: unconfirmed.length ? `Oprire cerută; ${unconfirmed.length} execuții încă neconfirmate` : `Oprit (${confirmed.length} execuții confirmate ca oprite)${missionsPaused.length ? "; misiunea e pe pauză (spune „Continuă” ca s-o reiau în aceleași limite)" : ""}` };
  }

  // ---------------------------------------------------------------- „Continuă” with the gate already open (review M10.2 #6 / #8)
  /** Who stopped a PAUSED mission last: the source of its newest PAUSED factory.stage event. */
  const pausedBy = (missionId) => db.prepare("SELECT source FROM events WHERE type = 'factory.stage' AND scope_type = 'mission' AND scope_id = ? AND json_extract(payload_json, '$.stage') = 'PAUSED' ORDER BY seq DESC LIMIT 1").get(String(missionId))?.source || null;
  /** Whether the owner's own „Oprește Codex/Claude” (this credential) paused the mission: the stop_worker audit lists it. */
  const stoppedByCredential = (missionId, credential) => Boolean(credential) && db.prepare(`SELECT 1 FROM events WHERE type = 'owner.interrupt' AND json_extract(payload_json, '$.kind') = 'stop_worker'
    AND json_extract(payload_json, '$.credential') = ? AND EXISTS (SELECT 1 FROM json_each(json_extract(events.payload_json, '$.missions')) WHERE value = ?) LIMIT 1`).get(credential, String(missionId));
  /**
   * Whether „Continuă” (or „Reia misiunea X”) in the owner session may resume this mission INSIDE its confirmed plan right now:
   * { ok, why, env, mission }. Only a mission of an OPEN, unexpired plan with no hold (a hold IS the plan's answer: an objective's
   * dependency, a start failure), while the gate is open, that stopped:
   *  - PAUSED — by the owner (any owner surface, or this credential's „Oprește Codex”), never a pause an agent or the plan service made
   *    (an agent's pause is resumed through its own delegation; the plan service pauses only when the plan closes);
   *  - BLOCKED — for anything but the plan's authority ("grant": the plan's budget, a difference to confirm). A step the gate refused
   *    ("gate") resumes once the gate is open NOW (2.12.1, SM-01: a pause or a suspension lifted by the rearm left it there for good):
   *    factory.resume dispatches it again and the gate decides that step anew — a cause that still fails puts it back in BLOCKED with
   *    its own reason; nothing is widened;
   *  - NEEDS_OWNER_DECISION — with no exhausted step and its repair cycles not used up (those need a confirmed difference).
   * Read-only; factory.resume re-checks everything under authorityFor RESUME (it never widens cycles, attempts or time).
   */
  function planResumeCheck(missionId, session = null) {
    const f = factory.list().find((x) => x.missionId === missionId) || null;
    const no = (why, env = null) => ({ ok: false, why, env, mission: f });
    if (!f) return no("misiunea nu e o misiune Software Factory");
    const env = envelopes?.envelopeOfMission ? envelopes.envelopeOfMission(missionId) : null;
    if (!env || env.body?.kind === "run") return no(`„${f.title}” nu e sub un plan în vigoare: spune „Continuă misiunea ${f.title}” pentru un plan de continuare`);
    if (!(Date.parse(env.expiresAt) > clock().getTime())) return no("timpul planului s-a terminat: un plan de continuare îți arată doar ce rămâne", env);
    if (env.derived?.hold) return no(String(env.derived.hold).slice(0, 240), env);
    if (env.currentMissionId && env.currentMissionId !== missionId) return no(`„${f.title}” nu e sarcina curentă a planului`, env);
    if ((settings.get("executionGate") || {}).status !== "open") return no("poarta de execuție e suspendată", env);
    if (f.stage === "PAUSED") {
      const by = pausedBy(missionId);
      if ((by === "agent" || /^envelope/.test(String(by || ""))) && !stoppedByCredential(missionId, credentialOf(session))) return no(`„${f.title}” a fost pusă pe pauză de ${by === "agent" ? "un agent" : "plan"}, nu de tine`, env);
      return { ok: true, why: null, env, mission: f };
    }
    if (f.stage === "BLOCKED") {
      if (f.waitReason === "grant") return no(`„${f.title}” a rămas fără încercările confirmate în plan: confirmă diferența din cockpit (o încercare în plus)`, env);
      // "gate": the stored reason is the refusal of THEN; the gate is open now (checked above), so the dispatch re-runs every check.
      return { ok: true, why: null, env, mission: f };
    }
    if (f.stage === "NEEDS_OWNER_DECISION") {
      const step = factory.exhaustedStep ? factory.exhaustedStep(missionId) : null;
      if (step) return no(`„${f.title}”: etapa ${step.stage} și-a folosit încercările confirmate (${step.counted}/${step.limit}); confirmă diferența din cockpit (o încercare în plus)`, env);
      const max = Number(f.limits?.maxRepairCycles);
      if (Number.isFinite(max) && Number(f.repairCycles) >= max) return no(`„${f.title}” a folosit ciclurile de remediere confirmate (${f.repairCycles}/${max}); confirmă diferența din cockpit (un ciclu în plus)`, env);
      return { ok: true, why: null, env, mission: f };
    }
    return no(`„${f.title}” e în ${f.stage}${["CONFIRMED", "ACTIVE"].includes(env.status) ? " (rulează sub planul tău)" : ""}`, env);
  }

  /**
   * Resumes, in the owner session, the stopped missions of open plans (review #6/#8) — one named mission, or the ONE that qualifies;
   * several qualifying → { question } with the Hub's own options (nothing resumed). Each resume is factory.resume with the owner as
   * actor and NO allowExtraCycle / proceedToQa / reviewerModel, so the plan stays exactly as confirmed. Missions of open plans that do
   * not qualify come back in `waiting` with the honest reason (a hold, a difference to confirm).
   */
  async function resumeStopped({ session = null, actor = "owner", missionId = null } = {}) {
    if (!credentialOf(session)) throw new HubError("authentication", "„Continuă” reia lucrul doar în sesiunea ta de proprietar (Windows Hello / cheia ta)");
    const ids = missionId ? [missionId] : [...new Set(factory.list().filter((f) => ["PAUSED", "BLOCKED", "NEEDS_OWNER_DECISION"].includes(f.stage)).map((f) => f.missionId))];
    const checks = ids.map((id) => ({ id, ...planResumeCheck(id, session) })).filter((c) => missionId || c.env);
    const ready = checks.filter((c) => c.ok);
    const waiting = checks.filter((c) => !c.ok).map((c) => ({ missionId: c.id, title: c.mission?.title || null, why: c.why }));
    if (!missionId && ready.length > 1) {
      return { kind: "continue", missions: [], waiting, question: { question: `Care misiune reiau: ${ready.slice(0, 4).map((c) => `„${c.mission.title}”`).join(" sau ")}?`,
        options: ready.slice(0, 4).map((c) => ({ id: c.id, label: c.mission.title })), forIntent: "ops_continue" } };
    }
    const resumed = [];
    for (const c of ready.slice(0, 1)) {
      try { const v = await factory.resume(c.id, { actor }); resumed.push({ missionId: c.id, title: c.mission.title, resumed: true, stage: v.factory.stage }); }
      catch (error) { resumed.push({ missionId: c.id, title: c.mission.title, resumed: false, note: error.message }); }
    }
    if (resumed.length) bus.emit({ type: "owner.interrupt", scopeType: "owner", scopeId: "all", source: actor, payload: { kind: "continue_plan", missions: resumed.filter((m) => m.resumed).map((m) => m.missionId) } });
    const ok = resumed.filter((m) => m.resumed);
    const refused = resumed.filter((m) => !m.resumed);
    const summary = ok.length ? `Am reluat „${ok[0].title}” în aceleași limite ale planului confirmat.`
      : refused.length ? `Nu am putut relua „${refused[0].title}”: ${String(refused[0].note || "").slice(0, 240)}`
        : waiting.length ? `Nu reiau nimic: ${waiting.slice(0, 2).map((w) => w.why).join(" · ")}.` : null;
    return { kind: "continue", missions: resumed, waiting, summary };
  }

  async function freeze({ projectId, actor = "owner" }) {
    const project = projects.get(projectId);
    if (!project) throw new HubError("not_found", "Proiect necunoscut");
    bus.transaction(() => settings.set("projectFreeze", { ...settings.get("projectFreeze"), [project.id]: { at: iso(), by: actor } }, actor, `Project frozen: ${project.name}`));
    const open = envelopes.openFor(project.id);
    if (open) envelopes.revoke(open.id, { actor, reason: `Proiect înghețat: ${project.name}`, pauseMission: false }); // paused right below
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
    if (open) envelopes.revoke(open.id, { actor, reason: "Proprietarul preia controlul", pauseMission: false }); // paused right below
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

  return { pause, resumeOwnPause, resumeStopped, planResumeCheck, stopWorker, freeze, unfreeze, takeover, mute, attachOpsPlans, pauseOpsPlans };
}
