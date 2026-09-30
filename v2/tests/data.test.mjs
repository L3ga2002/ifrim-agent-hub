import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { makeTestHub, tempDir } from "./helpers.mjs";
import { planImport, applyImport, revertImport, readLegacyTable } from "../server/storage/v1-import.mjs";
import { redactText, redactDeep, containsSecretLikeContent } from "../server/security/redact.mjs";
import { parseVoiceCommand } from "../server/domain/voice.mjs";
import { leadKey } from "../server/domain/leads.mjs";

test("memory: diacritics-insensitive search, versioned corrections, agent facts refused, secrets refused", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const item = hub.bus.transaction(() => hub.memory.add({ scope: "CLIENT", scopeRef: "clientA", type: "FACT", title: "Ședința de ofertă", body: "Clientul preferă livrare în două etape.", author: "user", sourceRef: "meeting notes 2026-09-20" }));
    assert.equal(hub.memory.search("sedinta")[0].id, item.id);
    assert.equal(hub.memory.search("oferta", { scope: "CLIENT" }).length, 1);
    assert.throws(() => hub.bus.transaction(() => hub.memory.add({ scope: "PROJECT", scopeRef: "p1", type: "FACT", title: "x", body: "y", author: "agent:codex" })), /ASSUMPTION or HYPOTHESIS/);
    assert.throws(() => hub.bus.transaction(() => hub.memory.add({ scope: "PROJECT", scopeRef: "p1", type: "FACT", title: "key", body: "api_key = sk-proj-abcdefghijklmnop1234", author: "user" })), /credentials/);
    const revised = hub.bus.transaction(() => hub.memory.revise(item.id, { body: "Clientul preferă livrare în trei etape." }));
    assert.equal(revised.version, 2);
    assert.equal(hub.memory.get(item.id).type, "OUTDATED");
    assert.equal(hub.memory.search("etape").length, 1, "only the active version is returned by default");
    assert.equal(hub.memory.search("etape", { includeInactive: true }).length, 2, "history kept");
    hub.bus.transaction(() => hub.memory.remove(revised.id, "user"));
    assert.equal(hub.memory.get(revised.id).body, "[deleted]");
  } finally { await t.cleanup(); }
});

test("T26 redaction covers keys, bearer tokens, JWTs and assignments in logs, events and exports", async () => {
  const text = "token=abc123secretvalue Authorization: Bearer abcdefghijklmnopqrstuvwxyz sk-ant-api03-abcdefghijkl sk-proj-abcdefghijklmnopqrstu eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk ghp_abcdefghijklmnopqrstuvwxyz0123";
  const out = redactText(text);
  for (const secret of ["abc123secretvalue", "abcdefghijklmnopqrstuvwxyz ", "sk-ant-api03", "sk-proj-abc", "eyJhbGci", "ghp_abc"]) assert.ok(!out.includes(secret), secret);
  assert.equal(redactDeep({ refresh_token: "zzz", nested: { password: "p", ok: "fine" } }).nested.password, "[redacted]");
  assert.equal(containsSecretLikeContent("nothing here"), false);
  const t = await makeTestHub();
  try {
    const event = t.hub.bus.emit({ type: "test.secret", scopeType: "system", scopeId: "x", payload: { note: "api_key=sk-proj-abcdefghijklmnop1234" } });
    const stored = t.hub.db.prepare("SELECT payload_json FROM events WHERE id = ?").get(event.id).payload_json;
    assert.ok(!stored.includes("sk-proj-abcdefghijklmnop1234"));
  } finally { await t.cleanup(); }
});

test("T19/T20 voice parser: Romanian commands, refusal of authorizing words", () => {
  assert.equal(parseVoiceCommand("Oprește").command, "stop_all");
  assert.equal(parseVoiceCommand("STOP").command, "stop_all");
  assert.equal(parseVoiceCommand("pauză").command, "pause");
  assert.equal(parseVoiceCommand("arată-mi aprobările").command, "show_approvals");
  assert.equal(parseVoiceCommand("aprobă și publică").kind, "refused");
  assert.equal(parseVoiceCommand("șterge tot").kind, "refused");
  assert.equal(parseVoiceCommand("fă deploy").kind, "refused");
  assert.equal(parseVoiceCommand("verifică testele pentru modulul de backup").kind, "message");
});

test("leads: deduplication by domain/company and evidence requires source + date", async () => {
  assert.equal(leadKey("Firma X SRL", "https://www.firmax.ro/contact"), "d:firmax.ro");
  assert.equal(leadKey("Firma X S.R.L.", ""), leadKey("firma x", ""));
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const result = hub.bus.transaction(() => hub.leads.importText("Firma X SRL; firmax.ro\nFirma X; https://www.firmax.ro\nAlta Firma\n\n"));
    assert.equal(result.created, 2);
    assert.equal(result.duplicates.length, 1);
    const lead = hub.leads.list().find((l) => l.domain === "firmax.ro");
    assert.throws(() => hub.leads.addEvidence(lead.id, { claim: "Has 20 employees", sourceUrl: "", observedAt: "" }), /source URL/);
    const updated = hub.leads.addEvidence(lead.id, { claim: "Lists delivery services on its site", sourceUrl: "https://firmax.ro/servicii", observedAt: "2026-09-29" });
    assert.equal(updated.evidence.length, 1);
  } finally { await t.cleanup(); }
});

function makeLegacyDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE tasks (id TEXT PRIMARY KEY, project_slug TEXT, project_name TEXT, title TEXT, goal TEXT, stage TEXT, owner_agent TEXT, reviewer_agent TEXT, qa_agent TEXT, status TEXT, priority TEXT, affected_area TEXT, acceptance TEXT, risks TEXT, blockers TEXT, approval_required INTEGER, source TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE locks (id TEXT PRIMARY KEY, project_slug TEXT, project_name TEXT, scope TEXT, lock_type TEXT, status TEXT, reason TEXT, owner TEXT, task_id TEXT, expires_at TEXT, released_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE hub_events (id TEXT PRIMARY KEY, event_type TEXT, entity_type TEXT, entity_id TEXT, project_slug TEXT, summary TEXT, created_at TEXT);
    CREATE TABLE backups (id TEXT PRIMARY KEY, task_id TEXT, project_slug TEXT, project_name TEXT, backup_type TEXT, status TEXT, path TEXT, manifest_json TEXT, reason TEXT, created_at TEXT);
    CREATE TABLE execution_approvals (id TEXT PRIMARY KEY, agent_run_id TEXT, task_id TEXT, project_slug TEXT, project_name TEXT, status TEXT, revision INTEGER, packet_updated_at TEXT, request_note TEXT, decision_note TEXT, decision_by TEXT, expires_at TEXT, decided_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE hub_conversations (id TEXT PRIMARY KEY, project_slug TEXT, title TEXT, active_task_id TEXT, preferred_provider TEXT, current_provider TEXT, status TEXT, workspace TEXT, branch TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE hub_messages (id TEXT PRIMARY KEY, conversation_id TEXT, task_id TEXT, run_id TEXT, role TEXT, content TEXT, attachments_json TEXT, provider TEXT, model TEXT, provider_session_id TEXT, metadata_json TEXT, created_at TEXT);
    CREATE TABLE hub_decisions (id TEXT PRIMARY KEY, conversation_id TEXT, task_id TEXT, content TEXT, source_message_id TEXT, created_at TEXT);
    CREATE TABLE hub_task_state (conversation_id TEXT PRIMARY KEY, task_id TEXT, objective TEXT, requirements_json TEXT, acceptance_json TEXT, plan_json TEXT, completed_json TEXT, remaining_json TEXT, blockers_json TEXT, relevant_files_json TEXT, tests_json TEXT, summary TEXT, updated_at TEXT);
    CREATE TABLE hub_provider_sessions (conversation_id TEXT, provider TEXT, native_session_id TEXT, status TEXT, updated_at TEXT, PRIMARY KEY(conversation_id, provider));
    CREATE TABLE hub_provider_runs (id TEXT PRIMARY KEY, conversation_id TEXT, task_id TEXT, provider TEXT, model TEXT, reasoning TEXT, role TEXT, native_session_id TEXT, status TEXT, error_category TEXT, retry_count INTEGER, handoff_count INTEGER, parent_run_id TEXT, handoff_from_run_id TEXT, usage_json TEXT, commands_json TEXT, tests_json TEXT, files_json TEXT, metadata_json TEXT, started_at TEXT, finished_at TEXT);
  `);
  const ts = "2026-09-28T10:00:00.000Z";
  db.prepare("INSERT INTO tasks VALUES ('task-1','ifrim-agent-hub','Ifrim Agent Hub','HUB-018 multi-provider','Accept Claude + Codex','', 'Codex','','ifrim-qa','in_progress','high','','Claude run accepted','','',0,'agent-hub',?,?)").run(ts, ts);
  db.prepare("INSERT INTO tasks VALUES ('task-2','ifrim-agent-hub','Ifrim Agent Hub','HUB-015','Continuation','', 'Codex','','ifrim-qa','done','normal','','','','',0,'agent-hub',?,?)").run(ts, ts);
  db.prepare("INSERT INTO locks VALUES ('LOCK-1','ifrim-agent-hub','Ifrim Agent Hub','HUB-018','exclusive','active','owner','ifrim-backend','task-1','','',?,?)").run(ts, ts);
  db.prepare("INSERT INTO hub_events VALUES ('ev-1','created','task','task-1','ifrim-agent-hub','Task created',?)").run(ts);
  db.prepare("INSERT INTO backups VALUES ('backup-1','task-1','ifrim-agent-hub','Ifrim Agent Hub','zip','created','C:/x.zip','{\"fileCount\":10}','auto',?)").run(ts);
  db.prepare("INSERT INTO execution_approvals VALUES ('apr-1','run-1','task-1','ifrim-agent-hub','Ifrim Agent Hub','approved',1,?,'', '', 'Catalin', ?, ?, ?, ?)").run(ts, ts, ts, ts, ts);
  db.prepare("INSERT INTO hub_conversations VALUES ('conv-1','ifrim-agent-hub','HUB-018','task-1','auto','codex','blocked','C:/hub','main',?,?)").run(ts, ts);
  db.prepare("INSERT INTO hub_messages VALUES ('m-1','conv-1','task-1','','user','Run the acceptance','[]','','','','{}',?)").run(ts);
  db.prepare("INSERT INTO hub_messages VALUES ('m-2','conv-1','task-1','r-1','assistant','HUB018_CODEX_OK','[]','codex','gpt-6-luna','s-1','{}',?)").run("2026-09-28T10:01:00.000Z");
  db.prepare("INSERT INTO hub_provider_sessions VALUES ('conv-1','codex','s-1','ready',?)").run(ts);
  db.prepare("INSERT INTO hub_provider_runs VALUES ('r-1','conv-1','task-1','codex','gpt-6-luna','max','developer','s-1','completed','',0,0,'','','{}','[]','[]','[]','{}',?,?)").run(ts, ts);
  db.prepare("INSERT INTO hub_task_state VALUES ('conv-1','task-1','Accept providers','[]','[]','[]','[]','[\"Claude run\"]','[]','[]','[]','Codex ok; Claude pending',?)").run(ts);
  db.close();
}

test("MIGRATE_DATA: V1 import dry-run → apply → idempotent → revert, V1 file untouched", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const dir = tempDir("legacy");
    const file = path.join(dir, "agent-hub-v1-test.sqlite");
    makeLegacyDb(file);
    const before = fs.readFileSync(file);
    const plan = planImport(file, hub.db, hub.projects);
    assert.equal(plan.counts.tasks, 2);
    assert.equal(plan.activeV1Locks[0].id, "LOCK-1");
    assert.equal(plan.openTasks[0].mappedTo, "BLOCKED");
    assert.throws(() => applyImport({ snapshotPath: file, expectedSha256: "bad", v2db: hub.db, bus: hub.bus, projects: hub.projects, clock: () => new Date() }), /changed since the dry-run/);
    const report = applyImport({ snapshotPath: file, expectedSha256: plan.sourceSha256, v2db: hub.db, bus: hub.bus, projects: hub.projects, clock: () => new Date() });
    assert.equal(report.created.tasks, 2);
    assert.equal(report.created.messages, 2);
    const imported = hub.db.prepare("SELECT * FROM tasks WHERE legacy_id = 'task-1'").get();
    assert.equal(imported.status, "BLOCKED");
    assert.match(imported.status_reason, /in_progress/);
    assert.equal(hub.db.prepare("SELECT status FROM approvals WHERE payload_hash = 'legacy:apr-1'").get().status, "legacy_approved", "V1 approvals are never usable");
    assert.equal(hub.db.prepare("SELECT status FROM provider_sessions").get().status, "legacy");
    assert.equal(hub.db.prepare("SELECT status FROM backups WHERE legacy_id = 'backup-1'").get().status, "legacy_created");
    assert.equal(hub.backups.freshVerified(hub.projects.hub().id).ok, false, "legacy backups never satisfy the gate");
    const second = applyImport({ snapshotPath: file, expectedSha256: plan.sourceSha256, v2db: hub.db, bus: hub.bus, projects: hub.projects, clock: () => new Date() });
    assert.equal(second.created.tasks, undefined, "re-applying creates no duplicates");
    const browse = readLegacyTable(file, "locks");
    assert.equal(browse.rows[0].id, "LOCK-1");
    const reverted = revertImport({ batchId: report.batchId, v2db: hub.db, bus: hub.bus });
    assert.equal(reverted.removed.tasks, 2);
    assert.equal(hub.db.prepare("SELECT COUNT(*) AS n FROM messages").get().n, 0);
    assert.deepEqual(fs.readFileSync(file), before, "V1 snapshot unchanged");
  } finally { await t.cleanup(); }
});
