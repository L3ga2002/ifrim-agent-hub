import fs from "node:fs";
import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { sha256 } from "../core/canonical.mjs";
import { json, parse } from "../storage/db.mjs";
import { containsSecretLikeContent } from "../security/redact.mjs";

const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_TYPES = new Set(["text/plain", "text/markdown", "application/json", "text/csv", "image/png", "image/jpeg", "image/webp", "application/pdf"]);

/**
 * One logical Hub conversation per thread of work; provider-native sessions are attached to it but
 * never replace it. Original messages are immutable once final; summaries live in their own table.
 */
export function createConversations({ db, bus, config, clock }) {
  const rowToConversation = (row) => row && ({ id: row.id, projectId: row.project_id, title: row.title, status: row.status,
    activeMissionId: row.active_mission_id, activeTaskId: row.active_task_id, writerProvider: row.writer_provider,
    createdAt: row.created_at, updatedAt: row.updated_at, version: row.version, legacyId: row.legacy_id });
  const rowToMessage = (row) => row && ({ id: row.id, conversationId: row.conversation_id, position: row.position, role: row.role,
    provider: row.provider, model: row.model, runId: row.run_id, content: row.content, contentSha256: row.content_sha256, status: row.status,
    clientMessageId: row.client_message_id, metadata: parse(row.metadata_json, {}), createdAt: row.created_at, finalizedAt: row.finalized_at, legacyId: row.legacy_id });

  function create({ projectId, title }, actor = "user") {
    const id = newId("conv");
    const now = clock().toISOString();
    db.prepare("INSERT INTO conversations (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, projectId, title, now, now);
    bus.append({ type: "conversation.created", scopeType: "conversation", scopeId: id, projectId, source: actor, payload: { title } });
    return get(id);
  }

  const get = (id) => rowToConversation(db.prepare("SELECT * FROM conversations WHERE id = ?").get(id));
  const list = (projectId = null) => (projectId
    ? db.prepare("SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC").all(projectId)
    : db.prepare("SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 200").all()).map(rowToConversation);

  function nextPosition(conversationId) {
    return db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM messages WHERE conversation_id = ?").get(conversationId).p;
  }

  /** Idempotent by clientMessageId: a retried POST returns the original message instead of a duplicate. */
  function addMessage({ conversationId, role, content, provider = "", model = "", runId = null, status = "final", clientMessageId = null, metadata = {} }, actor = "user") {
    const conversation = get(conversationId);
    if (!conversation) throw new HubError("not_found", "Conversation not found");
    if (clientMessageId) {
      const existing = db.prepare("SELECT * FROM messages WHERE conversation_id = ? AND client_message_id = ?").get(conversationId, clientMessageId);
      if (existing) return { ...rowToMessage(existing), duplicate: true };
    }
    const id = newId("msg");
    const now = clock().toISOString();
    const position = nextPosition(conversationId);
    db.prepare(`INSERT INTO messages (id, conversation_id, position, role, provider, model, run_id, content, content_sha256, status, client_message_id, metadata_json, created_at, finalized_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, conversationId, position, role, provider, model, runId, content, sha256(content), status,
      clientMessageId, json(metadata), now, status === "final" ? now : null);
    db.prepare("UPDATE conversations SET updated_at = ?, version = version + 1 WHERE id = ?").run(now, conversationId);
    bus.append({ type: "message.created", scopeType: "conversation", scopeId: conversationId, projectId: conversation.projectId, source: actor, runId,
      payload: { messageId: id, role, position, provider, model, status } });
    return rowToMessage(db.prepare("SELECT * FROM messages WHERE id = ?").get(id));
  }

  /** Only streaming messages may change; final messages are immutable originals. */
  function updateStreaming(messageId, content) {
    return db.prepare("UPDATE messages SET content = ?, content_sha256 = ? WHERE id = ? AND status = 'streaming'").run(content, sha256(content), messageId).changes === 1;
  }

  function finalize(messageId, { content, status = "final", metadata = {} }) {
    const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId);
    if (!row) return null;
    if (row.status !== "streaming") return rowToMessage(row);
    const now = clock().toISOString();
    db.prepare("UPDATE messages SET content = ?, content_sha256 = ?, status = ?, metadata_json = ?, finalized_at = ? WHERE id = ?")
      .run(content, sha256(content), status, json({ ...parse(row.metadata_json, {}), ...metadata }), now, messageId);
    bus.append({ type: "message.finalized", scopeType: "conversation", scopeId: row.conversation_id, source: "hub", runId: row.run_id,
      payload: { messageId, status, length: content.length } });
    return rowToMessage(db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId));
  }

  const messages = (conversationId, { after = 0, limit = 500 } = {}) =>
    db.prepare("SELECT * FROM messages WHERE conversation_id = ? AND position > ? ORDER BY position LIMIT ?").all(conversationId, after, limit).map(rowToMessage);

  function update(id, patch, actor = "user") {
    const current = get(id);
    if (!current) throw new HubError("not_found", "Conversation not found");
    const next = { ...current, ...patch };
    db.prepare("UPDATE conversations SET title = ?, status = ?, active_mission_id = ?, active_task_id = ?, writer_provider = ?, updated_at = ?, version = version + 1 WHERE id = ?")
      .run(next.title, next.status, next.activeMissionId, next.activeTaskId, next.writerProvider, clock().toISOString(), id);
    bus.append({ type: "conversation.updated", scopeType: "conversation", scopeId: id, projectId: current.projectId, source: actor, payload: { changed: Object.keys(patch) } });
    return get(id);
  }

  function addSummary(conversationId, { coversUntilPosition, content, createdBy }) {
    const id = newId("sum");
    db.prepare("INSERT INTO summaries (id, conversation_id, covers_until_position, content, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, conversationId, coversUntilPosition, content, createdBy, clock().toISOString());
    bus.append({ type: "summary.created", scopeType: "conversation", scopeId: conversationId, source: createdBy, payload: { summaryId: id, coversUntilPosition } });
    return id;
  }

  function saveAttachment({ conversationId, filename, mime, base64, provenance = "user-upload" }) {
    const conversation = get(conversationId);
    if (!conversation) throw new HubError("not_found", "Conversation not found");
    if (!ATTACHMENT_TYPES.has(mime)) throw new HubError("validation", `Attachment type ${mime} is not accepted`);
    const safeName = path.basename(String(filename)).replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "attachment";
    const data = Buffer.from(String(base64), "base64");
    if (!data.length || data.length > ATTACHMENT_MAX_BYTES) throw new HubError("validation", "Attachment must be between 1 byte and 10 MB");
    if (mime.startsWith("text/") || mime === "application/json") {
      if (containsSecretLikeContent(data.toString("utf8"))) throw new HubError("policy", "Attachment appears to contain a credential; remove it before uploading");
    }
    const hash = sha256(data);
    const id = newId("att");
    const dir = path.join(config.attachmentsDir, conversationId);
    fs.mkdirSync(dir, { recursive: true });
    const storagePath = path.join(dir, `${id}-${safeName}`);
    fs.writeFileSync(storagePath, data, { flag: "wx" });
    db.prepare(`INSERT INTO attachments (id, conversation_id, filename, mime, size, sha256, storage_path, provenance, permissions, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'project', ?)`).run(id, conversationId, safeName, mime, data.length, hash, storagePath, provenance, clock().toISOString());
    bus.append({ type: "attachment.added", scopeType: "conversation", scopeId: conversationId, source: "user", payload: { attachmentId: id, filename: safeName, size: data.length, sha256: hash } });
    return { id, filename: safeName, mime, size: data.length, sha256: hash, provenance };
  }

  const attachments = (conversationId) => db.prepare("SELECT id, filename, mime, size, sha256, provenance, message_id AS messageId, created_at AS createdAt FROM attachments WHERE conversation_id = ? ORDER BY created_at").all(conversationId);
  function linkAttachments(messageId, ids) {
    for (const attachmentId of ids) db.prepare("UPDATE attachments SET message_id = ? WHERE id = ? AND message_id IS NULL").run(messageId, attachmentId);
  }

  const providerSessions = (conversationId) => db.prepare("SELECT * FROM provider_sessions WHERE conversation_id = ? ORDER BY updated_at DESC").all(conversationId)
    .map((row) => ({ id: row.id, provider: row.provider, nativeSessionId: row.native_session_id, status: row.status, lastRunId: row.last_run_id, updatedAt: row.updated_at }));

  /** ProviderSession lifecycle: the newest native session of a provider is active, older ones are superseded. */
  function upsertProviderSession(conversationId, provider, nativeSessionId, runId, surfaceId = null) {
    const now = clock().toISOString();
    db.prepare(`INSERT INTO provider_sessions (id, conversation_id, provider, native_session_id, last_run_id, surface_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id, provider, native_session_id) DO UPDATE SET last_run_id = excluded.last_run_id, updated_at = excluded.updated_at, status = 'active',
        surface_id = COALESCE(excluded.surface_id, provider_sessions.surface_id)`)
      .run(newId("psess"), conversationId, provider, nativeSessionId, runId, surfaceId, now, now);
    db.prepare("UPDATE provider_sessions SET status = 'superseded', updated_at = ? WHERE conversation_id = ? AND provider = ? AND native_session_id <> ? AND status IN ('active','idle','lost')")
      .run(now, conversationId, provider, nativeSessionId);
  }

  const latestSession = (conversationId, provider) => db.prepare("SELECT native_session_id FROM provider_sessions WHERE conversation_id = ? AND provider = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1").get(conversationId, provider)?.native_session_id || "";

  return { create, get, list, addMessage, updateStreaming, finalize, messages, update, addSummary, saveAttachment, attachments, linkAttachments,
    providerSessions, upsertProviderSession, latestSession, rowToMessage };
}
