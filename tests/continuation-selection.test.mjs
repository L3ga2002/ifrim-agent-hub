import test from "node:test";
import assert from "node:assert/strict";
import { selectContinuationTask } from "../apps/api/src/continuation-selection.mjs";

const task = (id, status, updatedAt) => ({ id, status, updatedAt, createdAt: updatedAt });
const transition = (taskId, createdAt) => ({ taskId, status: "completed", fromStage: "qa", toStage: "done", verdict: "pass", createdAt });

test("selecteaza taskul activ real", () => {
  const result = selectContinuationTask({
    tasks: [task("DONE-1", "done", "2026-07-14T10:00:00.000Z"), task("ACTIVE-1", "ready", "2026-07-15T10:00:00.000Z")],
  });
  assert.equal(result.kind, "active_task");
  assert.equal(result.task.id, "ACTIVE-1");
});

test("fara task activ selecteaza ultimul task finalizat", () => {
  const result = selectContinuationTask({
    tasks: [task("DONE-OLD", "done", "2026-07-13T10:00:00.000Z"), task("DONE-NEW", "done", "2026-07-14T10:00:00.000Z")],
  });
  assert.equal(result.kind, "latest_completed_task");
  assert.equal(result.task.id, "DONE-NEW");
});

test("ignora taskurile vechi blocate sau incomplete cand un workflow mai nou este finalizat", () => {
  const result = selectContinuationTask({
    tasks: [
      task("BLOCKED-OLD", "blocked", "2026-07-11T10:00:00.000Z"),
      task("HUB-014-SMOKE", "in_progress", "2026-07-12T10:00:00.000Z"),
      task("FLOW-NEW", "in_progress", "2026-07-14T09:00:00.000Z"),
    ],
    transitions: [transition("FLOW-NEW", "2026-07-14T10:00:00.000Z")],
  });
  assert.equal(result.kind, "latest_completed_task");
  assert.equal(result.task.id, "FLOW-NEW");
  assert.equal(result.task.status, "done");
});

test("proiectul fara taskuri propune definirea urmatorului task", () => {
  const result = selectContinuationTask({ tasks: [] });
  assert.equal(result.kind, "no_task");
  assert.equal(result.task, null);
});
