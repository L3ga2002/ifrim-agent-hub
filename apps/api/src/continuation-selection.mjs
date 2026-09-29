const terminalTaskStatuses = new Set(["done", "cancelled", "rejected"]);
const actionableTaskStatuses = new Set(["draft", "backlog", "ready", "in_progress", "review", "qa"]);

function latestTimestamp(values) {
  return values.filter(Boolean).sort().at(-1) || "";
}

function taskRunActivity(taskId, runs) {
  return runs.filter((run) => run.taskId === taskId).map((run) => run.updatedAt || run.createdAt);
}

function taskTransitionActivity(taskId, transitions) {
  return transitions.filter((transition) => transition.taskId === taskId).map((transition) => transition.createdAt);
}

function terminalTransition(taskId, transitions) {
  return transitions
    .filter((transition) => transition.taskId === taskId && transition.status === "completed" && transition.toStage === "done" && transition.verdict === "pass")
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0] || null;
}

export function deriveContinuationTaskState(task, runs = [], transitions = []) {
  const completedTransition = terminalTransition(task.id, transitions);
  const effectiveStatus = completedTransition ? "done" : task.status;
  const activityAt = latestTimestamp([task.updatedAt, task.createdAt, ...taskRunActivity(task.id, runs), ...taskTransitionActivity(task.id, transitions)]);
  const completedAt = completedTransition?.createdAt || (terminalTaskStatuses.has(task.status) ? (task.updatedAt || task.createdAt) : "");
  const hasLiveRun = runs.some((run) => run.taskId === task.id && run.status === "running");

  return {
    task: effectiveStatus === task.status ? task : { ...task, status: effectiveStatus },
    effectiveStatus,
    activityAt,
    completedAt,
    hasLiveRun,
    isCompleted: effectiveStatus === "done",
    isActionable: actionableTaskStatuses.has(effectiveStatus),
  };
}

export function selectContinuationTask({ tasks = [], runs = [], transitions = [] }) {
  const states = tasks.map((task) => deriveContinuationTaskState(task, runs, transitions));
  const latestCompleted = states
    .filter((state) => state.isCompleted)
    .sort((left, right) => String(right.completedAt).localeCompare(String(left.completedAt)))[0] || null;

  const active = states
    .filter((state) => state.isActionable)
    .filter((state) => state.hasLiveRun || !latestCompleted || String(state.activityAt).localeCompare(String(latestCompleted.completedAt)) >= 0)
    .sort((left, right) => String(right.activityAt).localeCompare(String(left.activityAt)))[0] || null;

  if (active) {
    return {
      task: active.task,
      kind: "active_task",
      label: "Task activ",
      reason: active.hasLiveRun ? "Are o executie activa inregistrata." : "Este cel mai recent task actionabil dupa ultimul workflow finalizat.",
    };
  }

  if (latestCompleted) {
    return {
      task: latestCompleted.task,
      kind: "latest_completed_task",
      label: "Ultimul task finalizat",
      reason: "Nu exista task activ; este selectat ultimul workflow finalizat din baza de date.",
    };
  }

  return {
    task: null,
    kind: "no_task",
    label: "Fara taskuri",
    reason: "Proiectul nu are taskuri actionabile sau finalizate inregistrate.",
  };
}
