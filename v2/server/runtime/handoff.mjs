import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { hashCanonical } from "../core/canonical.mjs";
import { json, parse } from "../storage/db.mjs";
import { gitState, gitDiff } from "../tools/git.mjs";
import { redactDeep } from "../security/redact.mjs";
import { isSecretLikeName } from "../security/paths.mjs";
import { assertTransition } from "./lifecycles.mjs";
import { workspaceResource, SURFACE_BY_PROVIDER } from "./runs.mjs";

export const HANDOFF_SCHEMA_VERSION = 1;
export const HANDOFF_STEPS = Object.freeze(["frozen", "safe_point", "reconciled", "checkpointed", "packaged", "writer_transferred", "ready", "acknowledged", "continued"]);

/**
 * Verifiable Codex ↔ Claude handoff (9 steps). Steps 1–6 run locally; step 7 (starting the target)
 * goes through the normal execution gate; step 8 checks the target's acknowledgement line.
 */
export function createHandoffs({ db, bus, clock, conversations, missions, projects, leases, approvals, supervisor, runs, checkpoints = null }) {
  const rowTo = (row) => row && ({ id: row.id, conversationId: row.conversation_id, taskId: row.task_id, fromProvider: row.from_provider, toProvider: row.to_provider,
    status: row.status, step: row.step, package: parse(row.package_json, {}), packageSha256: row.package_sha256, checkpointId: row.checkpoint_id,
    fromSurface: row.from_surface || null, toSurface: row.to_surface || null,
    error: row.error, createdAt: row.created_at, updatedAt: row.updated_at });
  const get = (id) => rowTo(db.prepare("SELECT * FROM handoffs WHERE id = ?").get(id));
  const list = (conversationId) => db.prepare("SELECT * FROM handoffs WHERE conversation_id = ? ORDER BY created_at DESC").all(conversationId).map(rowTo);

  function setStep(id, step, status = "in_progress", error = null) {
    const current = db.prepare("SELECT status FROM handoffs WHERE id = ?").get(id);
    if (current) assertTransition("handoff", current.status, status, `step ${step}`);
    db.prepare("UPDATE handoffs SET step = ?, status = ?, error = ?, updated_at = ? WHERE id = ?").run(step, status, error, clock().toISOString(), id);
    const h = get(id);
    bus.append({ type: `handoff.${step}`, scopeType: "conversation", scopeId: h.conversationId, source: "hub", payload: { handoffId: id, status, error } });
  }

  /** Step 1: stop scheduling new actions for the conversation. */
  function begin({ conversationId, toProvider, taskId = null, actor = "user" }) {
    const conversation = conversations.get(conversationId);
    if (!conversation) throw new HubError("not_found", "Conversation not found");
    if (!["codex", "claude"].includes(toProvider)) throw new HubError("validation", "Target must be codex or claude");
    const open = db.prepare("SELECT id FROM handoffs WHERE conversation_id = ? AND status IN ('in_progress','waiting','ready')").get(conversationId);
    if (open) throw new HubError("conflict", "A handoff is already open for this conversation", { data: { handoffId: open.id } });
    const fromProvider = conversation.writerProvider || db.prepare("SELECT provider FROM agent_runs WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1").get(conversationId)?.provider || "none";
    if (fromProvider === toProvider) throw new HubError("validation", `${toProvider} already holds this conversation`);
    const id = newId("hof");
    const now = clock().toISOString();
    return bus.transaction(() => {
      db.prepare("INSERT INTO handoffs (id, conversation_id, task_id, from_provider, to_provider, status, step, created_at, updated_at, from_surface, to_surface) VALUES (?, ?, ?, ?, ?, 'in_progress', 'frozen', ?, ?, ?, ?)")
        .run(id, conversationId, taskId || conversation.activeTaskId, fromProvider, toProvider, now, now, SURFACE_BY_PROVIDER[fromProvider] || null, SURFACE_BY_PROVIDER[toProvider] || null);
      conversations.update(conversationId, { status: "handoff" }, actor);
      bus.append({ type: "handoff.frozen", scopeType: "conversation", scopeId: conversationId, source: actor, payload: { handoffId: id, fromProvider, toProvider } });
      return get(id);
    });
  }

  /** Steps 2–6. Stops with status `waiting` at the first step that cannot proceed safely. */
  async function advance(id) {
    const handoff = get(id);
    if (!handoff) throw new HubError("not_found", "Handoff not found");
    if (!["in_progress", "waiting"].includes(handoff.status)) return handoff;
    const conversation = conversations.get(handoff.conversationId);
    const project = projects.get(conversation.projectId);

    // Step 2: safe point — no active run on this conversation.
    const activeRun = runs.activeRuns().find((r) => r.conversationId === conversation.id);
    if (activeRun) {
      bus.transaction(() => setStep(id, "safe_point", "waiting", `Run ${activeRun.runId} is still active; wait for it or interrupt it`));
      return get(id);
    }
    bus.transaction(() => setStep(id, "safe_point"));

    // Step 3: reconcile processes and uncertain effects.
    const lease = leases.current(workspaceResource(project.path));
    const unknownEffects = db.prepare("SELECT id, tool FROM tool_calls WHERE status = 'unknown' AND run_id IN (SELECT id FROM agent_runs WHERE conversation_id = ?)").all(conversation.id);
    if (lease?.status === "retained" || unknownEffects.length) {
      bus.transaction(() => setStep(id, "reconciled", "waiting", lease?.status === "retained" ? `Workspace lease ${lease.id} is retained (state unknown); reconcile it first` : `${unknownEffects.length} tool effect(s) with unknown outcome`));
      return get(id);
    }
    bus.transaction(() => setStep(id, "reconciled"));

    // Step 4: checkpoint of real file/test state.
    const git = await gitState(project.path);
    const diff = await gitDiff(project.path, { maxChars: 60000 });
    const untracked = manifestUntracked(project.path, git.untracked);
    let checkpointId;
    let nativeCheckpointRefs = [];
    if (checkpoints) {
      // Cross-provider Hub checkpoint: hub state + references to native checkpoints/sessions.
      const ckpt = await checkpoints.create({ scopeType: "conversation", scopeId: conversation.id, kind: "handoff", label: `handoff ${id}` }, "hub");
      checkpointId = ckpt.id;
      nativeCheckpointRefs = ckpt.nativeRefs;
    } else {
      checkpointId = newId("ckpt");
      bus.transaction(() => db.prepare("INSERT INTO checkpoints (id, scope_type, scope_id, kind, git_head, git_branch, dirty_json, manifest_json, created_at) VALUES (?, 'conversation', ?, 'handoff', ?, ?, ?, ?, ?)")
        .run(checkpointId, conversation.id, git.head, git.branch, json(git.dirty), json({ untracked }), clock().toISOString()));
    }
    bus.transaction(() => {
      db.prepare("UPDATE handoffs SET checkpoint_id = ? WHERE id = ?").run(checkpointId, id);
      setStep(id, "checkpointed");
    });

    // Step 5: package.
    const pkg = buildPackage({ handoff: get(id), conversation, project, git, diff, untracked, checkpointId, nativeCheckpointRefs });
    const sha = hashCanonical(pkg);
    bus.transaction(() => {
      db.prepare("UPDATE handoffs SET package_json = ?, package_sha256 = ? WHERE id = ?").run(json(pkg), sha, id);
      setStep(id, "packaged");
    });

    // Step 6: transfer write exclusivity. The workspace lease is free at this point (step 3), so the
    // exclusive writer becomes the target provider in the conversation record.
    bus.transaction(() => {
      conversations.update(conversation.id, { writerProvider: handoff.toProvider }, "hub");
      setStep(id, "writer_transferred");
      setStep(id, "ready", "ready");
    });
    return get(id);
  }

  function buildPackage({ handoff, conversation, project, git, diff, untracked, checkpointId, nativeCheckpointRefs = [] }) {
    const task = handoff.taskId ? missions.task(handoff.taskId) : null;
    const mission = task?.missionId ? missions.get(task.missionId) : (conversation.activeMissionId ? missions.get(conversation.activeMissionId) : null);
    const missionTasks = mission ? missions.tasks(mission.id) : [];
    const lastRun = db.prepare("SELECT * FROM agent_runs WHERE conversation_id = ? AND provider = ? ORDER BY created_at DESC LIMIT 1").get(conversation.id, handoff.fromProvider);
    const messageRange = db.prepare("SELECT MIN(position) AS first, MAX(position) AS last, COUNT(*) AS count FROM messages WHERE conversation_id = ?").get(conversation.id);
    const tests = db.prepare("SELECT tool, status, result_json, finished_at FROM tool_calls WHERE tool LIKE 'process.test%' ORDER BY started_at DESC LIMIT 10").all()
      .map((t) => ({ tool: t.tool, status: t.status, finishedAt: t.finished_at, summary: parse(t.result_json, {}).summary || null }));
    const latestUser = db.prepare("SELECT content FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY position DESC LIMIT 1").get(conversation.id);
    const pkg = {
      schema_version: HANDOFF_SCHEMA_VERSION,
      conversation_id: conversation.id,
      task_id: handoff.taskId || null,
      objective: mission?.objective || task?.title || latestUser?.content?.slice(0, 2000) || "",
      acceptance_criteria: task?.acceptance?.length ? task.acceptance : mission?.acceptance || [],
      user_constraints: [...(mission?.constraints || []), "No commit/push/deploy/external send without an approval bound to the exact action", "No paid API, credits or fallback routes", "Stay inside the project workspace"],
      decisions_with_sources: db.prepare("SELECT title, decision, source_ref, created_at FROM decisions WHERE (conversation_id = ? OR project_id = ?) AND status = 'active' ORDER BY created_at DESC LIMIT 30").all(conversation.id, project.id),
      completed_work: missionTasks.filter((t) => t.status === "COMPLETED").map((t) => t.title),
      remaining_work: missionTasks.filter((t) => !["COMPLETED", "CANCELLED"].includes(t.status)).map((t) => `${t.title} [${t.status}]`),
      blockers: missionTasks.filter((t) => ["BLOCKED", "FAILED", "WAITING_PROVIDER"].includes(t.status)).map((t) => `${t.title}: ${t.statusReason}`),
      next_safe_action: missionTasks.find((t) => ["QUEUED", "DRAFT", "BLOCKED", "VERIFYING"].includes(t.status))?.title || "Inspect the repository state and continue the latest request",
      repo: project.repo || "", worktree: project.path, branch: git.branch, commit: git.head,
      dirty_diff: diff.diff, dirty_diff_truncated: diff.truncated,
      untracked_manifest: untracked,
      test_results: tests,
      running_processes: supervisor.list(),
      unresolved_side_effects: [],
      pending_approvals: approvals.list("pending").map((a) => ({ id: a.id, actionKind: a.actionKind, target: a.target, expiresAt: a.expiresAt })),
      artifacts: db.prepare("SELECT kind, path, sha256 FROM artifacts WHERE project_id = ? ORDER BY created_at DESC LIMIT 20").all(project.id),
      source_session: { provider: handoff.fromProvider, surface: handoff.fromSurface || SURFACE_BY_PROVIDER[handoff.fromProvider] || null,
        native_session_id: lastRun?.native_thread_id || lastRun?.provider_session_id || null, last_run_id: lastRun?.id || null },
      target_provider: handoff.toProvider,
      target_surface: handoff.toSurface || SURFACE_BY_PROVIDER[handoff.toProvider] || null,
      native_checkpoint_refs: nativeCheckpointRefs,
      context_references: { conversation_id: conversation.id, message_range: messageRange, checkpoint_id: checkpointId,
        summaries: db.prepare("SELECT id FROM summaries WHERE conversation_id = ?").all(conversation.id).map((s) => s.id),
        note: "Original messages stay in the Hub; the target reads this package, not the source model's hidden state." },
      created_at: clock().toISOString(),
    };
    return redactDeep(pkg);
  }

  /** Step 8: the target's first run must echo `HANDOFF_ACK <id> <sha12>`; mismatch leaves the handoff unacknowledged. */
  function checkAcknowledgement(runId) {
    const run = runs.getRun(runId);
    if (!run?.evidence?.promptPackage?.handoffId) return null;
    const handoff = get(run.evidence.promptPackage.handoffId);
    if (!handoff || handoff.status !== "ready") return handoff;
    const message = run.outputMessageId ? db.prepare("SELECT content FROM messages WHERE id = ?").get(run.outputMessageId)?.content || "" : "";
    const expected = `HANDOFF_ACK ${handoff.id} ${handoff.packageSha256.slice(0, 12)}`;
    const ok = run.status === "completed" && message.trimStart().startsWith(expected);
    bus.transaction(() => {
      if (ok) {
        setStep(handoff.id, "acknowledged", "in_progress");
        setStep(handoff.id, "continued", "completed");
        conversations.update(handoff.conversationId, { status: "idle" }, "hub");
      } else {
        setStep(handoff.id, "acknowledged", "ready", run.status === "completed" ? "Target run did not start with the expected acknowledgement line" : `Target run ${run.status}; package remains ready`);
      }
    });
    return get(handoff.id);
  }

  function cancel(id, actor = "user") {
    const handoff = get(id);
    if (!handoff || ["completed", "cancelled"].includes(handoff.status)) return handoff;
    bus.transaction(() => {
      db.prepare("UPDATE handoffs SET status = 'cancelled', updated_at = ? WHERE id = ?").run(clock().toISOString(), id);
      conversations.update(handoff.conversationId, { status: "idle", writerProvider: handoff.fromProvider === "none" ? "" : handoff.fromProvider }, actor);
      bus.append({ type: "handoff.cancelled", scopeType: "conversation", scopeId: handoff.conversationId, source: actor, payload: { handoffId: id } });
    });
    return get(id);
  }

  return { begin, advance, checkAcknowledgement, cancel, get, list };
}

function manifestUntracked(root, files) {
  return files.slice(0, 200).map((rel) => {
    const name = path.basename(rel);
    if (isSecretLikeName(name)) return { path: rel, excluded: "secret-like name" };
    try {
      const abs = path.join(root, rel);
      const stat = fs.statSync(abs);
      if (!stat.isFile()) return { path: rel, type: "dir" };
      const hash = stat.size <= 5 * 1024 * 1024 ? crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex") : null;
      return { path: rel, size: stat.size, sha256: hash };
    } catch { return { path: rel, missing: true }; }
  });
}
