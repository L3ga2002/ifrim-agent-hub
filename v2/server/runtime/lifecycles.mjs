import { HubError } from "../core/errors.mjs";
import { TASK_STATES, canTransition as canTaskTransition } from "./state-machine.mjs";

/**
 * State machines of every stateful entity. The task machine lives in state-machine.mjs (it predates
 * Milestone 01); the others are declared here with the same rules: explicit allowed transitions,
 * terminal states, and a reason for every change. `assertTransition` is the single enforcement point.
 */
export const LIFECYCLES = Object.freeze({
  task: {
    states: TASK_STATES,
    terminal: ["COMPLETED", "CANCELLED"],
    can: canTaskTransition,
  },
  goal: {
    states: ["DRAFT", "ACTIVE", "AT_RISK", "BLOCKED", "ACHIEVED", "ABANDONED"],
    terminal: ["ACHIEVED", "ABANDONED"],
    transitions: {
      DRAFT: ["ACTIVE", "ABANDONED"],
      ACTIVE: ["AT_RISK", "BLOCKED", "ACHIEVED", "ABANDONED"],
      AT_RISK: ["ACTIVE", "BLOCKED", "ACHIEVED", "ABANDONED"],
      BLOCKED: ["ACTIVE", "AT_RISK", "ABANDONED"],
      ACHIEVED: [], ABANDONED: [],
    },
  },
  objective: {
    states: ["OPEN", "IN_PROGRESS", "MET", "MISSED", "DROPPED"],
    terminal: ["MET", "MISSED", "DROPPED"],
    transitions: { OPEN: ["IN_PROGRESS", "MET", "DROPPED"], IN_PROGRESS: ["MET", "MISSED", "DROPPED", "OPEN"], MET: [], MISSED: [], DROPPED: [] },
  },
  mission: {
    // Mission status is derived from its tasks; the machine rejects impossible derived jumps.
    states: ["DRAFT", "ACTIVE", "ATTENTION", "COMPLETED", "FAILED", "CANCELLED"],
    terminal: ["COMPLETED", "CANCELLED"],
    transitions: {
      DRAFT: ["ACTIVE", "ATTENTION", "CANCELLED", "COMPLETED", "FAILED"],
      ACTIVE: ["ATTENTION", "COMPLETED", "FAILED", "CANCELLED", "DRAFT"],
      ATTENTION: ["ACTIVE", "COMPLETED", "FAILED", "CANCELLED"],
      FAILED: ["ACTIVE", "ATTENTION", "CANCELLED"],
      COMPLETED: [], CANCELLED: [],
    },
  },
  agentRun: {
    states: ["starting", "running", "waiting_approval", "completed", "failed", "interrupted", "blocked", "interrupted_unknown", "orphaned"],
    terminal: ["completed", "failed", "interrupted", "blocked", "interrupted_unknown", "orphaned"],
    transitions: {
      starting: ["running", "blocked", "failed", "interrupted", "interrupted_unknown", "orphaned"],
      running: ["waiting_approval", "completed", "failed", "interrupted", "blocked", "interrupted_unknown", "orphaned"],
      waiting_approval: ["running", "failed", "interrupted", "interrupted_unknown", "orphaned"],
      completed: [], failed: [], interrupted: [], blocked: [], interrupted_unknown: [], orphaned: [],
    },
  },
  providerSession: {
    states: ["active", "idle", "lost", "closed", "superseded"],
    terminal: ["closed", "superseded"],
    transitions: { active: ["idle", "lost", "closed", "superseded"], idle: ["active", "lost", "closed", "superseded"], lost: ["active", "closed"], closed: [], superseded: [] },
  },
  handoff: {
    states: ["in_progress", "waiting", "ready", "completed", "cancelled", "failed"],
    terminal: ["completed", "cancelled", "failed"],
    transitions: {
      in_progress: ["in_progress", "waiting", "ready", "completed", "cancelled", "failed"],
      waiting: ["in_progress", "waiting", "ready", "cancelled", "failed"],
      ready: ["ready", "in_progress", "completed", "cancelled"],
      completed: [], cancelled: [], failed: [],
    },
  },
  approval: {
    states: ["pending", "approved", "rejected", "expired", "invalidated", "consumed", "revoked"],
    terminal: ["rejected", "expired", "invalidated", "consumed", "revoked"],
    transitions: {
      pending: ["approved", "rejected", "expired", "invalidated"],
      approved: ["consumed", "expired", "invalidated", "revoked"],
      rejected: [], expired: [], invalidated: [], consumed: [], revoked: [],
    },
  },
  schedule: {
    states: ["DRAFT", "ACTIVE", "PAUSED", "RETIRED"],
    terminal: ["RETIRED"],
    transitions: { DRAFT: ["ACTIVE", "RETIRED"], ACTIVE: ["PAUSED", "RETIRED"], PAUSED: ["ACTIVE", "RETIRED"], RETIRED: [] },
  },
  nativeScheduleRef: {
    // A reference to a schedule that lives in Claude/OpenAI/OpenClaw. The Hub never creates it by
    // itself: PENDING_USER_SETUP → LINKED happens when you record the native id you created.
    states: ["PROPOSED", "PENDING_USER_SETUP", "LINKED", "ACTIVE", "PAUSED", "ORPHANED", "DETACHED"],
    terminal: ["DETACHED"],
    transitions: {
      PROPOSED: ["PENDING_USER_SETUP", "DETACHED"],
      PENDING_USER_SETUP: ["LINKED", "DETACHED"],
      LINKED: ["ACTIVE", "PAUSED", "ORPHANED", "DETACHED"],
      ACTIVE: ["PAUSED", "ORPHANED", "DETACHED"],
      PAUSED: ["ACTIVE", "ORPHANED", "DETACHED"],
      ORPHANED: ["LINKED", "DETACHED"],
      DETACHED: [],
    },
  },
});

export function canTransition(machine, from, to) {
  const def = LIFECYCLES[machine];
  if (!def) throw new Error(`Unknown lifecycle ${machine}`);
  if (def.can) return def.can(from, to);
  return Boolean(def.transitions[from]?.includes(to));
}

export function isTerminal(machine, state) {
  return LIFECYCLES[machine]?.terminal.includes(state) ?? false;
}

/** Throws a `task`-category error when the transition is not allowed or has no reason. */
export function assertTransition(machine, from, to, reason = "transition") {
  const def = LIFECYCLES[machine];
  if (!def) throw new Error(`Unknown lifecycle ${machine}`);
  if (!def.states.includes(to)) throw new HubError("validation", `${machine}: unknown state ${to}`);
  if (from === to && !(def.transitions?.[from] || []).includes(to)) return false;
  if (!canTransition(machine, from, to)) throw new HubError("task", `${machine}: transition ${from} -> ${to} is not allowed`);
  if (!reason || String(reason).trim().length < 3) throw new HubError("validation", `${machine}: a transition needs a reason`);
  return true;
}

/** Summary for the UI/documentation: every machine with states, terminal states and edges. */
export function describeLifecycles() {
  return Object.entries(LIFECYCLES).map(([id, def]) => ({
    id, states: def.states, terminal: def.terminal,
    transitions: def.transitions || Object.fromEntries(def.states.map((s) => [s, def.states.filter((t) => def.can(s, t))])),
  }));
}
