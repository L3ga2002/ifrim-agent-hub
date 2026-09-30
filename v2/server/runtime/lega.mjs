import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { redactText } from "../security/redact.mjs";
import { parseVoiceCommand } from "../domain/voice.mjs";
import { LEGA_DEFAULTS, LEGA_SCREENS, LEGA_COST_PER_MINUTE_USD, LEGA_TASK_MAX, validateOfferSdp, speakable } from "../policy/lega-policy.mjs";

const NEGOTIATION_TIMEOUT_MS = 20000;
const CORROBORATION_MS = 20000;

/**
 * Lega session manager: one voice session at a time, admitted by gate.evaluateVoice (mode, gate, voice grant, consent,
 * billing route, realtime config, isolation, breaker), with a hard duration cap and an idle timeout.
 *
 * How Lega acts:
 * - deterministic, fail-safe commands from the OWNER's final transcript only. Global ones (Stop All, pause) must be
 *   addressed ("Lega, oprește tot") or explicit ("oprește tot"); a bare "stop" only silences Lega;
 * - everything else through the Codex agent behind the voice model, which has only the `lega.*` tools. Anything with
 *   effects becomes a hash-bound approval the owner confirms by click; the run then goes through the normal gate. The
 *   agent's stop/pause tools act only when the owner just said the same thing (agent output is never a command);
 * - results come back as a short, framed, redacted spoken summary (appendSpeech), never code.
 * Audio never passes through the Hub; only final transcript text is kept (redacted), never audio.
 */
export function createLega({ bus, live, clock, settings, gate, grants, projects, approvals, runsApi, commandsApi, codexRealtime, refreshCodexConfig = () => {}, codexConfig = () => null, timeScale = 1 }) {
  const ms = (value) => Math.max(10, Math.round(value * timeScale));
  let session = null; // the single live session
  const pendingRuns = new Map(); // runId -> { sessionId, task }

  const minutesOf = (s) => Math.max(0, ((s.endedAt ? new Date(s.endedAt) : clock()) - new Date(s.connectedAt)) / 60000);
  const publicView = (s) => s && ({ id: s.id, status: s.status, voice: s.voice, startedAt: s.startedAt, connectedAt: s.connectedAt || null,
    endedAt: s.endedAt || null, endReason: s.endReason || null, maxDurationS: s.maxDurationS, idleTimeoutS: s.idleTimeoutS, grantId: s.grantId,
    minutes: s.connectedAt ? minutesOf(s) : 0, costEstimateUsd: s.connectedAt ? Math.round(minutesOf(s) * LEGA_COST_PER_MINUTE_USD * 100) / 100 : 0,
    phase: s.phase || "idle" });
  const legaSettings = () => ({ ...LEGA_DEFAULTS, ...(settings.get("lega") || {}) });
  const executableProjects = () => projects.list().filter((p) => p.executionAllowed).map((p) => ({ id: p.id, name: p.name }));
  const isLive = (s) => s && s === session && (s.status === "connecting" || s.status === "active");

  const setPhase = (s, phase, detail = "") => {
    if (!isLive(s)) return; // never publish a phase for a session that is stopping or ended
    s.phase = phase;
    live.publish({ type: "lega.phase", sessionId: s.id, phase, detail });
  };

  /** Idle stop only when nothing is in progress: an open delegated turn or a run Lega started keeps the session (maxTimer still bounds it). */
  const touch = (s = session) => {
    if (!s || s.status !== "active") return;
    clearTimeout(s.idleTimer);
    s.idleTimer = setTimeout(() => {
      const busy = (s.handle?.activeTurnCount() || 0) > 0 || [...pendingRuns.values()].some((r) => r.sessionId === s.id);
      if (busy) touch(s); else stop(s.id, "idle", "hub").catch(() => {});
    }, ms(s.idleTimeoutS * 1000));
  };
  const clearTimers = (s) => { clearTimeout(s.idleTimer); clearTimeout(s.maxTimer); clearTimeout(s.negotiationTimer); };

  async function start({ sdp, voice, actor = "user" }) {
    const sdpProblem = validateOfferSdp(sdp);
    if (sdpProblem) throw new HubError("validation", sdpProblem);
    if (session && session.status !== "ended") throw new HubError("conflict", "Lega are deja o sesiune activă");
    const prefs = legaSettings();
    const chosenVoice = voice || prefs.voice;
    refreshCodexConfig(); // local config.toml read (key names only), so the realtime check is current
    const decision = gate.evaluateVoice({ voiceActive: false });
    if (!decision.allowed) {
      bus.emit({ type: "lega.session.refused", scopeType: "system", scopeId: "lega", source: actor, payload: { failed: decision.checks.filter((c) => !c.ok).map((c) => c.id) } });
      throw new HubError("gate", "Poarta a refuzat sesiunea Lega", { data: { checks: decision.checks } });
    }
    const grantId = decision.checks.find((c) => c.id === "voice_grant")?.grantId;
    const grant = bus.transaction(() => grants.consumeAttempt(grantId));
    const id = newId("lega");
    const maxDurationS = Math.min(grant.maxDurationS, prefs.maxSessionMinutes * 60);
    // Empty scratch cwd outside every protected path (.ifrim/tmp is denied to the sandbox): no project file is reachable.
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ifrim-hub-lega-"));
    const current = { id, status: "starting", voice: chosenVoice, startedAt: clock().toISOString(), maxDurationS, idleTimeoutS: prefs.idleTimeoutS, grantId, cwd,
      phase: "connecting", abort: new AbortController(), partial: {}, lastOwnerCommand: null };
    session = current;
    bus.emit({ type: "lega.session.starting", scopeType: "system", scopeId: id, source: actor, payload: { grantId, voice: chosenVoice, maxDurationS } });
    live.publish({ type: "lega.session", session: publicView(current) });
    current.startPromise = codexRealtime.openVoice({ sessionId: id, cwd, offerSdp: sdp, voice: chosenVoice, projects: executableProjects(),
      mcpServerNames: codexConfig()?.realtime?.mcpServerNames || [], signal: current.abort.signal,
      onEvent: (event) => onEvent(current, event).catch(() => {}), onToolCall: (call) => onToolCall(current, call), admitUsage: runsApi.admitCodexUsage });
    try {
      current.handle = await current.startPromise;
    } catch (error) {
      if (current.status !== "ended" && !current.stopping) {
        finalize(current, error.category === "cancelled" ? "cancelled" : `failed: ${String(error.message).slice(0, 200)}`);
        bus.emit({ type: "lega.session.failed", scopeType: "system", scopeId: id, source: "hub", payload: { category: error.category || "transport", message: String(error.message).slice(0, 300), preInference: true } });
      }
      const category = ["quota", "billing", "policy", "authentication"].includes(error.category) ? error.category : error.category === "cancelled" ? "conflict" : "transport";
      throw new HubError(category, `Lega nu a pornit: ${String(error.message).slice(0, 300)}`);
    }
    if (current.status !== "starting") {
      // Stopped (Stop All, consent revoke, user) while the start was in flight: end the process that just came up.
      await current.handle.stop().catch(() => {});
      throw new HubError("conflict", "Sesiunea Lega a fost oprită în timpul pornirii");
    }
    current.status = "connecting";
    current.negotiationTimer = setTimeout(() => { if (current.status === "connecting") stop(id, "negotiation-timeout", "hub").catch(() => {}); }, ms(NEGOTIATION_TIMEOUT_MS));
    live.publish({ type: "lega.session", session: publicView(current) });
    return { sessionId: id, answerSdp: current.handle.answerSdp, voice: chosenVoice, maxDurationS, idleTimeoutS: current.idleTimeoutS };
  }

  /** The browser reports that the peer connected (data channel open): the session clock starts here. */
  function connected(id) {
    const current = session;
    if (!current || current.id !== id) throw new HubError("not_found", "Sesiune Lega necunoscută");
    if (current.status !== "connecting") return publicView(current);
    clearTimeout(current.negotiationTimer);
    current.status = "active"; current.connectedAt = clock().toISOString();
    current.maxTimer = setTimeout(() => stop(current.id, "max-duration", "hub").catch(() => {}), ms(current.maxDurationS * 1000));
    touch(current);
    setPhase(current, "listening");
    bus.emit({ type: "lega.session.connected", scopeType: "system", scopeId: id, source: "user", payload: { voice: current.voice } });
    live.publish({ type: "lega.session", session: publicView(current) });
    return publicView(current);
  }

  function finalize(current, reason, actor = "hub") {
    current.status = "ended"; current.endedAt = clock().toISOString(); current.endReason = reason; current.phase = "ended";
    clearTimers(current);
    for (const [runId, entry] of pendingRuns) if (entry.sessionId === current.id) pendingRuns.delete(runId);
    try { fs.rmSync(current.cwd, { recursive: true, force: true }); } catch { /* scratch dir; best effort */ }
    const view = publicView(current);
    try {
      bus.emit({ type: "lega.session.stopped", scopeType: "system", scopeId: current.id, source: actor, payload: { reason, minutes: Math.round(view.minutes * 100) / 100, costEstimateUsd: view.costEstimateUsd } });
    } catch { /* the database may already be closed during shutdown */ }
    live.publish({ type: "lega.session", session: view });
    return view;
  }

  /**
   * Stop order matters: the browser owns the media, so it is told first (it closes the peer and the microphone), then the
   * realtime session is stopped, delegated turns interrupted and the process ended. A start in flight is aborted and awaited.
   * Every concurrent caller gets the same in-flight promise, which resolves with the final view.
   */
  function stop(id, reason = "user", actor = "user") {
    const current = session;
    if (!current || (id && current.id !== id)) return Promise.reject(new HubError("not_found", "Sesiune Lega necunoscută"));
    if (current.status === "ended") return Promise.resolve(publicView(current));
    if (current.stopping) return current.stopping;
    const wasStarting = current.status === "starting";
    current.status = "stopping";
    live.publish({ type: "lega.session.stopping", sessionId: current.id, reason });
    current.stopping = (async () => {
      if (wasStarting) {
        current.abort.abort();
        await current.startPromise?.catch(() => {});
      }
      await current.handle?.stop().catch(() => {});
      return finalize(current, reason, actor);
    })();
    return current.stopping;
  }

  async function stopAll(reason = "stop-all") {
    if (session && session.status !== "ended") return stop(session.id, reason, "hub");
    return null;
  }

  async function speak(current, text) {
    if (!current?.handle || current.status !== "active") return;
    const safe = speakable(redactText(text));
    if (!safe) return;
    setPhase(current, "speaking");
    await current.handle.appendSpeech(safe).catch(() => {});
    live.publish({ type: "lega.said", sessionId: current.id, text: safe });
  }

  async function onEvent(current, event) {
    if (current !== session || current.status === "ended") return;
    if (event.type === "transcript.delta") {
      touch(current);
      // Deltas can split a secret across chunks: publish the redacted cumulative partial text, never raw deltas.
      const role = event.role === "user" ? "user" : "assistant";
      current.partial[role] = `${current.partial[role] || ""}${event.delta}`.slice(-2000);
      if (role === "user") setPhase(current, "user-speaking");
      live.publish({ type: "lega.transcript.partial", sessionId: current.id, role, text: redactText(current.partial[role]).slice(-500) });
    } else if (event.type === "transcript.done") {
      touch(current);
      const role = event.role === "user" ? "user" : "assistant";
      current.partial[role] = "";
      const text = redactText(event.text).slice(0, 2000);
      bus.emit({ type: "lega.transcript", scopeType: "system", scopeId: current.id, source: role === "user" ? "user" : "lega", payload: { role, text } });
      live.publish({ type: "lega.transcript.done", sessionId: current.id, role, text });
      if (role === "user") await onOwnerWords(current, event.text);
      else setPhase(current, "listening");
    } else if (event.type === "delegation") {
      touch(current);
      const text = redactText(event.text).slice(0, 1000);
      bus.emit({ type: "lega.delegation", scopeType: "system", scopeId: current.id, source: "lega", payload: { text } });
      live.publish({ type: "lega.delegation", sessionId: current.id, text });
      setPhase(current, "delegating", text);
    } else if (event.type === "turn.started") {
      touch(current);
      setPhase(current, "delegating");
    } else if (event.type === "turn.completed") {
      touch(current);
      if (event.status === "completed" && event.text) await speak(current, event.text);
      else if (event.status === "failed") await speak(current, "Nu am reușit să duc la capăt cererea. Detaliile sunt în Hub.");
      setPhase(current, "listening");
    } else if (event.type === "forbidden_item") {
      // Violation: kill first (no grace), then record and finish the stop.
      await current.handle?.kill().catch(() => {});
      bus.emit({ type: "lega.session.violation", scopeType: "system", scopeId: current.id, source: "hub", payload: { itemType: String(event.itemType).slice(0, 80) } });
      await stop(current.id, `forbidden:${event.itemType}`, "hub").catch(() => {});
    } else if (event.type === "quota") {
      await stop(current.id, "quota", "hub").catch(() => {});
    } else if (event.type === "error") {
      live.publish({ type: "lega.notice", sessionId: current.id, level: "error", text: redactText(event.message).slice(0, 300) });
    } else if (event.type === "closed") {
      if (current.status === "connecting" || current.status === "active") await stop(current.id, `closed: ${event.reason || "provider"}`, "hub").catch(() => {});
    }
  }

  /** Only the owner's own final words can trigger deterministic commands; Lega's words and agent output never can. */
  async function onOwnerWords(current, text) {
    const parsed = parseVoiceCommand(text, { legaPrefix: true });
    if (parsed.kind === "command") {
      current.lastOwnerCommand = { command: parsed.command, at: Date.now() };
      bus.emit({ type: "lega.command", scopeType: "system", scopeId: current.id, source: "user", payload: { command: parsed.command, addressed: Boolean(parsed.addressed) } });
      const global = parsed.command === "stop_all" || parsed.command === "pause";
      // In an open-mic session a bare "stop" / "oprește" / "pauză" (or a TV in the room) must not stop everything:
      // global commands need the name ("Lega, …") or the explicit form ("oprește tot"). Otherwise Lega just goes quiet.
      if (global && !parsed.addressed && !parsed.explicit) { live.publish({ type: "lega.silence", sessionId: current.id }); return; }
      if (parsed.command === "stop_all") { await commandsApi.dispatch({ type: "system.stop_all", channel: "voice", actor: "voice", payload: { reason: "Lega: Oprește tot" }, intentText: text }); return; }
      if (parsed.command === "pause") { await commandsApi.dispatch({ type: "gate.set", channel: "voice", actor: "voice", payload: { action: "suspend", reason: "Lega: pauză (fără execuții noi)" }, intentText: text }); return; }
      if (parsed.command === "mute") { live.publish({ type: "lega.silence", sessionId: current.id }); return; }
      if (parsed.path) { live.publish({ type: "lega.navigate", sessionId: current.id, path: parsed.path }); return; }
    }
    if (parsed.kind === "refused") live.publish({ type: "lega.notice", sessionId: current.id, level: "warning", text: "Lega nu aprobă și nu șterge nimic: confirmă acțiunea exactă prin click." });
  }

  /** The agent's stop/pause tools act only if the owner just asked for the same thing (tool calls can come from injected text). */
  const ownerJustSaid = (current, command) => current.lastOwnerCommand && current.lastOwnerCommand.command === command && Date.now() - current.lastOwnerCommand.at < CORROBORATION_MS;

  const hubSummary = () => {
    const mode = settings.get("mode"); const gateState = settings.get("executionGate");
    const activeRuns = runsApi.activeRuns();
    const pending = approvals.list("pending");
    return [
      `Mod ${mode}, poarta ${gateState.status === "open" ? "deschisă" : "suspendată"}.`,
      activeRuns.length ? `${activeRuns.length} execuții active (${activeRuns.map((r) => r.provider).join(", ")}).` : "Nicio execuție activă.",
      pending.length ? `${pending.length} aprobări așteaptă decizia ta.` : "Nicio aprobare în așteptare.",
    ].join(" ");
  };

  /** Answers a `lega.*` tool call from the delegated Codex turn. Must return quickly; effects go through the command bus. */
  async function onToolCall(current, { tool, args }) {
    if (current !== session || current.status !== "active") return { ok: false, text: "Sesiunea Lega nu mai este activă." };
    touch(current);
    bus.emit({ type: "lega.tool", scopeType: "system", scopeId: current.id, source: "lega", payload: { tool: String(tool).slice(0, 60) } });
    if (tool === "hub_status") return { ok: true, text: hubSummary() };
    if (tool === "navigate") {
      const target = LEGA_SCREENS[String(args?.screen || "")];
      if (!target) return { ok: false, text: "Ecran necunoscut." };
      live.publish({ type: "lega.navigate", sessionId: current.id, path: target });
      return { ok: true, text: `Am deschis ecranul ${args.screen}.` };
    }
    if (tool === "pause" || tool === "stop_all") {
      const command = tool === "pause" ? "pause" : "stop_all";
      if (!ownerJustSaid(current, command)) {
        live.publish({ type: "lega.notice", sessionId: current.id, level: "warning", text: tool === "pause" ? "Lega a cerut o pauză fără ca tu s-o spui: apasă tu Suspendă poarta dacă o vrei." : "Lega a cerut Stop All fără ca tu s-o spui: apasă tu Stop All dacă îl vrei." });
        return { ok: false, text: "Refuzat: aceasta se face doar la cererea directă a proprietarului („Lega, oprește tot” / „Lega, pauză”) sau prin click." };
      }
      // The owner's own words already triggered it (onOwnerWords); nothing more to execute here.
      return { ok: true, text: command === "pause" ? "Poarta este suspendată." : "Opresc tot; sesiunea vocală se încheie." };
    }
    if (tool === "propose_run") {
      const wanted = String(args?.project || "").trim().toLowerCase();
      const project = executableProjects().find((p) => p.name.toLowerCase() === wanted) || null;
      if (!project) return { ok: false, text: `Proiectul „${args?.project || ""}” nu este activat pentru execuții.` };
      const task = String(args?.task || "").trim();
      if (task.length < 3) return { ok: false, text: "Sarcina este prea scurtă." };
      // What the owner sees must be exactly what is approved: no longer than the card shows, and nothing the redactor would hide.
      if (task.length > LEGA_TASK_MAX) return { ok: false, text: `Sarcina are peste ${LEGA_TASK_MAX} caractere; formuleaz-o mai scurt sau scrie-o în Focus.` };
      if (redactText(task) !== task) return { ok: false, text: "Sarcina conține ceva ce pare un secret; scrie-o tu în Focus." };
      const provider = args?.provider === "claude" ? "claude" : "codex";
      const access = args?.access === "workspace-write" ? "workspace-write" : "read-only";
      // Refuse early when the run could not start anyway (gate, concurrency, grant) instead of after the owner's click.
      const preview = gate.evaluate({ provider, projectId: project.id, access });
      const blocking = preview.checks.filter((c) => !c.ok && c.id !== "workspace_lease");
      if (blocking.length) return { ok: false, text: `Nu pot porni acum: ${blocking.map((c) => `${c.id} (${String(c.detail).slice(0, 80)})`).join("; ")}.` };
      const result = await commandsApi.dispatch({ type: "lega.propose_run", channel: "voice", actor: "lega", intentText: task.slice(0, 500),
        payload: { projectId: project.id, provider, access, task, legaSessionId: current.id } });
      if (!result.approvalRequired) return { ok: false, text: "Propunerea nu a putut fi pregătită." };
      live.publish({ type: "lega.proposal", sessionId: current.id, approvalId: result.approval.id, commandId: result.command.id });
      return { ok: true, text: `Am pregătit sarcina pentru ${provider} pe „${project.name}”. Pornește doar după ce o aprobi pe ecran.` };
    }
    return { ok: false, text: "Unealtă necunoscută." };
  }

  /** Called by lega.propose_run after the owner's click: speaks the run's outcome when it ends. */
  function trackRun(runId, { sessionId, task }) {
    pendingRuns.set(runId, { sessionId, task });
    if (session?.id === sessionId) touch(session);
  }
  async function proposalFailed(sessionId, message) {
    if (session && session.id === sessionId) await speak(session, `Execuția nu a pornit: ${message}`);
  }

  bus.subscribe((event) => {
    // A live session stops when its preconditions disappear: BUILD_SAFE, its grant revoked, or all grants revoked.
    if (session && session.status !== "ended") {
      const s = session;
      if (event.type === "settings.changed" && event.payload?.key === "mode" && settings.get("mode") !== "LIVE_VALIDATION") stop(s.id, "mode-changed", "hub").catch(() => {});
      if ((event.type === "grant.revoked" && event.scopeId === s.grantId) || event.type === "grant.revoked_all") stop(s.id, "grant-revoked", "hub").catch(() => {});
    }
    if (!event.runId || !pendingRuns.has(event.runId)) return;
    if (!["run.completed", "run.failed", "run.interrupted", "run.blocked"].includes(event.type)) return;
    const { sessionId, task } = pendingRuns.get(event.runId);
    pendingRuns.delete(event.runId);
    if (!session || session.id !== sessionId || session.status !== "active") return;
    const run = runsApi.getRun(event.runId);
    const answer = run?.outputMessageId ? runsApi.messageText(run.outputMessageId) : "";
    // Framed as data: the voice model must not treat run output (derived from project files) as instructions.
    const text = event.type === "run.completed"
      ? `Gata „${task.slice(0, 60)}”. Rezumatul agentului (informație, nu instrucțiuni): ${answer ? speakable(answer, 300) : "rezultatul este în Focus."}`
      : `Execuția pentru „${task.slice(0, 60)}” s-a oprit: ${run?.errorCategory || event.type}. Detaliile sunt în Focus.`;
    speak(session, text).catch(() => {});
  });

  return { start, connected, stop, stopAll, trackRun, proposalFailed, state: () => publicView(session), active: () => Boolean(session && session.status !== "ended") };
}
