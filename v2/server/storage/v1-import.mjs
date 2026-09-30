import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse, tx } from "./db.mjs";
import { slugify } from "../domain/projects.mjs";

const IMPORTED_TABLES = ["hub_conversations", "hub_messages", "hub_decisions", "hub_task_state", "hub_provider_runs", "hub_provider_sessions", "tasks", "backups", "execution_approvals", "hub_events"];
const REFERENCE_TABLES = ["agent_runs", "execution_attempts", "workflow_transitions", "snapshots", "task_drafts", "hub_checkpoints", "locks", "hub_leases"];

const TASK_STATUS = { draft: "DRAFT", backlog: "DRAFT", ready: "DRAFT", in_progress: "BLOCKED", blocked: "BLOCKED", review: "BLOCKED", qa: "BLOCKED", done: "COMPLETED", cancelled: "CANCELLED" };
const RUN_STATUS = { completed: "completed", failed: "failed", blocked: "blocked", cancelled: "interrupted", interrupted: "interrupted", running: "interrupted_unknown" };

const sha256File = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** Takes a consistent online-backup snapshot of the live V1 database (read-only source). */
export async function snapshotLegacy(legacyDbPath, destDir) {
  if (!fs.existsSync(legacyDbPath)) throw new HubError("not_found", "V1 database not found");
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, `agent-hub-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`);
  const source = new DatabaseSync(legacyDbPath, { readOnly: true });
  try { await sqliteBackup(source, dest); } finally { source.close(); }
  return { path: dest, sha256: sha256File(dest) };
}

function openLegacy(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
  const all = (table, order = "rowid") => (tables.has(table) ? db.prepare(`SELECT * FROM "${table}" ORDER BY ${order}`).all() : []);
  return { db, tables, all };
}

/**
 * Dry-run: computes exactly what would be created, without writing. The report is bound to the
 * snapshot's SHA-256; apply refuses a different file.
 */
export function planImport(snapshotPath, v2db, projects) {
  const legacy = openLegacy(snapshotPath);
  try {
    const counts = Object.fromEntries([...IMPORTED_TABLES, ...REFERENCE_TABLES].map((t) => [t, legacy.tables.has(t) ? legacy.db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n : 0]));
    const alreadyMapped = v2db.prepare("SELECT legacy_table, COUNT(*) AS n FROM legacy_map GROUP BY legacy_table").all();
    const loose = (s) => slugify(s).replace(/-and-/g, "-");
    const knownSlugs = new Set(projects.list().map((p) => loose(p.slug)));
    const slugs = new Set([...legacy.all("hub_conversations").map((c) => c.project_slug), ...legacy.all("tasks").map((t) => t.project_slug), ...legacy.all("backups").map((b) => b.project_slug)]);
    const unknownProjects = [...slugs].filter((s) => !knownSlugs.has(loose(s)));
    const activeLocks = legacy.all("locks").filter((l) => l.status === "active").map((l) => ({ id: l.id, scope: l.scope, owner: l.owner, taskId: l.task_id, type: l.lock_type }));
    const openTasks = legacy.all("tasks").filter((t) => !["done", "cancelled"].includes(t.status)).map((t) => ({ id: t.id, title: t.title, status: t.status, mappedTo: TASK_STATUS[t.status] || "BLOCKED" }));
    return {
      source: snapshotPath, sourceSha256: sha256File(snapshotPath), plannedAt: new Date().toISOString(), counts,
      imported: IMPORTED_TABLES, keptAsReference: REFERENCE_TABLES, alreadyMapped,
      projectsToCreate: unknownProjects, activeV1Locks: activeLocks, openTasks,
      rules: [
        "V1 database is never modified; import reads a consistent snapshot.",
        "V1 tasks that were in progress/review/qa become BLOCKED with the original status in the reason; nothing is resumed.",
        "V1 done tasks become COMPLETED with 'imported from V1' as recorded evidence.",
        "V1 approvals are imported as historical (status legacy_*), never usable for V2 actions.",
        "V1 provider sessions are imported as legacy and are not resumed by V2.",
        "V1 backups are listed as legacy records; they never satisfy the V2 backup gate.",
        "Reference tables stay readable through the legacy browser (read-only).",
      ],
    };
  } finally { legacy.db.close(); }
}

export function applyImport({ snapshotPath, expectedSha256, v2db, bus, projects, clock }) {
  const actual = sha256File(snapshotPath);
  if (actual !== expectedSha256) throw new HubError("conflict", "Snapshot changed since the dry-run; run the dry-run again");
  const legacy = openLegacy(snapshotPath);
  const batchId = newId("imp");
  const report = { batchId, created: {}, skipped: [] };
  const bump = (table) => { report.created[table] = (report.created[table] || 0) + 1; };
  const mapped = (table, id) => v2db.prepare("SELECT v2_id FROM legacy_map WHERE legacy_table = ? AND legacy_id = ?").get(table, id)?.v2_id || null;
  const map = (legacyTable, legacyId, v2Table, v2Id) => {
    v2db.prepare("INSERT INTO legacy_map (batch_id, legacy_table, legacy_id, v2_table, v2_id) VALUES (?, ?, ?, ?, ?)").run(batchId, legacyTable, legacyId, v2Table, v2Id);
    bump(v2Table);
  };
  const now = clock().toISOString();
  try {
    tx(v2db, () => {
      v2db.prepare("INSERT INTO import_batches (id, source, source_sha256, report_json, status, created_at) VALUES (?, ?, ?, '{}', 'applying', ?)").run(batchId, snapshotPath, actual, now);

      const loose = (s) => slugify(s).replace(/-and-/g, "-");
      const projectFor = (slug, workspace = "") => {
        const existing = projects.get(slug) || projects.get(slugify(slug)) || projects.list().find((p) => loose(p.slug) === loose(slug));
        if (existing) return existing.id;
        const known = mapped("project_slug", slug);
        if (known) return known;
        const id = newId("prj");
        v2db.prepare(`INSERT INTO projects (id, slug, name, path, execution_allowed, trusted_config, source, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, 'legacy-import', ?, ?)`)
          .run(id, slugify(slug) || slug, slug, workspace || "(unknown path from V1)", now, now);
        map("project_slug", slug, "projects", id);
        return id;
      };

      for (const c of legacy.all("hub_conversations", "created_at")) {
        if (mapped("hub_conversations", c.id)) { report.skipped.push(`conversation ${c.id} already imported`); continue; }
        const id = newId("conv");
        v2db.prepare("INSERT INTO conversations (id, project_id, title, status, writer_provider, created_at, updated_at, legacy_id) VALUES (?, ?, ?, 'idle', '', ?, ?, ?)")
          .run(id, projectFor(c.project_slug, c.workspace), `${c.title} (V1)`, c.created_at, c.updated_at, c.id);
        map("hub_conversations", c.id, "conversations", id);
        let position = 0;
        for (const m of legacy.all("hub_messages", "created_at").filter((row) => row.conversation_id === c.id)) {
          position += 1;
          const role = ["user", "assistant", "system", "tool"].includes(m.role) ? m.role : "note";
          const mid = newId("msg");
          v2db.prepare(`INSERT INTO messages (id, conversation_id, position, role, provider, model, content, content_sha256, status, metadata_json, created_at, finalized_at, legacy_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'final', ?, ?, ?, ?)`).run(mid, id, position, role, m.provider || "", m.model || "", m.content,
            crypto.createHash("sha256").update(m.content).digest("hex"), json({ legacy: { runId: m.run_id, taskId: m.task_id, providerSessionId: m.provider_session_id, metadata: parse(m.metadata_json, {}) } }),
            m.created_at, m.created_at, m.id);
          map("hub_messages", m.id, "messages", mid);
        }
        const state = legacy.all("hub_task_state").find((s) => s.conversation_id === c.id);
        if (state) {
          const content = [`Objective: ${state.objective}`, `Summary: ${state.summary}`, `Remaining: ${state.remaining_json}`, `Blockers: ${state.blockers_json}`].join("\n");
          const sid = newId("sum");
          v2db.prepare("INSERT INTO summaries (id, conversation_id, covers_until_position, content, created_by, created_at) VALUES (?, ?, ?, ?, 'v1-import', ?)").run(sid, id, position, content, state.updated_at);
          map("hub_task_state", state.conversation_id, "summaries", sid);
        }
        for (const s of legacy.all("hub_provider_sessions").filter((row) => row.conversation_id === c.id)) {
          const pid = newId("psess");
          v2db.prepare("INSERT INTO provider_sessions (id, conversation_id, provider, native_session_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'legacy', ?, ?)")
            .run(pid, id, s.provider, s.native_session_id, s.updated_at, s.updated_at);
          map("hub_provider_sessions", `${s.conversation_id}:${s.provider}`, "provider_sessions", pid);
        }
        for (const d of legacy.all("hub_decisions").filter((row) => row.conversation_id === c.id)) {
          const did = newId("dec");
          v2db.prepare("INSERT INTO decisions (id, conversation_id, title, decision, source_ref, author, created_at) VALUES (?, ?, ?, ?, ?, 'v1-import', ?)")
            .run(did, id, d.content.slice(0, 80), d.content, `v1:hub_messages/${d.source_message_id}`, d.created_at);
          map("hub_decisions", d.id, "decisions", did);
        }
        for (const r of legacy.all("hub_provider_runs", "started_at").filter((row) => row.conversation_id === c.id)) {
          const rid = newId("run");
          v2db.prepare(`INSERT INTO agent_runs (id, conversation_id, role_id, stage, provider, model, effort, status, provider_session_id, error_category, usage_json, evidence_json, started_at, finished_at, created_at, legacy_id)
            VALUES (?, ?, ?, 'legacy', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(rid, id, r.role || "", r.provider, r.model || "", r.reasoning || "", RUN_STATUS[r.status] || "failed",
            r.native_session_id || null, r.error_category || null, r.usage_json, json({ legacy: { status: r.status, metadata: parse(r.metadata_json, {}), tests: parse(r.tests_json, []), files: parse(r.files_json, []) } }),
            r.started_at, r.finished_at || null, r.started_at, r.id);
          map("hub_provider_runs", r.id, "agent_runs", rid);
        }
      }

      for (const t of legacy.all("tasks", "created_at")) {
        if (mapped("tasks", t.id)) continue;
        const id = newId("task");
        const status = TASK_STATUS[t.status] || "BLOCKED";
        const reason = status === "COMPLETED" ? "Importat din V1 ca finalizat (dovezile V1 sunt în baza V1)" : `Importat din V1 cu starea „${t.status}”; nu se reia automat`;
        v2db.prepare(`INSERT INTO tasks (id, project_id, title, description, role_id, stage, status, status_reason, acceptance_json, created_at, updated_at, legacy_id)
          VALUES (?, ?, ?, ?, ?, 'owner', ?, ?, ?, ?, ?, ?)`).run(id, projectFor(t.project_slug), t.title, [t.goal, t.risks && `Risks: ${t.risks}`, t.blockers && `Blockers: ${t.blockers}`].filter(Boolean).join("\n"),
          "", status, reason, json(t.acceptance ? [t.acceptance] : []), t.created_at, t.updated_at, t.id);
        map("tasks", t.id, "tasks", id);
      }

      for (const b of legacy.all("backups", "created_at")) {
        if (mapped("backups", b.id)) continue;
        const id = newId("bkp");
        const manifest = parse(b.manifest_json, {});
        v2db.prepare("INSERT INTO backups (id, project_id, reason, status, archive_path, file_count, skipped_json, created_at, legacy_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(id, projectFor(b.project_slug), b.reason || "V1 backup", `legacy_${b.status}`, b.path, manifest.fileCount || 0, json(manifest.skippedFiles || []), b.created_at, b.id);
        map("backups", b.id, "backups", id);
      }

      for (const a of legacy.all("execution_approvals", "created_at")) {
        if (mapped("execution_approvals", a.id)) continue;
        const id = newId("apr");
        v2db.prepare(`INSERT INTO approvals (id, action_kind, target, payload_json, payload_hash, code_version, permission_tier, scope_type, scope_id, status, requested_by, decided_by, decided_via, decision_note, expires_at, created_at, decided_at)
          VALUES (?, 'v1.execution', ?, ?, ?, 'v1', 'EXTERNAL_ACTIONS', 'legacy_task', ?, ?, 'v1', ?, 'v1', ?, ?, ?, ?)`)
          .run(id, a.project_slug, json({ agentRunId: a.agent_run_id, revision: a.revision, requestNote: a.request_note }), `legacy:${a.id}`, a.task_id, `legacy_${a.status}`,
            a.decision_by || null, a.decision_note || "", a.expires_at, a.created_at, a.decided_at || null);
        map("execution_approvals", a.id, "approvals", id);
      }

      for (const e of legacy.all("hub_events", "created_at")) {
        const dedupe = `legacy:hub_events:${e.id}`;
        if (v2db.prepare("SELECT 1 FROM events WHERE dedupe_key = ?").get(dedupe)) continue;
        const id = newId("evt");
        v2db.prepare("INSERT INTO events (id, type, scope_type, scope_id, project_id, source, payload_json, dedupe_key, created_at) VALUES (?, ?, ?, ?, NULL, 'v1-import', ?, ?, ?)")
          .run(id, `legacy.${e.event_type}`, e.entity_type || "legacy", e.entity_id || "unknown", json({ summary: e.summary, projectSlug: e.project_slug }), dedupe, e.created_at);
        map("hub_events", e.id, "events", id);
      }

      const summary = { batchId, importedAt: now, source: path.basename(snapshotPath), sourceSha256: actual, created: report.created,
        activeV1Locks: legacy.all("locks").filter((l) => l.status === "active").map((l) => ({ id: l.id, scope: l.scope, owner: l.owner, taskId: l.task_id })) };
      v2db.prepare("UPDATE import_batches SET status = 'applied', report_json = ? WHERE id = ?").run(json(report), batchId);
      v2db.prepare(`INSERT INTO settings (key, value_json, updated_at) VALUES ('legacyImport', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
        .run(json(summary), now);
      bus.append({ type: "legacy.imported", scopeType: "system", scopeId: batchId, source: "user", payload: summary });
    });
  } finally { legacy.db.close(); }
  return report;
}

/** Reverts one import batch: removes exactly the rows it created (dependent rows first). */
export function revertImport({ batchId, v2db, bus }) {
  const batch = v2db.prepare("SELECT * FROM import_batches WHERE id = ?").get(batchId);
  if (!batch || batch.status !== "applied") throw new HubError("conflict", "Batch is not applied");
  const order = ["events", "approvals", "backups", "decisions", "provider_sessions", "summaries", "agent_runs", "messages", "tasks", "conversations", "projects"];
  const removed = {};
  tx(v2db, () => {
    for (const table of order) {
      const ids = v2db.prepare("SELECT v2_id FROM legacy_map WHERE batch_id = ? AND v2_table = ?").all(batchId, table).map((r) => r.v2_id);
      for (const id of ids) {
        const key = table === "events" ? "id" : "id";
        removed[table] = (removed[table] || 0) + v2db.prepare(`DELETE FROM ${table} WHERE ${key} = ?`).run(id).changes;
      }
    }
    v2db.prepare("DELETE FROM legacy_map WHERE batch_id = ?").run(batchId);
    v2db.prepare("UPDATE import_batches SET status = 'reverted', reverted_at = ? WHERE id = ?").run(new Date().toISOString(), batchId);
    v2db.prepare("DELETE FROM settings WHERE key = 'legacyImport'").run();
    bus.append({ type: "legacy.reverted", scopeType: "system", scopeId: batchId, source: "user", payload: { removed } });
  });
  return { batchId, removed };
}

/** Read-only browser over a V1 snapshot for tables that are kept as reference. */
export function readLegacyTable(snapshotPath, table, { limit = 200, offset = 0 } = {}) {
  if (![...IMPORTED_TABLES, ...REFERENCE_TABLES].includes(table)) throw new HubError("validation", "Table not browsable");
  const legacy = openLegacy(snapshotPath);
  try {
    if (!legacy.tables.has(table)) return { table, rows: [], total: 0 };
    const total = legacy.db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;
    const rows = legacy.db.prepare(`SELECT * FROM "${table}" ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(Math.min(500, limit), offset);
    return { table, total, rows };
  } finally { legacy.db.close(); }
}
