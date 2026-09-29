import { randomUUID } from "node:crypto";

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}-${randomUUID()}`;
const json = (value) => JSON.stringify(value ?? {});
const parse = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };

export function createConversationStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hub_conversations (
      id TEXT PRIMARY KEY, project_slug TEXT NOT NULL, title TEXT NOT NULL,
      active_task_id TEXT NOT NULL DEFAULT '', preferred_provider TEXT NOT NULL DEFAULT 'auto',
      current_provider TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
      workspace TEXT NOT NULL, branch TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hub_messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, task_id TEXT NOT NULL DEFAULT '',
      run_id TEXT NOT NULL DEFAULT '', role TEXT NOT NULL, content TEXT NOT NULL,
      attachments_json TEXT NOT NULL DEFAULT '[]', provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '', provider_session_id TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES hub_conversations(id)
    );
    CREATE TABLE IF NOT EXISTS hub_decisions (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, task_id TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL, source_message_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES hub_conversations(id)
    );
    CREATE TABLE IF NOT EXISTS hub_task_state (
      conversation_id TEXT PRIMARY KEY, task_id TEXT NOT NULL DEFAULT '',
      objective TEXT NOT NULL DEFAULT '', requirements_json TEXT NOT NULL DEFAULT '[]',
      acceptance_json TEXT NOT NULL DEFAULT '[]', plan_json TEXT NOT NULL DEFAULT '[]',
      completed_json TEXT NOT NULL DEFAULT '[]', remaining_json TEXT NOT NULL DEFAULT '[]',
      blockers_json TEXT NOT NULL DEFAULT '[]', relevant_files_json TEXT NOT NULL DEFAULT '[]',
      tests_json TEXT NOT NULL DEFAULT '[]', summary TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES hub_conversations(id)
    );
    CREATE TABLE IF NOT EXISTS hub_provider_sessions (
      conversation_id TEXT NOT NULL, provider TEXT NOT NULL, native_session_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ready', updated_at TEXT NOT NULL,
      PRIMARY KEY(conversation_id, provider),
      FOREIGN KEY(conversation_id) REFERENCES hub_conversations(id)
    );
    CREATE TABLE IF NOT EXISTS hub_provider_runs (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, task_id TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', reasoning TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'developer', native_session_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL, error_category TEXT NOT NULL DEFAULT '', retry_count INTEGER NOT NULL DEFAULT 0,
      handoff_count INTEGER NOT NULL DEFAULT 0, parent_run_id TEXT NOT NULL DEFAULT '',
      handoff_from_run_id TEXT NOT NULL DEFAULT '', usage_json TEXT NOT NULL DEFAULT '{"status":"unknown"}',
      commands_json TEXT NOT NULL DEFAULT '[]', tests_json TEXT NOT NULL DEFAULT '[]',
      files_json TEXT NOT NULL DEFAULT '[]', metadata_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL, finished_at TEXT NOT NULL DEFAULT '',
      FOREIGN KEY(conversation_id) REFERENCES hub_conversations(id)
    );
    CREATE TABLE IF NOT EXISTS hub_leases (
      resource TEXT NOT NULL, workspace TEXT NOT NULL, conversation_id TEXT NOT NULL,
      run_id TEXT NOT NULL, provider TEXT NOT NULL, acquired_at TEXT NOT NULL,
      PRIMARY KEY(resource, workspace)
    );
    CREATE TABLE IF NOT EXISTS hub_checkpoints (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, run_id TEXT NOT NULL,
      envelope_json TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES hub_conversations(id)
    );
    CREATE INDEX IF NOT EXISTS idx_hub_conversations_project ON hub_conversations(project_slug, updated_at);
    CREATE INDEX IF NOT EXISTS idx_hub_messages_conversation ON hub_messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_hub_runs_conversation ON hub_provider_runs(conversation_id, started_at);
  `);

  const conversation = (row) => row && ({ id: row.id, projectSlug: row.project_slug, title: row.title,
    activeTaskId: row.active_task_id, preferredProvider: row.preferred_provider, currentProvider: row.current_provider,
    status: row.status, workspace: row.workspace, branch: row.branch, createdAt: row.created_at, updatedAt: row.updated_at });
  const message = (row) => ({ id: row.id, conversationId: row.conversation_id, taskId: row.task_id,
    runId: row.run_id, role: row.role, content: row.content, attachments: parse(row.attachments_json, []),
    provider: row.provider, model: row.model, providerSessionId: row.provider_session_id,
    metadata: parse(row.metadata_json, {}), timestamp: row.created_at });
  const taskState = (row) => row && ({ taskId: row.task_id, objective: row.objective,
    requirements: parse(row.requirements_json, []), acceptanceCriteria: parse(row.acceptance_json, []),
    currentPlan: parse(row.plan_json, []), completedSteps: parse(row.completed_json, []),
    remainingSteps: parse(row.remaining_json, []), blockers: parse(row.blockers_json, []),
    relevantFiles: parse(row.relevant_files_json, []), tests: parse(row.tests_json, []),
    summary: row.summary, updatedAt: row.updated_at });
  const run = (row) => row && ({ id: row.id, conversationId: row.conversation_id, taskId: row.task_id,
    provider: row.provider, model: row.model, reasoningLevel: row.reasoning, role: row.role,
    providerSessionId: row.native_session_id, status: row.status, errorCategory: row.error_category,
    retryCount: row.retry_count, handoffCount: row.handoff_count, parentRunId: row.parent_run_id,
    handoffFromRunId: row.handoff_from_run_id, usage: parse(row.usage_json, { status: "unknown" }),
    commandsExecuted: parse(row.commands_json, []), testsExecuted: parse(row.tests_json, []),
    filesChanged: parse(row.files_json, []), metadata: parse(row.metadata_json, {}),
    startedAt: row.started_at, finishedAt: row.finished_at });

  function getConversation(conversationId) {
    return conversation(db.prepare("SELECT * FROM hub_conversations WHERE id = ?").get(conversationId));
  }
  function listConversations(projectSlug) {
    return db.prepare("SELECT * FROM hub_conversations WHERE project_slug = ? ORDER BY updated_at DESC").all(projectSlug).map(conversation);
  }
  function createConversation({ projectSlug, title, workspace, branch = "", taskId = "", preferredProvider = "auto", objective = "" }) {
    const conversationId = id("conversation");
    const timestamp = now();
    db.prepare(`INSERT INTO hub_conversations (id,project_slug,title,active_task_id,preferred_provider,workspace,branch,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(conversationId, projectSlug, title, taskId, preferredProvider, workspace, branch, timestamp, timestamp);
    db.prepare("INSERT INTO hub_task_state (conversation_id,task_id,objective,updated_at) VALUES (?,?,?,?)")
      .run(conversationId, taskId, objective, timestamp);
    return getConversation(conversationId);
  }
  function updateConversation(conversationId, patch) {
    const current = getConversation(conversationId);
    if (!current) return null;
    const next = { ...current, ...patch };
    db.prepare(`UPDATE hub_conversations SET title=?,active_task_id=?,preferred_provider=?,current_provider=?,status=?,workspace=?,branch=?,updated_at=? WHERE id=?`)
      .run(next.title, next.activeTaskId, next.preferredProvider, next.currentProvider, next.status, next.workspace, next.branch, now(), conversationId);
    return getConversation(conversationId);
  }
  function listMessages(conversationId, limit = 500, offset = 0) {
    return db.prepare("SELECT * FROM hub_messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?")
      .all(conversationId, Math.max(1, Math.min(limit, 20000)), Math.max(0, offset)).reverse().map(message);
  }
  function countMessages(conversationId) {
    return db.prepare("SELECT COUNT(*) AS count FROM hub_messages WHERE conversation_id=?").get(conversationId).count;
  }
  function addMessage({ conversationId, taskId = "", runId = "", role, content, attachments = [], provider = "", model = "", providerSessionId = "", metadata = {} }) {
    if (!getConversation(conversationId)) throw new Error("Conversation not found");
    const messageId = id("message");
    const timestamp = now();
    db.prepare(`INSERT INTO hub_messages (id,conversation_id,task_id,run_id,role,content,attachments_json,provider,model,provider_session_id,metadata_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(messageId, conversationId, taskId, runId, role, content, json(attachments), provider, model, providerSessionId, json(metadata), timestamp);
    db.prepare("UPDATE hub_conversations SET updated_at=? WHERE id=?").run(timestamp, conversationId);
    return message(db.prepare("SELECT * FROM hub_messages WHERE id=?").get(messageId));
  }
  function updateMessage(messageId, patch) {
    const current = db.prepare("SELECT * FROM hub_messages WHERE id=?").get(messageId);
    if (!current) return null;
    const next = { content: current.content, providerSessionId: current.provider_session_id, metadata: parse(current.metadata_json, {}), ...patch };
    db.prepare("UPDATE hub_messages SET content=?,provider_session_id=?,metadata_json=? WHERE id=?")
      .run(next.content, next.providerSessionId, json(next.metadata), messageId);
    return message(db.prepare("SELECT * FROM hub_messages WHERE id=?").get(messageId));
  }
  function addDecision({ conversationId, taskId = "", content, sourceMessageId = "" }) {
    const decisionId = id("decision");
    db.prepare("INSERT INTO hub_decisions (id,conversation_id,task_id,content,source_message_id,created_at) VALUES (?,?,?,?,?,?)")
      .run(decisionId, conversationId, taskId, content, sourceMessageId, now());
    return decisionId;
  }
  function listDecisions(conversationId) {
    return db.prepare("SELECT id,task_id AS taskId,content,source_message_id AS sourceMessageId,created_at AS createdAt FROM hub_decisions WHERE conversation_id=? ORDER BY created_at,rowid")
      .all(conversationId);
  }
  function getTaskState(conversationId) {
    return taskState(db.prepare("SELECT * FROM hub_task_state WHERE conversation_id=?").get(conversationId));
  }
  function updateTaskState(conversationId, patch) {
    const state = getTaskState(conversationId);
    if (!state) return null;
    const next = { ...state, ...patch };
    db.prepare(`UPDATE hub_task_state SET task_id=?,objective=?,requirements_json=?,acceptance_json=?,plan_json=?,completed_json=?,remaining_json=?,blockers_json=?,relevant_files_json=?,tests_json=?,summary=?,updated_at=? WHERE conversation_id=?`)
      .run(next.taskId, next.objective, json(next.requirements), json(next.acceptanceCriteria), json(next.currentPlan), json(next.completedSteps), json(next.remainingSteps), json(next.blockers), json(next.relevantFiles), json(next.tests), next.summary, now(), conversationId);
    return getTaskState(conversationId);
  }
  function getProviderSession(conversationId, provider) {
    return db.prepare("SELECT native_session_id AS nativeSessionId,status,updated_at AS updatedAt FROM hub_provider_sessions WHERE conversation_id=? AND provider=?")
      .get(conversationId, provider) || null;
  }
  function setProviderSession(conversationId, provider, nativeSessionId, status = "ready") {
    db.prepare(`INSERT INTO hub_provider_sessions (conversation_id,provider,native_session_id,status,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(conversation_id,provider) DO UPDATE SET native_session_id=excluded.native_session_id,status=excluded.status,updated_at=excluded.updated_at`)
      .run(conversationId, provider, nativeSessionId, status, now());
  }
  function listProviderSessions(conversationId) {
    return db.prepare("SELECT provider,native_session_id AS nativeSessionId,status,updated_at AS updatedAt FROM hub_provider_sessions WHERE conversation_id=?")
      .all(conversationId);
  }
  function createRun({ conversationId, taskId = "", provider, model, reasoningLevel, role = "developer", parentRunId = "", handoffFromRunId = "", handoffCount = 0 }) {
    const runId = id("provider-run");
    db.prepare(`INSERT INTO hub_provider_runs (id,conversation_id,task_id,provider,model,reasoning,role,status,parent_run_id,handoff_from_run_id,handoff_count,started_at)
      VALUES (?,?,?,?,?,?,?,'running',?,?,?,?)`).run(runId, conversationId, taskId, provider, model, reasoningLevel, role, parentRunId, handoffFromRunId, handoffCount, now());
    return getRun(runId);
  }
  function getRun(runId) { return run(db.prepare("SELECT * FROM hub_provider_runs WHERE id=?").get(runId)); }
  function listRuns(conversationId) {
    return db.prepare("SELECT * FROM hub_provider_runs WHERE conversation_id=? ORDER BY started_at,rowid").all(conversationId).map(run);
  }
  function updateRun(runId, patch) {
    const current = getRun(runId);
    if (!current) return null;
    const next = { ...current, ...patch };
    db.prepare(`UPDATE hub_provider_runs SET native_session_id=?,status=?,error_category=?,retry_count=?,handoff_count=?,usage_json=?,commands_json=?,tests_json=?,files_json=?,metadata_json=?,finished_at=? WHERE id=?`)
      .run(next.providerSessionId, next.status, next.errorCategory, next.retryCount, next.handoffCount, json(next.usage), json(next.commandsExecuted), json(next.testsExecuted), json(next.filesChanged), json(next.metadata), next.finishedAt, runId);
    return getRun(runId);
  }
  function acquireLease(resource, workspace, conversationId, runId, provider) {
    const current = db.prepare("SELECT * FROM hub_leases WHERE resource=? AND workspace=?").get(resource, workspace);
    if (current && current.run_id !== runId) return false;
    db.prepare("INSERT OR IGNORE INTO hub_leases (resource,workspace,conversation_id,run_id,provider,acquired_at) VALUES (?,?,?,?,?,?)")
      .run(resource, workspace, conversationId, runId, provider, now());
    return true;
  }
  function releaseLease(resource, workspace, runId) {
    return db.prepare("DELETE FROM hub_leases WHERE resource=? AND workspace=? AND run_id=?").run(resource, workspace, runId).changes === 1;
  }
  function listLeases(conversationId) {
    return db.prepare("SELECT resource,workspace,conversation_id AS conversationId,run_id AS runId,provider,acquired_at AS acquiredAt FROM hub_leases WHERE conversation_id=?").all(conversationId);
  }
  function addCheckpoint(conversationId, runId, envelope) {
    const checkpointId = id("checkpoint");
    db.prepare("INSERT INTO hub_checkpoints (id,conversation_id,run_id,envelope_json,created_at) VALUES (?,?,?,?,?)")
      .run(checkpointId, conversationId, runId, json(envelope), now());
    return checkpointId;
  }
  function getLatestCheckpoint(conversationId) {
    const row = db.prepare("SELECT id,envelope_json,created_at FROM hub_checkpoints WHERE conversation_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(conversationId);
    return row && { id: row.id, envelope: parse(row.envelope_json, {}), createdAt: row.created_at };
  }
  function recoverInterruptedRuns() {
    const rows = db.prepare("SELECT id FROM hub_provider_runs WHERE status='running'").all();
    for (const row of rows) updateRun(row.id, { status: "interrupted", errorCategory: "PROVIDER_UNAVAILABLE", finishedAt: now() });
    // A child may survive an API restart. Keep its lease until liveness is verified.
    return rows.length;
  }
  return { getConversation, listConversations, createConversation, updateConversation, listMessages, countMessages, addMessage, updateMessage,
    addDecision, listDecisions, getTaskState, updateTaskState, getProviderSession, setProviderSession,
    listProviderSessions, createRun, getRun, listRuns, updateRun, acquireLease, releaseLease, listLeases,
    addCheckpoint, getLatestCheckpoint, recoverInterruptedRuns };
}
