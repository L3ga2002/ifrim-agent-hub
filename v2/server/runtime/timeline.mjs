/**
 * Per-run phase timeline (M03 §08). Every phase is a timestamp recorded once, when it is first observed; durations are
 * derived, never estimated. Each segment is attributed to who spends the time:
 *   human    — waiting for the owner (approval of the exact action);
 *   hub      — the Hub's own work (gate, lease, grant, backup, git state, records);
 *   provider — the provider client process (start, handshake, account, thread, MCP checks, turn admission);
 *   model_or_sandbox — after turn/start and before the first observed item: model reasoning and/or Windows sandbox set-up
 *                      (the protocol events do not separate them; first_command_started → first_command_completed isolates
 *                      the execution of one command, sandbox included);
 *   provider_turn — the rest of the turn until it finished.
 * Only phases that were observed appear; a missing phase is never filled in.
 */
export const RUN_PHASES = Object.freeze([
  ["requested", "Cererea (comanda) a fost primită"],
  ["approval_requested", "Aprobare cerută"],
  ["approval_decided", "Aprobarea ta a fost dată"],
  ["dispatch", "Hub-ul a început admiterea"],
  ["plan_resolved", "Model și efort rezolvate"],
  ["gate_checked", "Poarta de execuție verificată"],
  ["lease_acquired", "Workspace blocat pentru un singur writer"],
  ["grant_consumed", "Încercare din grant folosită"],
  ["backup_ready", "Backup verificat disponibil"],
  ["git_state", "Starea git citită"],
  ["run_recorded", "Execuția înregistrată"],
  ["process_spawned", "Procesul providerului pornit"],
  ["initialized", "Handshake terminat"],
  ["account_checked", "Contul verificat (abonament)"],
  ["rate_limits_checked", "Limitele de utilizare verificate"],
  ["thread_ready", "Thread pornit / reluat"],
  ["mcp_checked", "Servere MCP verificate (niciunul activ)"],
  ["turn_sent", "Turnul trimis modelului"],
  ["turn_acknowledged", "Turnul acceptat de provider"],
  ["first_event", "Primul eveniment al turnului"],
  ["first_command_started", "Prima comandă începută"],
  ["first_command_completed", "Prima comandă terminată"],
  ["first_file_change", "Prima modificare de fișier"],
  ["first_output", "Primul text de răspuns"],
  ["finished", "Execuția s-a terminat"],
]);
const KNOWN = new Set(RUN_PHASES.map(([id]) => id));
const LABEL = Object.fromEntries(RUN_PHASES);

const OWNER = {
  approval_requested: "hub", approval_decided: "human", dispatch: "hub", plan_resolved: "hub", gate_checked: "hub", lease_acquired: "hub", grant_consumed: "hub",
  backup_ready: "hub", git_state: "hub", run_recorded: "hub", process_spawned: "provider", initialized: "provider", account_checked: "provider",
  rate_limits_checked: "provider", thread_ready: "provider", mcp_checked: "provider", turn_sent: "hub", turn_acknowledged: "provider",
  first_event: "model_or_sandbox", first_command_started: "model_or_sandbox", first_command_completed: "command_execution", first_file_change: "provider_turn",
  first_output: "provider_turn", finished: "provider_turn",
};

/** Mutable timeline of one run: `mark(phase, at?)` keeps the first timestamp of each phase. */
export function createTimeline(clock, initial = {}) {
  const phases = {};
  for (const [phase, at] of Object.entries(initial || {})) if (KNOWN.has(phase) && at) phases[phase] = new Date(at).toISOString();
  return {
    mark(phase, at = null) {
      if (!KNOWN.has(phase) || phases[phase]) return false;
      phases[phase] = (at ? new Date(at) : clock()).toISOString();
      return true;
    },
    has: (phase) => Boolean(phases[phase]),
    toJSON: () => ({ ...phases }),
  };
}

/**
 * Ordered segments between consecutive observed phases, with milliseconds and the owner of the wait, plus totals per
 * owner. `phases` is the stored object {phase: iso}.
 */
export function summarizeTimeline(phases = {}) {
  const points = RUN_PHASES.map(([id]) => id).filter((id) => phases[id]).map((id) => ({ phase: id, at: phases[id], t: new Date(phases[id]).getTime() }))
    .sort((a, b) => a.t - b.t);
  const segments = [];
  for (let i = 1; i < points.length; i += 1) {
    const to = points[i];
    segments.push({ from: points[i - 1].phase, to: to.phase, label: LABEL[to.phase], ms: Math.max(0, to.t - points[i - 1].t), owner: OWNER[to.phase] || "hub" });
  }
  const totals = {};
  for (const s of segments) totals[s.owner] = (totals[s.owner] || 0) + s.ms;
  const span = (a, b) => (phases[a] && phases[b] ? Math.max(0, new Date(phases[b]).getTime() - new Date(phases[a]).getTime()) : null);
  return {
    phases: points.map(({ phase, at }) => ({ phase, at, label: LABEL[phase] })),
    segments,
    totals,
    keySpans: {
      hubAdmissionMs: span("dispatch", "turn_sent"),
      turnToFirstCommandMs: span("turn_sent", "first_command_started"),
      firstCommandExecutionMs: span("first_command_started", "first_command_completed"),
      turnToFirstOutputMs: span("turn_sent", "first_output"),
      humanApprovalMs: span("approval_requested", "approval_decided"),
      totalMs: points.length > 1 ? points[points.length - 1].t - points[0].t : null,
    },
  };
}
