import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { assertTransition } from "../runtime/lifecycles.mjs";
import { canonicalJson } from "../core/canonical.mjs";

export const SCHEDULE_BACKENDS = Object.freeze(["LOCAL_HUB", "CLAUDE_NATIVE", "OPENAI_NATIVE", "OPENCLAW"]);
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * Cadence grammar (local machine time): "hourly", "every <N>m" (5..1440), "daily HH:MM",
 * "weekdays HH:MM", "weekly <mon..sun> HH:MM". Returns a function giving the slot key and time of the
 * most recent due slot at or before `now` — slots make runs idempotent across restarts.
 */
const pad = (n) => String(n).padStart(2, "0");

/** Parses a cadence; `text` is the canonical form (e.g. "hourly" and "every 060m" both become "every 60m"). */
export function parseCadence(text) {
  const t = String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
  let m;
  if (t === "hourly") return { kind: "every", minutes: 60, text: "every 60m" };
  if ((m = t.match(/^every (\d{1,4})m$/))) {
    const minutes = Number(m[1]);
    if (minutes < 5 || minutes > 1440) throw new HubError("validation", "every Nm: N must be 5..1440");
    return { kind: "every", minutes, text: `every ${minutes}m` };
  }
  if ((m = t.match(/^(daily|weekdays) ([01]\d|2[0-3]):([0-5]\d)$/))) return { kind: m[1], hour: Number(m[2]), minute: Number(m[3]), text: `${m[1]} ${pad(m[2])}:${pad(m[3])}` };
  if ((m = t.match(/^weekly (sun|mon|tue|wed|thu|fri|sat) ([01]\d|2[0-3]):([0-5]\d)$/))) return { kind: "weekly", day: DAYS.indexOf(m[1]), hour: Number(m[2]), minute: Number(m[3]), text: `weekly ${m[1]} ${pad(m[2])}:${pad(m[3])}` };
  throw new HubError("validation", "Cadence: hourly | every Nm | daily HH:MM | weekdays HH:MM | weekly mon HH:MM");
}

/** Most recent slot at or before `now` (null when none is due yet, e.g. a weekly slot later this week before the first week). */
export function lastSlot(cadence, now) {
  const c = typeof cadence === "string" ? parseCadence(cadence) : cadence;
  if (c.kind === "every") {
    const ms = c.minutes * 60000;
    const start = Math.floor(now.getTime() / ms) * ms;
    return { key: new Date(start).toISOString(), at: new Date(start) };
  }
  const probe = new Date(now);
  for (let back = 0; back < 8; back += 1) {
    const d = new Date(probe.getFullYear(), probe.getMonth(), probe.getDate() - back, c.hour, c.minute, 0, 0);
    if (d > now) continue;
    const dow = d.getDay();
    if (c.kind === "weekdays" && (dow === 0 || dow === 6)) continue;
    if (c.kind === "weekly" && dow !== c.day) continue;
    return { key: d.toISOString(), at: d };
  }
  return null;
}

export function nextSlot(cadence, now) {
  const c = typeof cadence === "string" ? parseCadence(cadence) : cadence;
  if (c.kind === "every") {
    const ms = c.minutes * 60000;
    return new Date((Math.floor(now.getTime() / ms) + 1) * ms);
  }
  for (let ahead = 0; ahead < 9; ahead += 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead, c.hour, c.minute, 0, 0);
    if (d <= now) continue;
    const dow = d.getDay();
    if (c.kind === "weekdays" && (dow === 0 || dow === 6)) continue;
    if (c.kind === "weekly" && dow !== c.day) continue;
    return d;
  }
  return null;
}

/**
 * Scheduling with ONE owner per intent. The Hub stores schedule intent + ownership; the execution
 * backend is LOCAL_HUB, CLAUDE_NATIVE, OPENAI_NATIVE or OPENCLAW. `intent_key` is unique, so the same
 * recurring work cannot be registered twice on different backends. The Hub only executes LOCAL_HUB
 * schedules, and only commands allowed on the `schedule` channel; native schedules are references the
 * owner creates in the vendor product (the Hub never creates or triggers them in BUILD_SAFE).
 */
export function createSchedules({ db, bus, clock, settings }) {
  const rowTo = (r) => r && ({ id: r.id, intentKey: r.intent_key, name: r.name, description: r.description, cadence: r.cadence, timezone: r.timezone,
    backend: r.backend, owner: r.owner, departmentId: r.department_id, action: parse(r.action_json, {}), usesAi: Boolean(r.uses_ai),
    externalEffects: Boolean(r.external_effects), status: r.status, statusReason: r.status_reason, nextRunAt: r.next_run_at, lastRunAt: r.last_run_at,
    lastResult: r.last_result, createdAt: r.created_at, updatedAt: r.updated_at, version: r.version });
  const rowToRef = (r) => r && ({ id: r.id, scheduleId: r.schedule_id, backend: r.backend, nativeId: r.native_id, nativeLabel: r.native_label, state: r.state,
    stateReason: r.state_reason, lastSeenAt: r.last_seen_at, evidence: parse(r.evidence_json, {}), createdAt: r.created_at, updatedAt: r.updated_at });

  const get = (id) => rowTo(db.prepare("SELECT * FROM schedules WHERE id = ?").get(id));
  const list = () => db.prepare("SELECT * FROM schedules ORDER BY status, name").all().map(rowTo)
    .map((s) => ({ ...s, nativeRef: rowToRef(db.prepare("SELECT * FROM native_schedule_refs WHERE schedule_id = ? AND state <> 'DETACHED' ORDER BY created_at DESC LIMIT 1").get(s.id)) }));
  const refsOf = (scheduleId) => db.prepare("SELECT * FROM native_schedule_refs WHERE schedule_id = ? ORDER BY created_at DESC").all(scheduleId).map(rowToRef);
  const runs = (scheduleId, limit = 30) => db.prepare("SELECT * FROM schedule_runs WHERE schedule_id = ? ORDER BY started_at DESC LIMIT ?").all(scheduleId, limit)
    .map((r) => ({ id: r.id, slot: r.slot, backend: r.backend, status: r.status, result: parse(r.result_json, {}), startedAt: r.started_at, finishedAt: r.finished_at }));

  // Canonical intent: command + canonical JSON payload (key order irrelevant) + canonical cadence.
  const intentKeyOf = (action, cadence, explicit) => (explicit ? String(explicit).trim().toLowerCase()
    : `${action.command}:${canonicalJson(action.payload || {})}@${parseCadence(cadence).text}`).slice(0, 300);

  /** Must run inside bus.transaction. */
  function create({ name, description = "", cadence, backend = "LOCAL_HUB", departmentId = null, action, usesAi = false, externalEffects = false, intentKey = null }, actor = "user") {
    if (!SCHEDULE_BACKENDS.includes(backend)) throw new HubError("validation", "Unknown schedule backend");
    parseCadence(cadence);
    if (!action?.command || typeof action.command !== "string") throw new HubError("validation", "action.command is required");
    const key = intentKeyOf(action, cadence, intentKey);
    const clash = db.prepare("SELECT id, backend, status FROM schedules WHERE intent_key = ? AND status <> 'RETIRED'").get(key);
    if (clash) throw new HubError("conflict", `Aceeași intenție există deja (${clash.id}, backend ${clash.backend}); un singur scheduler o poate deține`, { data: { scheduleId: clash.id } });
    const id = newId("sch");
    const now = clock().toISOString();
    try {
      db.prepare(`INSERT INTO schedules (id, intent_key, name, description, cadence, backend, owner, department_id, action_json, uses_ai, external_effects, status, status_reason, next_run_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'hub', ?, ?, ?, ?, 'DRAFT', 'Creat', ?, ?, ?)`)
        .run(id, key, name, description, parseCadence(cadence).text, backend, departmentId, json(action), usesAi ? 1 : 0, externalEffects ? 1 : 0,
          nextSlot(cadence, clock())?.toISOString() || null, now, now);
    } catch (error) {
      if (/UNIQUE/i.test(error.message)) throw new HubError("conflict", "Aceeași intenție a fost înregistrată concurent; un singur scheduler o poate deține");
      throw error;
    }
    bus.append({ type: "schedule.created", scopeType: "schedule", scopeId: id, departmentId, source: actor, payload: { name, backend, cadence, usesAi, externalEffects } });
    if (backend !== "LOCAL_HUB") proposeNativeRef(id, actor);
    return get(id);
  }

  /** Why a schedule cannot be ACTIVE right now (null when it can). */
  function activationProblem(s, allowedLocalCommands) {
    if (s.backend === "OPENCLAW") return "OpenClaw este retras din runtime-ul V2 (vezi V2_FRAMEWORK_EVALUATION); nu poate deține programări";
    if (s.backend === "LOCAL_HUB") {
      if (s.externalEffects) return "Programările locale cu efecte externe nu sunt permise în acest build";
      if (s.usesAi && settings.get("mode") === "BUILD_SAFE") return "BUILD_SAFE: o programare care pornește modele are nevoie de LIVE_VALIDATION/OPERATIONAL și trece prin poarta de execuție";
      if (!allowedLocalCommands.has(s.action.command)) return `Comanda ${s.action.command} nu este permisă pe canalul schedule`;
      return null;
    }
    const ref = db.prepare("SELECT * FROM native_schedule_refs WHERE schedule_id = ? AND state NOT IN ('DETACHED') ORDER BY created_at DESC LIMIT 1").get(s.id);
    if (!ref || !["LINKED", "ACTIVE", "PAUSED"].includes(ref.state)) return "Programarea nativă trebuie creată de tine în produsul vendorului și legată aici (ID nativ) înainte de activare";
    return null;
  }

  /** Must run inside bus.transaction. */
  function transition(id, to, { reason, actor = "user", allowedLocalCommands = new Set() }) {
    const s = get(id);
    if (!s) throw new HubError("not_found", "Schedule not found");
    if (!assertTransition("schedule", s.status, to, reason)) return s;
    if (to === "ACTIVE") {
      const problem = activationProblem(s, allowedLocalCommands);
      if (problem) throw new HubError("policy", problem);
    }
    const now = clock();
    // Activation marks the current slot as handled, so activating never fires an immediate catch-up run.
    const baseline = to === "ACTIVE" ? lastSlot(s.cadence, now)?.at.toISOString() || null : null;
    db.prepare("UPDATE schedules SET status = ?, status_reason = ?, next_run_at = ?, last_run_at = CASE WHEN ? IS NOT NULL AND (last_run_at IS NULL OR last_run_at < ?) THEN ? ELSE last_run_at END, updated_at = ?, version = version + 1 WHERE id = ?")
      .run(to, reason, to === "ACTIVE" ? nextSlot(s.cadence, now)?.toISOString() || null : s.nextRunAt, baseline, baseline, baseline, now.toISOString(), id);
    const ref = db.prepare("SELECT * FROM native_schedule_refs WHERE schedule_id = ? AND state NOT IN ('DETACHED') ORDER BY created_at DESC LIMIT 1").get(id);
    if (ref) {
      const refTo = to === "ACTIVE" ? "ACTIVE" : to === "PAUSED" ? "PAUSED" : to === "RETIRED" ? "DETACHED" : null;
      if (refTo && refTo !== ref.state && ["LINKED", "ACTIVE", "PAUSED", "ORPHANED", "PROPOSED", "PENDING_USER_SETUP"].includes(ref.state)) {
        try { transitionRef(ref.id, refTo, `Programarea Hub a trecut în ${to}`, actor); } catch { /* reference stays as is; shown in UI */ }
      }
    }
    bus.append({ type: `schedule.${to.toLowerCase()}`, scopeType: "schedule", scopeId: id, source: actor, payload: { from: s.status, to, reason, backend: s.backend } });
    return get(id);
  }

  // ---------- native references (NativeScheduledTaskReference) ----------
  function proposeNativeRef(scheduleId, actor = "user") {
    const s = get(scheduleId);
    const id = newId("nsr");
    const now = clock().toISOString();
    db.prepare("INSERT INTO native_schedule_refs (id, schedule_id, backend, state, state_reason, created_at, updated_at) VALUES (?, ?, ?, 'PROPOSED', 'Propusă de Hub', ?, ?)")
      .run(id, scheduleId, s.backend, now, now);
    transitionRef(id, "PENDING_USER_SETUP", "Hub-ul nu creează programări native; creeaz-o tu și înregistrează ID-ul", actor);
    return id;
  }

  /** Must run inside bus.transaction. */
  function transitionRef(refId, to, reason, actor = "user", patch = {}) {
    const ref = rowToRef(db.prepare("SELECT * FROM native_schedule_refs WHERE id = ?").get(refId));
    if (!ref) throw new HubError("not_found", "Native schedule reference not found");
    if (!assertTransition("nativeScheduleRef", ref.state, to, reason)) return ref;
    db.prepare("UPDATE native_schedule_refs SET state = ?, state_reason = ?, native_id = COALESCE(?, native_id), native_label = COALESCE(?, native_label), last_seen_at = COALESCE(?, last_seen_at), evidence_json = COALESCE(?, evidence_json), updated_at = ?, version = version + 1 WHERE id = ?")
      .run(to, reason, patch.nativeId ?? null, patch.nativeLabel ?? null, patch.lastSeenAt ?? null, patch.evidence ? json(patch.evidence) : null, clock().toISOString(), refId);
    bus.append({ type: "schedule.native_ref", scopeType: "schedule", scopeId: ref.scheduleId, source: actor, payload: { refId, from: ref.state, to, backend: ref.backend, reason } });
    return rowToRef(db.prepare("SELECT * FROM native_schedule_refs WHERE id = ?").get(refId));
  }

  /** Records the native id the owner created (e.g. a Claude scheduled task). Must run inside bus.transaction. */
  function linkNative(scheduleId, { nativeId, nativeLabel = "", evidence = {} }, actor = "user") {
    if (!nativeId || String(nativeId).trim().length < 3) throw new HubError("validation", "nativeId is required");
    const ref = db.prepare("SELECT * FROM native_schedule_refs WHERE schedule_id = ? AND state IN ('PENDING_USER_SETUP','ORPHANED') ORDER BY created_at DESC LIMIT 1").get(scheduleId);
    if (!ref) throw new HubError("conflict", "No native reference waiting for a link");
    return transitionRef(ref.id, "LINKED", "ID nativ înregistrat de tine", actor, { nativeId: String(nativeId).trim().slice(0, 200), nativeLabel: String(nativeLabel).slice(0, 200), lastSeenAt: clock().toISOString(), evidence });
  }

  /** Setup instructions for native schedules (assisted; nothing is created by the Hub). */
  function nativeSetupInstructions(scheduleId) {
    const s = get(scheduleId);
    if (!s) throw new HubError("not_found", "Schedule not found");
    const prompt = s.action.prompt || s.description || s.name;
    const common = [`Nume: ${s.name}`, `Cadență: ${s.cadence} (ora locală)`, `Prompt/instrucțiuni: ${prompt}`, "Nu include secrete. Fără trimiteri externe, commit, push sau plăți fără aprobarea ta."];
    const steps = {
      CLAUDE_NATIVE: ["Hub-ul nu creează și nu pornește programarea: o creezi tu.", "Claude Desktop → Scheduled tasks (local) sau Claude Code → /schedule (rutină în cloud; consumă din planul Claude).", ...common, "După creare, copiază ID-ul/numele taskului în Hub → Programări → Leagă ID nativ."],
      OPENAI_NATIVE: ["Hub-ul nu creează și nu pornește programarea: o creezi tu.", "ChatGPT → automatizare/task programat (doar dacă planul tău o include).", ...common, "După creare, înregistrează ID-ul/numele în Hub."],
      OPENCLAW: ["OpenClaw este retras din runtime-ul V2; nu crea programări OpenClaw noi."],
      LOCAL_HUB: ["Programare locală: Hub-ul o execută singur, fără instrucțiuni externe."],
    };
    return { scheduleId, backend: s.backend, steps: steps[s.backend], usageNote: s.backend === "LOCAL_HUB" ? "Fără consum de abonament dacă nu folosește modele." : "Rularea nativă consumă din allowance-ul planului vendorului; Hub-ul nu o pornește." };
  }

  /**
   * Local runner step: executes each due ACTIVE LOCAL_HUB schedule at most once per slot. After a
   * restart only the most recent missed slot runs (catch-up once, never a burst). `execute` is the
   * command bus dispatcher bound to the `schedule` channel.
   */
  async function tick(execute) {
    const now = clock();
    const due = db.prepare("SELECT * FROM schedules WHERE status = 'ACTIVE' AND backend = 'LOCAL_HUB'").all().map(rowTo);
    const results = [];
    for (const s of due) {
      const slot = lastSlot(s.cadence, now);
      if (!slot || (s.lastRunAt && new Date(s.lastRunAt) >= slot.at) || slot.at < new Date(s.createdAt)) continue;
      // A model-using schedule never runs in BUILD_SAFE (every restart returns to BUILD_SAFE).
      if (s.usesAi && settings.get("mode") === "BUILD_SAFE") {
        if (s.lastResult !== "skipped_build_safe") bus.transaction(() => {
          db.prepare("UPDATE schedules SET last_result = 'skipped_build_safe', updated_at = ? WHERE id = ?").run(now.toISOString(), s.id);
          bus.append({ type: "schedule.skipped", scopeType: "schedule", scopeId: s.id, source: "scheduler", payload: { slot: slot.key, reason: "BUILD_SAFE: fără modele" } });
        });
        continue;
      }
      const runId = newId("srun");
      try {
        db.prepare("INSERT INTO schedule_runs (id, schedule_id, slot, backend, status, started_at) VALUES (?, ?, ?, 'LOCAL_HUB', 'running', ?)").run(runId, s.id, slot.key, now.toISOString());
      } catch { continue; /* slot already claimed (UNIQUE schedule_id+slot) */ }
      let status = "completed"; let result = {};
      try { result = await execute({ type: s.action.command, payload: s.action.payload || {}, correlationId: `sch:${s.id}:${slot.key}` }); }
      catch (error) { status = "failed"; result = { error: String(error.message || error).slice(0, 500), category: error.category || "internal" }; }
      const finished = clock().toISOString();
      bus.transaction(() => {
        db.prepare("UPDATE schedule_runs SET status = ?, result_json = ?, finished_at = ? WHERE id = ?").run(status, json(summarize(result)), finished, runId);
        db.prepare("UPDATE schedules SET last_run_at = ?, last_result = ?, next_run_at = ?, updated_at = ? WHERE id = ?")
          .run(slot.at.toISOString(), status, nextSlot(s.cadence, now)?.toISOString() || null, finished, s.id);
        bus.append({ type: status === "completed" ? "schedule.ran" : "schedule.run_failed", scopeType: "schedule", scopeId: s.id, source: "scheduler", payload: { slot: slot.key, status } });
      });
      results.push({ scheduleId: s.id, slot: slot.key, status });
    }
    return results;
  }

  return { create, get, list, refsOf, runs, transition, transitionRef, linkNative, nativeSetupInstructions, tick, activationProblem };
}

function summarize(result) {
  const text = JSON.stringify(result ?? {});
  return text.length > 4000 ? { truncated: true, size: text.length } : result;
}
