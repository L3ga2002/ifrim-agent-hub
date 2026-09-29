import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createConversationStore } from "../apps/api/src/conversation-store.mjs";
import { createContextEnvelope, renderHandoffPrompt } from "../apps/api/src/context-engine.mjs";

test("transcript, decisions and task state survive provider changes", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const store = createConversationStore(db);
    const conversation = store.createConversation({ projectSlug: "hub", title: "Test", workspace: process.cwd(), taskId: "HUB-TEST", objective: "Continue task" });
    store.addMessage({ conversationId: conversation.id, role: "user", content: "Original request" });
    store.addMessage({ conversationId: conversation.id, role: "user", content: "Second request" });
    store.addMessage({ conversationId: conversation.id, role: "user", content: "Latest request" });
    store.addDecision({ conversationId: conversation.id, content: "Keep SQLite" });
    store.updateTaskState(conversation.id, { summary: "Step one finished", completedSteps: ["Step one"], remainingSteps: ["Step two"] });
    store.setProviderSession(conversation.id, "codex", "codex-thread");
    store.setProviderSession(conversation.id, "claude", "claude-session");
    store.updateConversation(conversation.id, { preferredProvider: "claude" });
    assert.equal(store.listMessages(conversation.id)[0].content, "Original request");
    assert.equal(store.listMessages(conversation.id, 1)[0].content, "Latest request");
    assert.equal(store.listMessages(conversation.id, 1, 2)[0].content, "Original request");
    assert.equal(store.countMessages(conversation.id), 3);
    assert.equal(store.listDecisions(conversation.id)[0].content, "Keep SQLite");
    assert.equal(store.getTaskState(conversation.id).summary, "Step one finished");
    assert.equal(store.listProviderSessions(conversation.id).length, 2);
    const envelope = await createContextEnvelope({ store, conversation: store.getConversation(conversation.id), project: { slug: "hub", path: process.cwd(), frontend: "http://127.0.0.1:3004", backend: "" } });
    assert.equal(envelope.originalObjective, "Continue task");
    assert.equal(envelope.importantDecisions[0].content, "Keep SQLite");
    assert.match(renderHandoffPrompt(envelope), /THIS IS A CONTINUATION/);
  } finally { db.close(); }
});

test("exclusive lease survives interrupted run recovery", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const store = createConversationStore(db);
    const conversation = store.createConversation({ projectSlug: "hub", title: "Lease", workspace: process.cwd() });
    const run = store.createRun({ conversationId: conversation.id, provider: "codex", model: "sol", reasoningLevel: "medium" });
    assert.equal(store.acquireLease("workspace-write", process.cwd(), conversation.id, run.id, "codex"), true);
    assert.equal(store.recoverInterruptedRuns(), 1);
    assert.equal(store.getRun(run.id).status, "interrupted");
    const second = store.createRun({ conversationId: conversation.id, provider: "claude", model: "sonnet", reasoningLevel: "medium" });
    assert.equal(store.acquireLease("workspace-write", process.cwd(), conversation.id, second.id, "claude"), false);
    assert.equal(store.listLeases(conversation.id).length, 1);
  } finally { db.close(); }
});
