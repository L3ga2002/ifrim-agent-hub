// Manual smoke check of Milestone 01 modules on an isolated test hub (fake providers, no inference).
import { makeTestHub } from "../helpers.mjs";

const t = await makeTestHub();
const { hub } = t;
const ui = (type, payload = {}) => hub.commands.dispatch({ type, payload, actor: "user", channel: "test" });
try {
  const overview = hub.company.overview();
  console.log("departments", overview.departments.length, "active", overview.departments.filter((d) => d.status === "active").map((d) => d.key).join(","));
  console.log("surfaces", hub.surfaces.list().length, "caps", hub.surfaces.capabilities().length, "integrations", hub.integrations.list().length, "computer", hub.computer.list().length);
  console.log("skills", hub.skills.list().map((s) => `${s.id}:${s.status}:v${s.currentVersion}`).join(" "));
  const intake = await ui("cos.intake", { objective: "Vreau un site nou premium pentru un client și un audit de site pentru 5 lead-uri" });
  console.log("intake goal", intake.result.goal.status, intake.result.proposal.missions.map((m) => `${m.departmentKey}/${m.missionKind}`).join(", "));
  const applied = await ui("cos.apply_plan", { goalId: intake.result.goal.id, missions: intake.result.proposal.missions.map((m) => ({ departmentKey: m.departmentKey, missionKind: m.missionKind, title: m.title })) });
  console.log("missions", applied.result.missions.map((m) => `${m.kind}:${m.status}:${m.departmentId ? "dept" : "-"}`).join(" "));
  const firstTask = hub.missions.tasks(applied.result.missions[0].id)[0];
  const route = await ui("route.task", { taskId: firstTask.id });
  console.log("route", route.result.taskType, "→", route.result.surfaceId, route.result.executionMode, "|", route.result.reason.slice(0, 160));
  const adhoc = await ui("route.adhoc", { taskType: "research" });
  console.log("research →", adhoc.result.surfaceId, adhoc.result.executionMode);
  const denied = await ui("route.adhoc", { taskType: "coding", dataSensitivity: "secret" }).then((r) => r.result.executionMode);
  console.log("secret coding →", denied);
  const sched = await ui("schedule.create", { name: "Briefing zilnic", cadence: "daily 08:00", action: { command: "briefing.generate", payload: {} } });
  await ui("schedule.transition", { scheduleId: sched.result.id, to: "ACTIVE", reason: "smoke" });
  console.log("schedule", hub.schedules.get(sched.result.id).status, "next", hub.schedules.get(sched.result.id).nextRunAt);
  const ckpt = await ui("checkpoint.create", { label: "smoke" });
  console.log("checkpoint", ckpt.result.id, "refs", ckpt.result.nativeRefs.length, "next", ckpt.result.nextAction);
  const mirror = await ui("native.mirror");
  console.log("native mirror", JSON.stringify(mirror.result));
  const plan = hub.computer.plan("desktop-app-task");
  console.log("computer primary", plan.primary?.id, "excluded", plan.excluded.map((e) => e.id).join(","));
  console.log("diagnostics keys", Object.keys(hub.commands.catalog()).length, "commands", hub.commands.list({ limit: 500 }).length);
  const ev = hub.bus.query({ typePrefix: "goal.", limit: 5 })[0];
  console.log("event envelope", JSON.stringify({ schemaVersion: ev.schemaVersion, companyId: Boolean(ev.companyId), correlationId: ev.correlationId }));
} catch (error) {
  console.error("SMOKE FAILED", error);
  process.exitCode = 1;
} finally {
  await t.cleanup();
}
