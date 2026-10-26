/**
 * V2 schema. Every entity has a stable prefixed id, timestamps and (where mutable) a version for
 * optimistic concurrency. `events` is append-only; projections are updated in the same transaction.
 */
export const MIGRATIONS = [
  {
    version: 1,
    name: "v2-core-schema",
    up(db) {
      db.exec(`
        CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);

        CREATE TABLE clients (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
          demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);

        CREATE TABLE projects (
          id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, path TEXT NOT NULL,
          client_id TEXT REFERENCES clients(id), repo TEXT NOT NULL DEFAULT '', frontend_url TEXT NOT NULL DEFAULT '',
          backend_url TEXT NOT NULL DEFAULT '', stack TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '',
          execution_allowed INTEGER NOT NULL DEFAULT 0, trusted_config INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL DEFAULT 'registry', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);

        CREATE TABLE conversations (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'idle', active_mission_id TEXT, active_task_id TEXT,
          writer_provider TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1, legacy_id TEXT);
        CREATE INDEX idx_conversations_project ON conversations(project_id, updated_at);

        CREATE TABLE messages (
          id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), position INTEGER NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool','note')),
          provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', run_id TEXT,
          content TEXT NOT NULL, content_sha256 TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'final',
          client_message_id TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, finalized_at TEXT,
          legacy_id TEXT, UNIQUE (conversation_id, position));
        CREATE UNIQUE INDEX idx_messages_client_id ON messages(conversation_id, client_message_id) WHERE client_message_id IS NOT NULL;

        CREATE TABLE summaries (
          id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), covers_until_position INTEGER NOT NULL,
          content TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL);

        CREATE TABLE attachments (
          id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), message_id TEXT,
          filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL,
          storage_path TEXT NOT NULL, provenance TEXT NOT NULL, permissions TEXT NOT NULL DEFAULT 'project', created_at TEXT NOT NULL);

        CREATE TABLE missions (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), kind TEXT NOT NULL, title TEXT NOT NULL,
          objective TEXT NOT NULL, acceptance_json TEXT NOT NULL DEFAULT '[]', constraints_json TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'DRAFT', priority INTEGER NOT NULL DEFAULT 2, conversation_id TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, legacy_id TEXT);

        CREATE TABLE tasks (
          id TEXT PRIMARY KEY, mission_id TEXT REFERENCES missions(id), project_id TEXT NOT NULL REFERENCES projects(id),
          title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', role_id TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL DEFAULT 'owner',
          status TEXT NOT NULL DEFAULT 'DRAFT', status_reason TEXT NOT NULL DEFAULT '', priority INTEGER NOT NULL DEFAULT 2,
          depends_on_json TEXT NOT NULL DEFAULT '[]', acceptance_json TEXT NOT NULL DEFAULT '[]',
          attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 2, no_progress_retries INTEGER NOT NULL DEFAULT 0,
          last_activity_at TEXT, last_progress_at TEXT, provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
          access TEXT NOT NULL DEFAULT 'read-only', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1, legacy_id TEXT);
        CREATE INDEX idx_tasks_status ON tasks(status, priority);
        CREATE INDEX idx_tasks_mission ON tasks(mission_id);

        CREATE TABLE task_transitions (
          id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), from_status TEXT NOT NULL, to_status TEXT NOT NULL,
          reason TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL);

        CREATE TABLE agent_roles (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, definition_json TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL);

        CREATE TABLE agent_runs (
          id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id), conversation_id TEXT REFERENCES conversations(id),
          role_id TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL DEFAULT 'owner', provider TEXT NOT NULL, model TEXT NOT NULL DEFAULT '',
          effort TEXT NOT NULL DEFAULT '', access TEXT NOT NULL DEFAULT 'read-only', status TEXT NOT NULL,
          provider_session_id TEXT, native_thread_id TEXT, native_turn_id TEXT, pid INTEGER, pid_started_at TEXT,
          input_message_id TEXT, output_message_id TEXT, code_version TEXT NOT NULL DEFAULT '', backup_id TEXT, approval_id TEXT, grant_id TEXT,
          error_category TEXT, error_message TEXT, pre_inference INTEGER NOT NULL DEFAULT 0,
          usage_json TEXT NOT NULL DEFAULT '{}', evidence_json TEXT NOT NULL DEFAULT '{}', last_event_at TEXT,
          started_at TEXT, finished_at TEXT, created_at TEXT NOT NULL, legacy_id TEXT);
        CREATE INDEX idx_runs_status ON agent_runs(status);

        CREATE TABLE provider_sessions (
          id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), provider TEXT NOT NULL,
          native_session_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', last_run_id TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (conversation_id, provider, native_session_id));

        CREATE TABLE tool_calls (
          id TEXT PRIMARY KEY, run_id TEXT, tool TEXT NOT NULL, args_json TEXT NOT NULL, effects TEXT NOT NULL,
          status TEXT NOT NULL, result_json TEXT NOT NULL DEFAULT '{}', idempotency_key TEXT UNIQUE,
          started_at TEXT NOT NULL, finished_at TEXT);

        CREATE TABLE artifacts (
          id TEXT PRIMARY KEY, project_id TEXT, task_id TEXT, run_id TEXT, kind TEXT NOT NULL, path TEXT NOT NULL,
          sha256 TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0, description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);

        CREATE TABLE checkpoints (
          id TEXT PRIMARY KEY, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, kind TEXT NOT NULL,
          git_head TEXT NOT NULL DEFAULT '', git_branch TEXT NOT NULL DEFAULT '', dirty_json TEXT NOT NULL DEFAULT '[]',
          manifest_json TEXT NOT NULL DEFAULT '{}', backup_id TEXT, created_at TEXT NOT NULL);

        CREATE TABLE handoffs (
          id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), task_id TEXT,
          from_provider TEXT NOT NULL, to_provider TEXT NOT NULL, status TEXT NOT NULL, step TEXT NOT NULL,
          package_json TEXT NOT NULL DEFAULT '{}', package_sha256 TEXT NOT NULL DEFAULT '', checkpoint_id TEXT,
          error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

        CREATE TABLE decisions (
          id TEXT PRIMARY KEY, project_id TEXT, conversation_id TEXT, title TEXT NOT NULL, decision TEXT NOT NULL,
          rationale TEXT NOT NULL DEFAULT '', source_ref TEXT NOT NULL DEFAULT '', author TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active', supersedes_id TEXT, created_at TEXT NOT NULL);

        CREATE TABLE approvals (
          id TEXT PRIMARY KEY, action_kind TEXT NOT NULL, target TEXT NOT NULL, payload_json TEXT NOT NULL,
          payload_hash TEXT NOT NULL, code_version TEXT NOT NULL, permission_tier TEXT NOT NULL,
          scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, status TEXT NOT NULL, requested_by TEXT NOT NULL,
          decided_by TEXT, decided_via TEXT, decision_note TEXT NOT NULL DEFAULT '', single_use INTEGER NOT NULL DEFAULT 1,
          expires_at TEXT NOT NULL, created_at TEXT NOT NULL, decided_at TEXT, consumed_at TEXT);
        CREATE INDEX idx_approvals_status ON approvals(status, created_at);

        CREATE TABLE live_grants (
          id TEXT PRIMARY KEY, provider TEXT NOT NULL, project_id TEXT NOT NULL, max_attempts INTEGER NOT NULL,
          attempts_used INTEGER NOT NULL DEFAULT 0, tools_json TEXT NOT NULL, access TEXT NOT NULL,
          max_duration_s INTEGER NOT NULL, expires_at TEXT NOT NULL, status TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
          approval_id TEXT, created_at TEXT NOT NULL);

        CREATE TABLE capabilities (
          id TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at TEXT NOT NULL);

        CREATE TABLE usage_snapshots (
          id TEXT PRIMARY KEY, provider TEXT NOT NULL, route TEXT NOT NULL, source TEXT NOT NULL,
          data_json TEXT NOT NULL, captured_at TEXT NOT NULL);

        CREATE TABLE integration_connections (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, config_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

        CREATE TABLE automations (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, trigger_json TEXT NOT NULL, action_json TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 0, external_effects INTEGER NOT NULL DEFAULT 0,
          quiet_hours_json TEXT NOT NULL DEFAULT '{}', debounce_s INTEGER NOT NULL DEFAULT 60, max_chain_depth INTEGER NOT NULL DEFAULT 1,
          last_fired_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

        CREATE TABLE backups (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL,
          archive_path TEXT, manifest_path TEXT, sqlite_json TEXT NOT NULL DEFAULT '[]', file_count INTEGER NOT NULL DEFAULT 0,
          total_bytes INTEGER NOT NULL DEFAULT 0, archive_bytes INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0,
          skipped_json TEXT NOT NULL DEFAULT '[]', manifest_sha256 TEXT NOT NULL DEFAULT '', git_head TEXT NOT NULL DEFAULT '',
          restore_verified_at TEXT, restore_report_json TEXT NOT NULL DEFAULT '{}', error TEXT, created_at TEXT NOT NULL, legacy_id TEXT);

        CREATE TABLE leases (
          id TEXT PRIMARY KEY, resource TEXT NOT NULL, holder TEXT NOT NULL, task_id TEXT, run_id TEXT,
          status TEXT NOT NULL, acquired_at TEXT NOT NULL, heartbeat_at TEXT NOT NULL, expires_at TEXT NOT NULL,
          released_at TEXT, release_reason TEXT);
        CREATE UNIQUE INDEX idx_one_active_lease ON leases(resource) WHERE status IN ('active', 'retained');

        CREATE TABLE memory_items (
          id TEXT PRIMARY KEY, scope TEXT NOT NULL, scope_ref TEXT NOT NULL DEFAULT '', type TEXT NOT NULL,
          title TEXT NOT NULL, body TEXT NOT NULL, source_ref TEXT NOT NULL DEFAULT '', author TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1, supersedes_id TEXT, status TEXT NOT NULL DEFAULT 'active',
          retention_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE VIRTUAL TABLE memory_fts USING fts5(item_id UNINDEXED, title, body, tokenize = 'unicode61 remove_diacritics 2');

        CREATE TABLE skill_proposals (
          id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, from_version INTEGER NOT NULL, proposal_json TEXT NOT NULL,
          proposed_by TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, decided_at TEXT);

        CREATE TABLE leads (
          id TEXT PRIMARY KEY, company TEXT NOT NULL, domain TEXT NOT NULL DEFAULT '', normalized_key TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'new', source TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', evidence_json TEXT NOT NULL DEFAULT '[]',
          demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

        CREATE TABLE events (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, type TEXT NOT NULL, schema_version INTEGER NOT NULL DEFAULT 1,
          scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, project_id TEXT, source TEXT NOT NULL, run_id TEXT,
          payload_json TEXT NOT NULL, dedupe_key TEXT UNIQUE, created_at TEXT NOT NULL);
        CREATE INDEX idx_events_scope ON events(scope_type, scope_id, seq);

        CREATE TABLE import_batches (
          id TEXT PRIMARY KEY, source TEXT NOT NULL, source_sha256 TEXT NOT NULL, report_json TEXT NOT NULL,
          status TEXT NOT NULL, created_at TEXT NOT NULL, reverted_at TEXT);
        CREATE TABLE legacy_map (
          batch_id TEXT NOT NULL REFERENCES import_batches(id), legacy_table TEXT NOT NULL, legacy_id TEXT NOT NULL,
          v2_table TEXT NOT NULL, v2_id TEXT NOT NULL, PRIMARY KEY (legacy_table, legacy_id));
      `);
    },
  },
  {
    version: 2,
    name: "m01-company-runtime-surfaces",
    /**
     * Milestone 01: company runtime (company → departments → goals → objectives → missions → tasks),
     * execution surfaces and capability verifications, approval policies, schedules with native
     * references, computer environments, Agent Skills-compatible skill versions, routing decisions,
     * execution telemetry, the command log and the v2 event envelope. Additive only: no V1/V2 row is
     * deleted; old values are mapped in place (memory scopes, task dependencies).
     */
    up(db) {
      db.exec(`
        CREATE TABLE companies (
          id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, mission TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);

        CREATE TABLE departments (
          id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), key TEXT NOT NULL, name TEXT NOT NULL,
          purpose TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK (status IN ('active','planned','paused')),
          milestone_validated INTEGER NOT NULL DEFAULT 0, head_role_id TEXT, sort INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, UNIQUE (company_id, key));

        CREATE TABLE goals (
          id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), department_id TEXT REFERENCES departments(id),
          title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'DRAFT', status_reason TEXT NOT NULL DEFAULT '',
          priority INTEGER NOT NULL DEFAULT 2, owner_role_id TEXT NOT NULL DEFAULT '', due_at TEXT, success_metrics_json TEXT NOT NULL DEFAULT '[]',
          source TEXT NOT NULL DEFAULT 'user', created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
        CREATE INDEX idx_goals_status ON goals(company_id, status);

        CREATE TABLE objectives (
          id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id), department_id TEXT REFERENCES departments(id),
          title TEXT NOT NULL, key_result TEXT NOT NULL DEFAULT '', target_value REAL, current_value REAL, unit TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'OPEN', status_reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);

        CREATE TABLE manager_relationships (
          id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), manager_role_id TEXT NOT NULL, report_role_id TEXT NOT NULL,
          department_id TEXT REFERENCES departments(id), created_at TEXT NOT NULL, UNIQUE (company_id, report_role_id));

        CREATE TABLE task_dependencies (
          task_id TEXT NOT NULL REFERENCES tasks(id), depends_on_task_id TEXT NOT NULL REFERENCES tasks(id),
          kind TEXT NOT NULL DEFAULT 'finish_to_start', created_at TEXT NOT NULL, PRIMARY KEY (task_id, depends_on_task_id),
          CHECK (task_id <> depends_on_task_id));

        CREATE TABLE execution_surfaces (
          id TEXT PRIMARY KEY, provider TEXT NOT NULL, surface_type TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
          capabilities_json TEXT NOT NULL DEFAULT '[]', platform TEXT NOT NULL DEFAULT '', plan_requirement TEXT NOT NULL DEFAULT '',
          auth_mode TEXT NOT NULL DEFAULT '', billing_mode TEXT NOT NULL DEFAULT 'unknown',
          programmatic_control TEXT NOT NULL CHECK (programmatic_control IN ('PROGRAMMATIC','ASSISTED','NATIVE_INTERACTIVE','MIRROR','NONE')),
          location TEXT NOT NULL DEFAULT 'local', adapter TEXT NOT NULL DEFAULT 'none', availability TEXT NOT NULL DEFAULT 'unknown',
          availability_reason TEXT NOT NULL DEFAULT '', safety_constraints_json TEXT NOT NULL DEFAULT '[]', hub_decision TEXT NOT NULL DEFAULT '',
          operations_json TEXT NOT NULL DEFAULT '{}', evidence_json TEXT NOT NULL DEFAULT '{}', config_version INTEGER NOT NULL DEFAULT 1,
          verified_at TEXT, updated_at TEXT NOT NULL);

        CREATE TABLE capability_registry (
          id TEXT PRIMARY KEY, provider TEXT NOT NULL, feature TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'other', surface_id TEXT,
          status TEXT NOT NULL, hub_relevance TEXT NOT NULL DEFAULT 'LOW', hub_decision TEXT NOT NULL DEFAULT '', programmatic TEXT NOT NULL DEFAULT 'UNKNOWN',
          api_billing_risk TEXT NOT NULL DEFAULT 'unknown', subscription_included TEXT NOT NULL DEFAULT 'unknown',
          data_json TEXT NOT NULL, source_version TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
        CREATE INDEX idx_capability_provider ON capability_registry(provider, category);

        CREATE TABLE capability_verifications (
          id TEXT PRIMARY KEY, capability_id TEXT, surface_id TEXT, method TEXT NOT NULL, label TEXT NOT NULL
            CHECK (label IN ('PASS_LIVE','PASS_LOCAL','PASS_SIMULATED','FAIL','BLOCKED','NOT_RUN')),
          summary TEXT NOT NULL, evidence_json TEXT NOT NULL DEFAULT '{}', verified_by TEXT NOT NULL, verified_at TEXT NOT NULL);
        CREATE INDEX idx_capability_verifications ON capability_verifications(capability_id, verified_at);

        CREATE TABLE approval_policies (
          id TEXT PRIMARY KEY, action_kind TEXT NOT NULL, surface_id TEXT NOT NULL DEFAULT '*', project_id TEXT NOT NULL DEFAULT '*',
          policy TEXT NOT NULL CHECK (policy IN ('AUTO_ALLOWED','ASK_ONCE_FOR_TASK','ALWAYS_ASK','DENIED')),
          reason TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('default','user')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1, UNIQUE (action_kind, surface_id, project_id, source));

        CREATE TABLE task_approval_scopes (
          id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), action_kind TEXT NOT NULL, target TEXT NOT NULL, surface_id TEXT NOT NULL DEFAULT '*',
          approval_id TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active','revoked','expired')), granted_at TEXT NOT NULL,
          expires_at TEXT NOT NULL, revoked_at TEXT, uses INTEGER NOT NULL DEFAULT 0);
        CREATE UNIQUE INDEX idx_one_task_scope ON task_approval_scopes(task_id, action_kind, target, surface_id) WHERE status = 'active';

        CREATE TABLE integrations (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, source TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
          schema_json TEXT NOT NULL DEFAULT '{}', permissions_json TEXT NOT NULL DEFAULT '[]',
          side_effects TEXT NOT NULL CHECK (side_effects IN ('none','local','external','unknown')), scope TEXT NOT NULL DEFAULT 'global',
          permission_tier TEXT NOT NULL DEFAULT 'READ_ONLY', capability_id TEXT, owner_surface_id TEXT,
          status TEXT NOT NULL, status_reason TEXT NOT NULL DEFAULT '', data_json TEXT NOT NULL DEFAULT '{}', discovered_via TEXT NOT NULL DEFAULT 'config',
          discovered_at TEXT NOT NULL, updated_at TEXT NOT NULL);

        CREATE TABLE schedules (
          id TEXT PRIMARY KEY, intent_key TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
          cadence TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'Europe/Bucharest',
          backend TEXT NOT NULL CHECK (backend IN ('LOCAL_HUB','CLAUDE_NATIVE','OPENAI_NATIVE','OPENCLAW')),
          owner TEXT NOT NULL DEFAULT 'hub', department_id TEXT REFERENCES departments(id), action_json TEXT NOT NULL,
          uses_ai INTEGER NOT NULL DEFAULT 0, external_effects INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'DRAFT',
          status_reason TEXT NOT NULL DEFAULT '', next_run_at TEXT, last_run_at TEXT, last_result TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
        -- One owner per intent among live schedules; a RETIRED schedule releases its intent.
        CREATE UNIQUE INDEX idx_schedule_live_intent ON schedules(intent_key) WHERE status <> 'RETIRED';

        CREATE TABLE native_schedule_refs (
          id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL REFERENCES schedules(id), backend TEXT NOT NULL, native_id TEXT NOT NULL DEFAULT '',
          native_label TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'PROPOSED', state_reason TEXT NOT NULL DEFAULT '',
          last_seen_at TEXT, evidence_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
        CREATE UNIQUE INDEX idx_one_live_native_ref ON native_schedule_refs(schedule_id) WHERE state NOT IN ('DETACHED');

        CREATE TABLE schedule_runs (
          id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL REFERENCES schedules(id), slot TEXT NOT NULL, backend TEXT NOT NULL,
          status TEXT NOT NULL, result_json TEXT NOT NULL DEFAULT '{}', started_at TEXT NOT NULL, finished_at TEXT, UNIQUE (schedule_id, slot));

        CREATE TABLE computer_environments (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, provider TEXT NOT NULL, owner_surface_id TEXT,
          isolation TEXT NOT NULL, control_mode TEXT NOT NULL CHECK (control_mode IN ('structured_api','dom','visual')),
          status TEXT NOT NULL, status_reason TEXT NOT NULL DEFAULT '', use_cases_json TEXT NOT NULL DEFAULT '[]',
          safety_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL);

        CREATE TABLE skills (
          id TEXT PRIMARY KEY, current_version INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('active','draft','invalid','deprecated')),
          source TEXT NOT NULL, directory TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE skill_versions (
          skill_id TEXT NOT NULL REFERENCES skills(id), version INTEGER NOT NULL, sha256 TEXT NOT NULL, frontmatter_json TEXT NOT NULL,
          body TEXT NOT NULL, files_json TEXT NOT NULL DEFAULT '[]', validation_json TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL,
          created_at TEXT NOT NULL, PRIMARY KEY (skill_id, version), UNIQUE (skill_id, sha256));

        CREATE TABLE route_decisions (
          id TEXT PRIMARY KEY, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, task_type TEXT NOT NULL DEFAULT '',
          department_id TEXT, role_id TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
          surface_id TEXT, tools_json TEXT NOT NULL DEFAULT '[]', computer_env_id TEXT, execution_mode TEXT NOT NULL DEFAULT '',
          factors_json TEXT NOT NULL DEFAULT '[]', alternatives_json TEXT NOT NULL DEFAULT '[]', reason TEXT NOT NULL,
          manual_override INTEGER NOT NULL DEFAULT 0, override_by TEXT, status TEXT NOT NULL DEFAULT 'proposed', created_at TEXT NOT NULL);
        CREATE INDEX idx_route_subject ON route_decisions(subject_type, subject_id, created_at);

        CREATE TABLE execution_telemetry (
          id TEXT PRIMARY KEY, run_id TEXT UNIQUE, task_id TEXT, company_id TEXT, department_id TEXT, role_id TEXT NOT NULL DEFAULT '',
          task_type TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', surface_id TEXT,
          skill_versions_json TEXT NOT NULL DEFAULT '[]', started_at TEXT, finished_at TEXT, duration_ms INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
          interruptions INTEGER NOT NULL DEFAULT 0, tools_json TEXT NOT NULL DEFAULT '[]', tests_json TEXT NOT NULL DEFAULT '[]',
          findings_json TEXT NOT NULL DEFAULT '[]', human_interventions INTEGER NOT NULL DEFAULT 0, handoffs INTEGER NOT NULL DEFAULT 0,
          failure_category TEXT, verified_outcome TEXT NOT NULL DEFAULT 'unverified', usage_json TEXT NOT NULL DEFAULT '{}',
          sources_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX idx_telemetry_route ON execution_telemetry(task_type, surface_id);

        CREATE TABLE commands (
          id TEXT PRIMARY KEY, type TEXT NOT NULL, actor TEXT NOT NULL, channel TEXT NOT NULL, intent_text TEXT NOT NULL DEFAULT '',
          payload_json TEXT NOT NULL, status TEXT NOT NULL, policy_json TEXT NOT NULL DEFAULT '{}', route_decision_id TEXT,
          approval_id TEXT, result_json TEXT NOT NULL DEFAULT '{}', error TEXT, error_category TEXT, correlation_id TEXT NOT NULL,
          idempotency_key TEXT UNIQUE, created_at TEXT NOT NULL, finished_at TEXT);
        CREATE INDEX idx_commands_created ON commands(created_at);

        CREATE TABLE native_sessions (
          id TEXT PRIMARY KEY, provider TEXT NOT NULL, surface_id TEXT NOT NULL, native_session_id TEXT NOT NULL, project_id TEXT,
          name TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, pid INTEGER, started_at TEXT,
          first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, observed_via TEXT NOT NULL, UNIQUE (provider, native_session_id));

        ALTER TABLE clients ADD COLUMN company_id TEXT;
        ALTER TABLE clients ADD COLUMN domain TEXT NOT NULL DEFAULT '';
        ALTER TABLE clients ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
        ALTER TABLE missions ADD COLUMN company_id TEXT;
        ALTER TABLE missions ADD COLUMN department_id TEXT;
        ALTER TABLE missions ADD COLUMN goal_id TEXT;
        ALTER TABLE missions ADD COLUMN objective_id TEXT;
        ALTER TABLE missions ADD COLUMN client_id TEXT;
        ALTER TABLE tasks ADD COLUMN department_id TEXT;
        ALTER TABLE tasks ADD COLUMN task_type TEXT NOT NULL DEFAULT '';
        ALTER TABLE tasks ADD COLUMN route_decision_id TEXT;
        ALTER TABLE agent_roles ADD COLUMN department_id TEXT;
        ALTER TABLE agent_runs ADD COLUMN surface_id TEXT;
        ALTER TABLE agent_runs ADD COLUMN department_id TEXT;
        ALTER TABLE agent_runs ADD COLUMN route_decision_id TEXT;
        ALTER TABLE agent_runs ADD COLUMN correlation_id TEXT;
        ALTER TABLE agent_runs ADD COLUMN skill_versions_json TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE provider_sessions ADD COLUMN surface_id TEXT;
        ALTER TABLE handoffs ADD COLUMN from_surface TEXT;
        ALTER TABLE handoffs ADD COLUMN to_surface TEXT;
        ALTER TABLE checkpoints ADD COLUMN label TEXT NOT NULL DEFAULT '';
        ALTER TABLE checkpoints ADD COLUMN hub_state_json TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE checkpoints ADD COLUMN native_refs_json TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE checkpoints ADD COLUMN next_action TEXT NOT NULL DEFAULT '';
        ALTER TABLE checkpoints ADD COLUMN created_by TEXT NOT NULL DEFAULT 'hub';
        ALTER TABLE artifacts ADD COLUMN mission_id TEXT;
        ALTER TABLE artifacts ADD COLUMN source TEXT NOT NULL DEFAULT 'hub';
        ALTER TABLE artifacts ADD COLUMN surface_id TEXT;
        ALTER TABLE artifacts ADD COLUMN native_ref TEXT NOT NULL DEFAULT '';
        ALTER TABLE artifacts ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE artifacts ADD COLUMN owner TEXT NOT NULL DEFAULT '';
        ALTER TABLE artifacts ADD COLUMN title TEXT NOT NULL DEFAULT '';
        ALTER TABLE memory_items ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'hub';
        ALTER TABLE memory_items ADD COLUMN sync_direction TEXT NOT NULL DEFAULT 'none';
        ALTER TABLE events ADD COLUMN company_id TEXT;
        ALTER TABLE events ADD COLUMN department_id TEXT;
        ALTER TABLE events ADD COLUMN mission_id TEXT;
        ALTER TABLE events ADD COLUMN task_id TEXT;
        ALTER TABLE events ADD COLUMN correlation_id TEXT;
        ALTER TABLE events ADD COLUMN raw_ref TEXT;
        CREATE INDEX idx_events_correlation ON events(correlation_id) WHERE correlation_id IS NOT NULL;
        CREATE INDEX idx_events_task ON events(task_id, seq) WHERE task_id IS NOT NULL;
      `);

      // Task dependencies: the JSON column stays as a compatibility copy; the table is authoritative.
      const now = new Date().toISOString();
      const insertDep = db.prepare("INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id, created_at) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM tasks WHERE id = ?)");
      for (const row of db.prepare("SELECT id, depends_on_json FROM tasks").all()) {
        let deps = [];
        try { deps = JSON.parse(row.depends_on_json || "[]"); } catch { deps = []; }
        for (const dep of Array.isArray(deps) ? deps : []) if (typeof dep === "string" && dep && dep !== row.id) insertDep.run(row.id, dep, now, dep);
      }

      // Memory scopes: V2.0 lowercase scopes → Milestone 01 scopes (history kept, only the label changes).
      const scopeMap = { general: "GLOBAL", company: "COMPANY", client: "CLIENT", project: "PROJECT", task: "TASK", decision: "GLOBAL", procedure: "GLOBAL" };
      for (const [from, to] of Object.entries(scopeMap)) db.prepare("UPDATE memory_items SET scope = ? WHERE scope = ?").run(to, from);
    },
  },
  {
    version: 3,
    name: "m03-runtime-readiness-software-factory",
    /**
     * Milestone 03. Runs: the phase timeline (where the time goes) and the resolved model/effort plan (what was sent and
     * why). Software Factory: the missing concepts only (versioned specification, workspace snapshots, change sets,
     * reviews and findings, verification evidence, durable dispatch requests, delivery bundles) around the EXISTING
     * missions/tasks/runs/grants/approvals; a factory mission is a mission with one extra row. Additive only.
     */
    up(db) {
      db.exec(`
        ALTER TABLE agent_runs ADD COLUMN timeline_json TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE agent_runs ADD COLUMN plan_json TEXT NOT NULL DEFAULT '{}';

        CREATE TABLE factory_missions (
          mission_id TEXT PRIMARY KEY REFERENCES missions(id), work_type TEXT NOT NULL, stage TEXT NOT NULL,
          wait_reason TEXT NOT NULL DEFAULT '', stage_reason TEXT NOT NULL DEFAULT '', profile TEXT NOT NULL DEFAULT 'BALANCED',
          limits_json TEXT NOT NULL, plan_json TEXT NOT NULL DEFAULT '{}', repair_cycles INTEGER NOT NULL DEFAULT 0, approved_spec_version INTEGER, scope_hash TEXT,
          scope_approval_id TEXT, base_snapshot_id TEXT, review_conversation_id TEXT, cancel_requested_at TEXT,
          started_at TEXT, deadline_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);

        CREATE TABLE factory_specs (
          id TEXT PRIMARY KEY, mission_id TEXT NOT NULL REFERENCES missions(id), version INTEGER NOT NULL, status TEXT NOT NULL,
          spec_json TEXT NOT NULL, sha256 TEXT NOT NULL, protected_json TEXT NOT NULL DEFAULT '{}', author TEXT NOT NULL,
          created_at TEXT NOT NULL, approved_at TEXT, UNIQUE (mission_id, version));

        CREATE TABLE factory_snapshots (
          id TEXT PRIMARY KEY, mission_id TEXT NOT NULL REFERENCES missions(id), seq INTEGER NOT NULL, kind TEXT NOT NULL,
          run_id TEXT, manifest_json TEXT NOT NULL, stats_json TEXT NOT NULL DEFAULT '{}', git_json TEXT NOT NULL DEFAULT '{}',
          sha256 TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (mission_id, seq));

        CREATE TABLE factory_change_sets (
          id TEXT PRIMARY KEY, mission_id TEXT NOT NULL REFERENCES missions(id), seq INTEGER NOT NULL, snapshot_id TEXT NOT NULL,
          previous_id TEXT, run_id TEXT, task_id TEXT, changes_json TEXT NOT NULL, delta_json TEXT NOT NULL DEFAULT '[]',
          diff_text TEXT NOT NULL DEFAULT '', diff_truncated INTEGER NOT NULL DEFAULT 0, integrity_json TEXT NOT NULL DEFAULT '{}',
          sha256 TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (mission_id, seq));

        CREATE TABLE factory_reviews (
          id TEXT PRIMARY KEY, mission_id TEXT NOT NULL REFERENCES missions(id), change_set_id TEXT NOT NULL, change_set_sha TEXT NOT NULL,
          run_id TEXT, reviewer TEXT NOT NULL, verdict TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', missing_json TEXT NOT NULL DEFAULT '[]',
          validation_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL, created_at TEXT NOT NULL);

        CREATE TABLE factory_findings (
          id TEXT PRIMARY KEY, mission_id TEXT NOT NULL REFERENCES missions(id), code TEXT NOT NULL, source TEXT NOT NULL,
          review_id TEXT, evidence_id TEXT, change_set_id TEXT NOT NULL, severity TEXT NOT NULL, file TEXT NOT NULL DEFAULT '',
          area TEXT NOT NULL DEFAULT '', observation TEXT NOT NULL, impact TEXT NOT NULL DEFAULT '', evidence TEXT NOT NULL DEFAULT '',
          reproduction TEXT NOT NULL DEFAULT '', fingerprint TEXT NOT NULL, status TEXT NOT NULL, resolution_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX idx_factory_findings_mission ON factory_findings(mission_id, status);

        CREATE TABLE factory_evidence (
          id TEXT PRIMARY KEY, mission_id TEXT NOT NULL REFERENCES missions(id), change_set_id TEXT NOT NULL, stage TEXT NOT NULL,
          kind TEXT NOT NULL, command TEXT NOT NULL, runner TEXT NOT NULL, isolation TEXT NOT NULL, status TEXT NOT NULL,
          exit_code INTEGER, counts_json TEXT NOT NULL DEFAULT '{}', duration_ms INTEGER, output_tail TEXT NOT NULL DEFAULT '',
          detail_json TEXT NOT NULL DEFAULT '{}', stale INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);

        CREATE TABLE factory_dispatches (
          id TEXT PRIMARY KEY, mission_id TEXT NOT NULL REFERENCES missions(id), stage TEXT NOT NULL, task_id TEXT,
          idempotency_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL, request_json TEXT NOT NULL, run_id TEXT, claim_token TEXT,
          error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX idx_factory_dispatches_mission ON factory_dispatches(mission_id, created_at);

        CREATE TABLE factory_bundles (
          id TEXT PRIMARY KEY, mission_id TEXT NOT NULL REFERENCES missions(id), change_set_id TEXT NOT NULL, change_set_sha TEXT NOT NULL,
          spec_version INTEGER NOT NULL, manifest_json TEXT NOT NULL, sha256 TEXT NOT NULL, status TEXT NOT NULL, file_path TEXT NOT NULL DEFAULT '',
          decided_at TEXT, decision_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
      `);
    },
  },
  {
    version: 4,
    name: "m04-sales-lead-generation",
    /**
     * Milestone 04. Sales & Lead Generation around the existing control plane (commands, approvals, events, scheduler):
     * prospect organizations with provenance, import batches with per-row results (idempotent, resumable, reversible),
     * evidence with labels, website audits, explainable qualification, opportunities, versioned proposals and contact
     * drafts (DRAFT_ONLY: the real transport is disabled), manual contact/acceptance records, follow-ups, suppression and the
     * hand-off to a Software Factory draft. The M01 `leads` registry is left untouched. Additive only.
     */
    up(db) {
      db.exec(`
        CREATE TABLE sales_import_batches (
          id TEXT PRIMARY KEY, file_name TEXT NOT NULL, file_sha256 TEXT NOT NULL, file_kind TEXT NOT NULL, size_bytes INTEGER NOT NULL,
          encoding TEXT NOT NULL DEFAULT '', delimiter TEXT NOT NULL DEFAULT '', sheet TEXT NOT NULL DEFAULT '', sheets_json TEXT NOT NULL DEFAULT '[]',
          headers_json TEXT NOT NULL DEFAULT '[]', suggested_json TEXT NOT NULL DEFAULT '{}', mapping_json TEXT NOT NULL DEFAULT '{}', mapping_hash TEXT NOT NULL DEFAULT '',
          warnings_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL, synthetic INTEGER NOT NULL DEFAULT 0, row_count INTEGER NOT NULL DEFAULT 0,
          counts_json TEXT NOT NULL DEFAULT '{}', stored_path TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL, imported_at TEXT, rolled_back_at TEXT);
        CREATE INDEX idx_sales_batches_file ON sales_import_batches(file_sha256);

        CREATE TABLE sales_import_rows (
          id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES sales_import_batches(id), row_index INTEGER NOT NULL, raw_json TEXT NOT NULL,
          normalized_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL, org_id TEXT, errors_json TEXT NOT NULL DEFAULT '[]',
          warnings_json TEXT NOT NULL DEFAULT '[]', match_json TEXT NOT NULL DEFAULT '[]', resolution_json TEXT NOT NULL DEFAULT '{}',
          processed_at TEXT, UNIQUE(batch_id, row_index));
        CREATE INDEX idx_sales_rows_status ON sales_import_rows(batch_id, status);
        CREATE INDEX idx_sales_rows_org ON sales_import_rows(org_id);

        CREATE TABLE sales_orgs (
          id TEXT PRIMARY KEY, display_name TEXT NOT NULL, normalized_name TEXT NOT NULL, legal_form TEXT NOT NULL DEFAULT '',
          fiscal_code TEXT NOT NULL DEFAULT '', fiscal_code_valid INTEGER, website TEXT NOT NULL DEFAULT '', domain TEXT NOT NULL DEFAULT '',
          domain_kind TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', county TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
          caen TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, synthetic INTEGER NOT NULL DEFAULT 0, created_batch_id TEXT, created_row_id TEXT,
          version INTEGER NOT NULL DEFAULT 1, edited_after_import INTEGER NOT NULL DEFAULT 0, merged_into TEXT, archived_at TEXT, archive_reason TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX idx_sales_orgs_fiscal ON sales_orgs(fiscal_code);
        CREATE INDEX idx_sales_orgs_domain ON sales_orgs(domain);
        CREATE INDEX idx_sales_orgs_name ON sales_orgs(normalized_name);
        CREATE INDEX idx_sales_orgs_status ON sales_orgs(status, updated_at);
        CREATE INDEX idx_sales_orgs_batch ON sales_orgs(created_batch_id);
        CREATE INDEX idx_sales_orgs_merged ON sales_orgs(merged_into);

        CREATE TABLE sales_org_aliases (
          id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES sales_orgs(id), name TEXT NOT NULL, normalized TEXT NOT NULL,
          source TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(org_id, normalized));

        CREATE TABLE sales_contacts (
          id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES sales_orgs(id), kind TEXT NOT NULL, value TEXT NOT NULL, raw TEXT NOT NULL DEFAULT '',
          generic INTEGER NOT NULL DEFAULT 0, person_name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT '', evidence_id TEXT,
          warnings_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT NOT NULL, UNIQUE(org_id, kind, value));

        CREATE TABLE sales_evidence (
          id TEXT PRIMARY KEY, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, subject_version INTEGER NOT NULL DEFAULT 1,
          claim TEXT NOT NULL, value_json TEXT NOT NULL DEFAULT 'null', label TEXT NOT NULL, source_kind TEXT NOT NULL, source_ref TEXT NOT NULL,
          retrieved_at TEXT, excerpt TEXT NOT NULL DEFAULT '', method TEXT NOT NULL DEFAULT '', verified_at TEXT, recheck_after TEXT,
          contradicts_json TEXT NOT NULL DEFAULT '[]', synthetic INTEGER NOT NULL DEFAULT 0, batch_id TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE INDEX idx_sales_evidence_subject ON sales_evidence(subject_type, subject_id);
        CREATE INDEX idx_sales_evidence_batch ON sales_evidence(batch_id);

        CREATE TABLE sales_merges (
          id TEXT PRIMARY KEY, survivor_id TEXT NOT NULL, merged_id TEXT NOT NULL, reason TEXT NOT NULL, before_json TEXT NOT NULL,
          actor TEXT NOT NULL, created_at TEXT NOT NULL, reverted_at TEXT, reverted_by TEXT);

        CREATE TABLE sales_audits (
          id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES sales_orgs(id), url TEXT NOT NULL, source_kind TEXT NOT NULL, fetched_at TEXT,
          version TEXT NOT NULL, result_json TEXT NOT NULL, opportunities_json TEXT NOT NULL DEFAULT '[]', synthetic INTEGER NOT NULL DEFAULT 0,
          created_by TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE INDEX idx_sales_audits_org ON sales_audits(org_id, created_at);

        CREATE TABLE sales_qualifications (
          id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES sales_orgs(id), formula_version TEXT NOT NULL, result_json TEXT NOT NULL,
          priority REAL, override_json TEXT NOT NULL DEFAULT 'null', inputs_sha TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE INDEX idx_sales_qual_org ON sales_qualifications(org_id, created_at);

        CREATE TABLE sales_services (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', scope_json TEXT NOT NULL DEFAULT '[]',
          exclusions_json TEXT NOT NULL DEFAULT '[]', tags_json TEXT NOT NULL DEFAULT '[]', price_json TEXT NOT NULL DEFAULT '{"status":"NOT_CONFIGURED"}',
          lead_time_json TEXT NOT NULL DEFAULT '{"status":"NOT_CONFIGURED"}', materials_json TEXT NOT NULL DEFAULT '[]', synthetic INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

        CREATE TABLE sales_opportunities (
          id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES sales_orgs(id), title TEXT NOT NULL, need TEXT NOT NULL DEFAULT '',
          service_id TEXT, status TEXT NOT NULL, owner TEXT NOT NULL DEFAULT 'proprietar', next_action TEXT NOT NULL DEFAULT '', next_action_at TEXT,
          evidence_json TEXT NOT NULL DEFAULT '[]', synthetic INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
          created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX idx_sales_opp_org ON sales_opportunities(org_id);
        CREATE INDEX idx_sales_opp_status ON sales_opportunities(status, updated_at);

        CREATE TABLE sales_transitions (
          id TEXT PRIMARY KEY, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL,
          actor TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', evidence_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL);
        CREATE INDEX idx_sales_transitions_subject ON sales_transitions(subject_type, subject_id, created_at);

        CREATE TABLE sales_proposals (
          id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL REFERENCES sales_opportunities(id), version INTEGER NOT NULL,
          content_json TEXT NOT NULL, content_sha TEXT NOT NULL, status TEXT NOT NULL, approval_id TEXT, approved_sha TEXT,
          approved_at TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(opportunity_id, version));

        CREATE TABLE sales_drafts (
          id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL REFERENCES sales_opportunities(id), org_id TEXT NOT NULL, contact_id TEXT,
          proposal_id TEXT, version INTEGER NOT NULL, channel TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
          recipients_json TEXT NOT NULL DEFAULT '[]', meta_json TEXT NOT NULL DEFAULT '{}', content_sha TEXT NOT NULL, status TEXT NOT NULL,
          approval_id TEXT, approved_sha TEXT, approved_at TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          UNIQUE(opportunity_id, version));

        CREATE TABLE sales_sends (
          id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES sales_drafts(id), idempotency_key TEXT NOT NULL UNIQUE, transport TEXT NOT NULL,
          status TEXT NOT NULL, detail_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        -- One open send per draft: two clicks with different keys can never deliver the same draft twice.
        CREATE UNIQUE INDEX ux_sales_sends_open ON sales_sends(draft_id) WHERE status IN ('ATTEMPTED','DELIVERED');

        CREATE TABLE sales_contact_events (
          id TEXT PRIMARY KEY, org_id TEXT NOT NULL, opportunity_id TEXT, kind TEXT NOT NULL, occurred_at TEXT NOT NULL, channel TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '', evidence_json TEXT NOT NULL DEFAULT '{}', send_id TEXT, actor TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE INDEX idx_sales_contact_events ON sales_contact_events(org_id, occurred_at);

        CREATE TABLE sales_client_acceptances (
          id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL REFERENCES sales_opportunities(id), proposal_id TEXT NOT NULL, proposal_sha TEXT NOT NULL,
          accepted_at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', recorded_by TEXT NOT NULL, created_at TEXT NOT NULL);

        CREATE TABLE sales_followups (
          id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL REFERENCES sales_opportunities(id), org_id TEXT NOT NULL, due_at TEXT NOT NULL,
          basis TEXT NOT NULL, basis_ref TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', draft_id TEXT,
          expires_at TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(opportunity_id, due_at));
        CREATE INDEX idx_sales_followups_due ON sales_followups(status, due_at);

        CREATE TABLE sales_suppressions (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, value TEXT NOT NULL, org_id TEXT, reason TEXT NOT NULL, source TEXT NOT NULL,
          actor TEXT NOT NULL, created_at TEXT NOT NULL, lifted_at TEXT, lifted_by TEXT, lift_reason TEXT);
        CREATE INDEX idx_sales_suppressions ON sales_suppressions(kind, value);

        CREATE TABLE sales_handoffs (
          id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL REFERENCES sales_opportunities(id), proposal_id TEXT NOT NULL, proposal_sha TEXT NOT NULL,
          acceptance_id TEXT NOT NULL, package_json TEXT NOT NULL, package_sha TEXT NOT NULL, mission_id TEXT, status TEXT NOT NULL,
          created_by TEXT NOT NULL, created_at TEXT NOT NULL);
      `);
    },
  },
  {
    version: 5,
    name: "m05-execution-environments",
    /**
     * Milestone 05. Execution environments (wsl-runner): the environment each run used, the attestations (canary C1–C17
     * bound to a fingerprint) and the per-run workspaces in the environment (transfer, export, validation, apply). The
     * project route choice and the owner's policy approval live in settings. Additive only.
     */
    up(db) {
      db.exec(`
        ALTER TABLE agent_runs ADD COLUMN environment TEXT NOT NULL DEFAULT 'windows';

        CREATE TABLE environment_attestations (
          id TEXT PRIMARY KEY, environment_id TEXT NOT NULL, status TEXT NOT NULL, fingerprint_hash TEXT NOT NULL, fingerprint_json TEXT NOT NULL,
          canary_version TEXT NOT NULL, checks_json TEXT NOT NULL, stages_json TEXT NOT NULL DEFAULT '[]', summary TEXT NOT NULL DEFAULT '',
          actor TEXT NOT NULL, channel TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, created_at TEXT NOT NULL);
        CREATE INDEX idx_environment_attestations ON environment_attestations(environment_id, started_at);

        CREATE TABLE environment_workspaces (
          id TEXT PRIMARY KEY, environment_id TEXT NOT NULL, run_id TEXT, project_id TEXT NOT NULL DEFAULT '', purpose TEXT NOT NULL,
          linux_path TEXT NOT NULL, fingerprint_hash TEXT NOT NULL DEFAULT '', stats_json TEXT NOT NULL DEFAULT '{}', export_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX idx_environment_workspaces ON environment_workspaces(environment_id, created_at);
      `);
    },
  },
  {
    version: 6,
    name: "m06-owner-session-envelopes",
    /**
     * Milestone 06. The owner's trusted session (WebAuthn credentials, single-use challenges, sessions stored by token hash),
     * Mission Authorization Envelopes (one consumable confirmation per exact plan, grants derived from it), the owner's last
     * visit per project (delta briefing) and the local voice-profile metadata (the profile vectors live in a separate file in
     * the private data folder; no audio, no embedding and no score is kept in these tables). Additive only: approvals and
     * audit rows written before M06 are never rewritten.
     */
    up(db) {
      db.exec(`
        CREATE TABLE owner_credentials (
          id TEXT PRIMARY KEY, label TEXT NOT NULL, public_key_jwk TEXT NOT NULL, alg INTEGER NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0,
          aaguid TEXT NOT NULL DEFAULT '', transports_json TEXT NOT NULL DEFAULT '[]', uv_initialized INTEGER NOT NULL DEFAULT 0, backup_eligible INTEGER NOT NULL DEFAULT 0,
          attestation_fmt TEXT NOT NULL DEFAULT 'none', rp_id TEXT NOT NULL, origin TEXT NOT NULL, status TEXT NOT NULL,
          created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT);

        CREATE TABLE owner_challenges (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, challenge TEXT NOT NULL UNIQUE, purpose TEXT NOT NULL, origin TEXT NOT NULL,
          expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL);

        CREATE TABLE owner_sessions (
          id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, credential_id TEXT NOT NULL, origin TEXT NOT NULL, policy_version INTEGER NOT NULL,
          user_verified INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL,
          reauth_at TEXT NOT NULL, revoked_at TEXT, revoke_reason TEXT, user_agent TEXT NOT NULL DEFAULT '');
        CREATE INDEX idx_owner_sessions_status ON owner_sessions(status, expires_at);

        CREATE TABLE mission_envelopes (
          id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL, project_id TEXT NOT NULL, mission_ids_json TEXT NOT NULL, plan_hash TEXT NOT NULL,
          envelope_hash TEXT NOT NULL, body_json TEXT NOT NULL, summary_json TEXT NOT NULL, autonomy_level TEXT NOT NULL, status TEXT NOT NULL,
          nonce TEXT NOT NULL UNIQUE, proposed_by TEXT NOT NULL, proposed_via TEXT NOT NULL, owner_session_id TEXT, consent_json TEXT NOT NULL DEFAULT '{}',
          derived_json TEXT NOT NULL DEFAULT '{}', current_mission_id TEXT, issued_at TEXT NOT NULL, confirm_by TEXT NOT NULL, expires_at TEXT NOT NULL,
          confirmed_at TEXT, closed_at TEXT, close_reason TEXT, idempotency_key TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
        CREATE INDEX idx_mission_envelopes_project ON mission_envelopes(project_id, created_at);
        -- At most one authority in force per project (a second tab, a double "yes" or a reconnect cannot confirm two).
        CREATE UNIQUE INDEX ux_mission_envelopes_active ON mission_envelopes(project_id) WHERE status IN ('CONFIRMED', 'ACTIVE', 'WAITING_OWNER');

        ALTER TABLE live_grants ADD COLUMN envelope_id TEXT;

        CREATE TABLE owner_visits (project_id TEXT PRIMARY KEY, last_seen_at TEXT NOT NULL, last_seq INTEGER NOT NULL DEFAULT 0);

        -- Shadow Mode: a second, read-only reviewer on the same change set; its output is a proposal, never an input of the
        -- mission (the conductor does not read this table).
        CREATE TABLE shadow_evaluations (
          id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, change_set_id TEXT NOT NULL, change_set_sha TEXT NOT NULL, primary_review_id TEXT,
          run_id TEXT, conversation_id TEXT, provider TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, verdict TEXT,
          findings_json TEXT NOT NULL DEFAULT '[]', metrics_json TEXT NOT NULL DEFAULT '{}', requested_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX idx_shadow_evaluations_mission ON shadow_evaluations(mission_id, created_at);

        CREATE TABLE voice_profiles (
          id TEXT PRIMARY KEY, version INTEGER NOT NULL, verifier TEXT NOT NULL, status TEXT NOT NULL, samples INTEGER NOT NULL,
          quality_json TEXT NOT NULL DEFAULT '{}', calibration_json TEXT NOT NULL DEFAULT '{}', file_ref TEXT NOT NULL, consent_version INTEGER NOT NULL,
          created_at TEXT NOT NULL, revoked_at TEXT);
      `);
    },
  },
  {
    version: 7,
    name: "m07-voice-utterances",
    /**
     * Milestone 07. One row per speech segment the owner's authenticated page sent to the Hub (the voice gate before the cloud
     * route, a spoken confirmation, the post-enrolment check). The Hub itself decided the speaker (local model) and, for the
     * owner's matched speech only, transcribed it locally: the row is the server-held evidence a voice confirmation must point
     * to (a client can no longer claim "local"). The audio is never stored — only its SHA-256. A confirmation consumes its row
     * once (consumed_at), inside the same transaction that confirms the plan.
     */
    up(db) {
      db.exec(`
        CREATE TABLE voice_utterances (
          id TEXT PRIMARY KEY, owner_session_id TEXT NOT NULL, purpose TEXT NOT NULL, lega_session_id TEXT, envelope_id TEXT,
          duration_ms INTEGER NOT NULL, speech_ms INTEGER NOT NULL DEFAULT 0, snr_db REAL, sample_rate INTEGER NOT NULL, audio_sha256 TEXT NOT NULL,
          speaker_result TEXT NOT NULL, speaker_reason TEXT NOT NULL DEFAULT '', verifier TEXT NOT NULL, profile_id TEXT, profile_version INTEGER,
          flags_json TEXT NOT NULL DEFAULT '[]', transcript TEXT, transcript_status TEXT NOT NULL DEFAULT 'none', stt_engine TEXT, stt_ms INTEGER, sv_ms INTEGER,
          consumed_by TEXT, consumed_at TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX idx_voice_utterances_session ON voice_utterances(owner_session_id, created_at);
        CREATE INDEX idx_voice_utterances_lega ON voice_utterances(lega_session_id, created_at);
      `);
    },
  },
  {
    version: 8,
    name: "m08-intel",
    /**
     * Milestone 08 (project autopilot & company intelligence). Additive only; every table hangs off the existing model:
     * - twin_claims: relations the owner or the Hub RECORDED (an observation with a source, a declaration, or a hypothesis). The
     *   rest of the Digital Twin is derived on read from projects, missions, change sets, decisions and events, never copied.
     * - incidents / incident_entries: the War Room (the confirmed impact is a separate field from the recommended priority; every
     *   signal, hypothesis and action keeps its source and its status).
     * - autopilot_objectives: Project Autopilot (a finite objective, its validated task graph and the envelope that covers it).
     * - board_meetings / board_items: minutes and decisions of the executive meeting (proposed / decided / deferred).
     * - simulations: what-if scenarios (always simulated; never mixed into real metrics).
     * - skill_candidates: Skill Evolution (proposal, diff, evaluation, approval, limited activation, rollback).
     * - lessons: Teach Lega (the owner's own instructions; a confirmed lesson becomes a memory item).
     * - devices / device_pairings / device_commands: Personal Mission Control (own pairing, revocable, idempotent commands).
     * - decision_packages: the owner's contextual decisions (storage and voice protection, the real pilot), option by option.
     */
    up(db) {
      db.exec(`
        CREATE TABLE twin_claims (
          id TEXT PRIMARY KEY, project_id TEXT, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, predicate TEXT NOT NULL,
          object_type TEXT NOT NULL, object_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('OBSERVED','DECLARED','HYPOTHESIS')),
          status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','confirmed','refuted','retracted')),
          source_kind TEXT NOT NULL, source_ref TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', author TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX idx_twin_claims_project ON twin_claims(project_id, created_at);

        CREATE TABLE incidents (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, reported_text TEXT NOT NULL DEFAULT '',
          reported_by TEXT NOT NULL, report_source TEXT NOT NULL, priority_recommended TEXT, impact_confirmed_json TEXT,
          responsible TEXT NOT NULL DEFAULT 'proprietar', version_ref_json TEXT NOT NULL DEFAULT '{}', components_json TEXT NOT NULL DEFAULT '[]',
          recent_changes_json TEXT NOT NULL DEFAULT '[]', remediation_mission_id TEXT, version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT);
        CREATE INDEX idx_incidents_project ON incidents(project_id, status, created_at);
        CREATE TABLE incident_entries (
          id TEXT PRIMARY KEY, incident_id TEXT NOT NULL REFERENCES incidents(id),
          kind TEXT NOT NULL CHECK (kind IN ('signal','hypothesis','action','evidence','note','timeline')),
          status TEXT NOT NULL DEFAULT 'UNCONFIRMED', text TEXT NOT NULL, source_kind TEXT NOT NULL, source_ref TEXT NOT NULL DEFAULT '',
          actor TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX idx_incident_entries ON incident_entries(incident_id, created_at);

        CREATE TABLE autopilot_objectives (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, plan_json TEXT NOT NULL, plan_hash TEXT NOT NULL,
          criteria_json TEXT NOT NULL DEFAULT '[]', limits_json TEXT NOT NULL DEFAULT '{}', base_snapshot_json TEXT NOT NULL DEFAULT '{}',
          envelope_id TEXT, created_by TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX idx_autopilot_objectives_project ON autopilot_objectives(project_id, created_at);

        CREATE TABLE board_meetings (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, period_from TEXT NOT NULL, period_to TEXT NOT NULL, status TEXT NOT NULL,
          agenda_json TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0, minutes_json TEXT NOT NULL DEFAULT '[]', opened_by TEXT NOT NULL,
          created_at TEXT NOT NULL, closed_at TEXT, version INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE board_items (
          id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES board_meetings(id), position INTEGER NOT NULL, section TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('info','recommendation','decision','proposal')), title TEXT NOT NULL, body_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'PRESENTED', decided_by TEXT, decision_note TEXT NOT NULL DEFAULT '', decided_at TEXT,
          carried_from TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
        CREATE INDEX idx_board_items_meeting ON board_items(meeting_id, position);

        CREATE TABLE simulations (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, model_version TEXT NOT NULL, inputs_json TEXT NOT NULL, result_json TEXT NOT NULL,
          status TEXT NOT NULL, created_by TEXT NOT NULL, proposal_ref TEXT, created_at TEXT NOT NULL);

        CREATE TABLE skill_candidates (
          id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, base_version INTEGER NOT NULL, candidate_version INTEGER, reason TEXT NOT NULL,
          evidence_json TEXT NOT NULL DEFAULT '[]', body TEXT NOT NULL, diff_json TEXT NOT NULL DEFAULT '[]', regression_cases_json TEXT NOT NULL DEFAULT '[]',
          eval_json TEXT, status TEXT NOT NULL, activation_json TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL, decided_by TEXT,
          version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX idx_skill_candidates_skill ON skill_candidates(skill_id, status);

        CREATE TABLE lessons (
          id TEXT PRIMARY KEY, text TEXT NOT NULL, kind TEXT NOT NULL, scope TEXT NOT NULL, scope_ref TEXT NOT NULL DEFAULT '',
          parsed_json TEXT NOT NULL, security_json TEXT NOT NULL DEFAULT '[]', provenance TEXT NOT NULL, status TEXT NOT NULL,
          memory_item_id TEXT, supersedes_id TEXT, proposed_by TEXT NOT NULL, decided_by TEXT, version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL, decided_at TEXT);

        CREATE TABLE devices (
          id TEXT PRIMARY KEY, label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, permissions_json TEXT NOT NULL, paired_by TEXT NOT NULL,
          created_at TEXT NOT NULL, last_seen_at TEXT, revoked_at TEXT, revoked_by TEXT);
        CREATE TABLE device_pairings (
          id TEXT PRIMARY KEY, code_hash TEXT NOT NULL, created_by TEXT NOT NULL, expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
          consumed_at TEXT, device_id TEXT, created_at TEXT NOT NULL);
        CREATE TABLE device_commands (
          idempotency_key TEXT PRIMARY KEY, device_id TEXT NOT NULL, type TEXT NOT NULL, result_json TEXT, created_at TEXT NOT NULL);

        CREATE TABLE decision_packages (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, body_json TEXT NOT NULL, options_json TEXT NOT NULL, hash TEXT NOT NULL,
          status TEXT NOT NULL, decisions_json TEXT NOT NULL DEFAULT '{}', decided_by TEXT, created_at TEXT NOT NULL, decided_at TEXT,
          version INTEGER NOT NULL DEFAULT 1);
      `);
    },
  },
  {
    version: 9,
    name: "m09-media-growth",
    /**
     * Milestone 09. Additive only.
     * A — core corrections:
     * - factory_missions.bindings_json: the model/effort binding of every role, fixed when the scope is approved (the value the
     *   owner saw is the value dispatched; no silent account default).
     * - live_grants.binding_json: a grant derived from an envelope names the binding it may serve.
     * - agent_runs.prompt_sha256 / prompt_chars / skill_context_json + run_skill_usage: what a run actually received (skill bodies
     *   injected by the composer, pinned version and body hash).
     * B — the Content / Media / Growth department. Metadata only: media files live under config.mediaDir (relative paths here),
     *   never in the database. Production states are separate from distribution states, which are separate from outcomes.
     * - media_assets / media_asset_versions / media_rights: the library (originals are immutable; derivatives link to their inputs;
     *   origin is separate from the effective rights for a scope).
     * - media_transcripts: local transcription of MEDIA (never owner voice evidence; no session, speaker or envelope columns).
     * - content_ideas / content_projects / content_briefs / content_claims / content_scripts / content_storyboards: the editorial
     *   chain (claim → evidence → shot); readiness NO_GO / NEEDS_CAPTURE.
     * - media_edit_projects / media_edit_versions: EditProjectIR versions (patches, variants and manual divergences are versions).
     * - media_render_jobs / media_render_cache: durable render queue (atomic claim, interrupted on boot, never resumed alone) and
     *   the derivative cache keyed by input hashes.
     * - media_qa_reports / media_reviews / media_variants / media_capture_sessions / content_style_presets.
     * - content_manifests / content_release_attempts: the approved distribution package (hashes of media, caption, cover,
     *   accounts, schedule) and each attempt with its idempotency key and OUTCOME_UNKNOWN.
     * - content_campaigns / content_metrics / content_experiments / content_insights / content_funnel_events: measured results
     *   (missing is not zero), pre-registered experiments, insights with status, and Content → Sales events without invented
     *   attribution.
     */
    up(db) {
      db.exec(`
        ALTER TABLE factory_missions ADD COLUMN bindings_json TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE live_grants ADD COLUMN binding_json TEXT;
        ALTER TABLE agent_runs ADD COLUMN prompt_sha256 TEXT;
        ALTER TABLE agent_runs ADD COLUMN prompt_chars INTEGER;
        ALTER TABLE agent_runs ADD COLUMN skill_context_json TEXT NOT NULL DEFAULT '{}';
        CREATE TABLE run_skill_usage (run_id TEXT NOT NULL, skill_id TEXT NOT NULL, version INTEGER NOT NULL, sha256 TEXT NOT NULL,
          body_sha256 TEXT, source TEXT NOT NULL DEFAULT 'base', candidate_id TEXT, chars INTEGER NOT NULL DEFAULT 0, applied INTEGER NOT NULL DEFAULT 0,
          reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, PRIMARY KEY (run_id, skill_id));

        CREATE TABLE media_assets (id TEXT PRIMARY KEY, project_id TEXT, content_project_id TEXT, kind TEXT NOT NULL
            CHECK (kind IN ('video','audio','image','caption','font','document','other')),
          category TEXT NOT NULL CHECK (category IN ('raw','screen_recording','b_roll','music','sfx','voice','generated','brand','proxy','render','export','thumbnail','caption','font')),
          title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]',
          origin TEXT NOT NULL CHECK (origin IN ('OWNED','LICENSED','CLIENT_PROVIDED','AI_GENERATED','UNKNOWN')),
          capture_label TEXT NOT NULL DEFAULT 'NOT_APPLICABLE' CHECK (capture_label IN ('ORIGINAL_RECORDING','REPLAY','RECONSTRUCTION','SIMULATION','GENERATED','NOT_APPLICABLE')),
          current_version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
        CREATE INDEX idx_media_assets_project ON media_assets(content_project_id, category);
        CREATE TABLE media_asset_versions (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES media_assets(id), version INTEGER NOT NULL,
          sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, rel_path TEXT NOT NULL, mime TEXT NOT NULL DEFAULT '', probe_json TEXT NOT NULL DEFAULT '{}',
          is_original INTEGER NOT NULL DEFAULT 1, derived_from_json TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'READY' CHECK (status IN ('READY','MISSING','QUARANTINED','REMOVED_DERIVATIVE')),
          created_by TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(asset_id, version));
        CREATE INDEX idx_media_asset_versions_sha ON media_asset_versions(sha256);
        CREATE TABLE media_rights (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES media_assets(id),
          status TEXT NOT NULL CHECK (status IN ('PENDING','CLEARED_FOR_SCOPE','RESTRICTED','EXPIRED','REVOKED')),
          holder TEXT NOT NULL DEFAULT '', license_ref TEXT NOT NULL DEFAULT '', document_ref TEXT NOT NULL DEFAULT '',
          platforms_json TEXT NOT NULL DEFAULT '[]', uses_json TEXT NOT NULL DEFAULT '[]', territory TEXT NOT NULL DEFAULT '',
          starts_at TEXT, ends_at TEXT, attribution TEXT NOT NULL DEFAULT '', restrictions_json TEXT NOT NULL DEFAULT '[]',
          marketing_consent INTEGER NOT NULL DEFAULT 0, source_kind TEXT NOT NULL DEFAULT 'manual', source_ref TEXT NOT NULL DEFAULT '',
          recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL, revoked_at TEXT, revoke_reason TEXT);
        CREATE INDEX idx_media_rights_asset ON media_rights(asset_id, recorded_at);
        CREATE TABLE media_transcripts (id TEXT PRIMARY KEY, asset_version_id TEXT, project_id TEXT, requested_by TEXT NOT NULL, channel TEXT NOT NULL,
          input_sha256 TEXT NOT NULL, input_bytes INTEGER NOT NULL, format TEXT NOT NULL, duration_ms INTEGER, language TEXT NOT NULL,
          engine TEXT NOT NULL, tree_sha256 TEXT, model_sha256 TEXT, args_json TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL CHECK (status IN ('queued','running','final','failed','timeout','cancelled')),
          text TEXT, segments_json TEXT NOT NULL DEFAULT '[]', json_rel_path TEXT, srt_rel_path TEXT, word_count INTEGER, error TEXT,
          started_at TEXT, finished_at TEXT, created_at TEXT NOT NULL);
        CREATE INDEX idx_media_transcripts_asset ON media_transcripts(asset_version_id, created_at);

        CREATE TABLE content_style_presets (id TEXT NOT NULL, version INTEGER NOT NULL, title TEXT NOT NULL, body_json TEXT NOT NULL, sha256 TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')), created_by TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (id, version));
        CREATE TABLE content_campaigns (id TEXT PRIMARY KEY, name TEXT NOT NULL, objective TEXT NOT NULL DEFAULT '', audience TEXT NOT NULL DEFAULT '',
          theme TEXT NOT NULL DEFAULT '', calendar_json TEXT NOT NULL DEFAULT '[]', budget_json TEXT NOT NULL DEFAULT '{"approved":0,"currency":"EUR"}',
          cta_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','PAUSED','CLOSED')),
          created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE content_ideas (id TEXT PRIMARY KEY, title TEXT NOT NULL, angle TEXT NOT NULL DEFAULT '',
          audience TEXT NOT NULL DEFAULT 'both' CHECK (audience IN ('technical','business','both')),
          source_kind TEXT NOT NULL CHECK (source_kind IN ('event','owner','twin','manual','dev_session')), source_ref TEXT NOT NULL DEFAULT '',
          evidence_json TEXT NOT NULL DEFAULT '[]', reason TEXT NOT NULL DEFAULT '', public_eligible INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','SHORTLISTED','DISCARDED','PROMOTED')),
          dedupe_key TEXT UNIQUE, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE content_projects (id TEXT PRIMARY KEY, idea_id TEXT REFERENCES content_ideas(id), title TEXT NOT NULL,
          stage TEXT NOT NULL DEFAULT 'IDEAS' CHECK (stage IN ('IDEAS','RESEARCH','SCRIPT','STORYBOARD','PRODUCTION','EDITING','REVIEW','SCHEDULED','PUBLISHED','ANALYTICS','ARCHIVED')),
          readiness TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (readiness IN ('UNKNOWN','READY','NO_GO','NEEDS_CAPTURE')), readiness_json TEXT NOT NULL DEFAULT '{}',
          format TEXT NOT NULL DEFAULT '', platforms_json TEXT NOT NULL DEFAULT '[]', audience TEXT NOT NULL DEFAULT 'both',
          preset_id TEXT, preset_version INTEGER, campaign_id TEXT REFERENCES content_campaigns(id), opportunity_id TEXT REFERENCES sales_opportunities(id),
          scope_json TEXT NOT NULL DEFAULT '{}', deadline TEXT, responsible TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
        CREATE INDEX idx_content_projects_stage ON content_projects(stage, updated_at);
        CREATE TABLE content_briefs (id TEXT PRIMARY KEY, content_project_id TEXT NOT NULL REFERENCES content_projects(id), version INTEGER NOT NULL,
          body_json TEXT NOT NULL, sha256 TEXT NOT NULL, author_kind TEXT NOT NULL CHECK (author_kind IN ('owner','agent','dev_session','template')),
          author TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(content_project_id, version));
        CREATE TABLE content_claims (id TEXT PRIMARY KEY, content_project_id TEXT NOT NULL REFERENCES content_projects(id), text TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'UNCERTAIN' CHECK (status IN ('SUPPORTED','UNCERTAIN','BLOCKED')), evidence_json TEXT NOT NULL DEFAULT '[]',
          shot_json TEXT NOT NULL DEFAULT '{}', conditions TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX idx_content_claims_project ON content_claims(content_project_id);
        CREATE TABLE content_scripts (id TEXT PRIMARY KEY, content_project_id TEXT NOT NULL REFERENCES content_projects(id), version INTEGER NOT NULL,
          language TEXT NOT NULL DEFAULT 'ro', body_json TEXT NOT NULL, sha256 TEXT NOT NULL,
          author_kind TEXT NOT NULL CHECK (author_kind IN ('owner','agent','dev_session','template')), author TEXT NOT NULL, created_at TEXT NOT NULL,
          UNIQUE(content_project_id, language, version));
        CREATE TABLE content_storyboards (id TEXT PRIMARY KEY, content_project_id TEXT NOT NULL REFERENCES content_projects(id), version INTEGER NOT NULL,
          body_json TEXT NOT NULL, sha256 TEXT NOT NULL, author_kind TEXT NOT NULL CHECK (author_kind IN ('owner','agent','dev_session','template')),
          author TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(content_project_id, version));

        CREATE TABLE media_capture_sessions (id TEXT PRIMARY KEY, content_project_id TEXT, kind TEXT NOT NULL CHECK (kind IN ('obs','browser_demo','import','interview')),
          status TEXT NOT NULL CHECK (status IN ('PLANNED','RECORDING','STOPPED','FAILED','CANCELLED')), scope_json TEXT NOT NULL DEFAULT '{}',
          markers_json TEXT NOT NULL DEFAULT '[]', capture_label TEXT NOT NULL DEFAULT 'ORIGINAL_RECORDING', consent_json TEXT NOT NULL DEFAULT '{}',
          output_asset_id TEXT, error TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE media_edit_projects (id TEXT PRIMARY KEY, content_project_id TEXT REFERENCES content_projects(id), title TEXT NOT NULL,
          current_version INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE media_edit_versions (id TEXT PRIMARY KEY, edit_project_id TEXT NOT NULL REFERENCES media_edit_projects(id), version INTEGER NOT NULL,
          ir_json TEXT NOT NULL, ir_sha256 TEXT NOT NULL, parent_version_id TEXT,
          change_kind TEXT NOT NULL CHECK (change_kind IN ('initial','patch','variant','manual_divergence','import')),
          change_json TEXT NOT NULL DEFAULT '{}', validation_json TEXT NOT NULL DEFAULT '{}', variant_key TEXT,
          created_by TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(edit_project_id, version));
        CREATE TABLE media_render_jobs (id TEXT PRIMARY KEY, edit_version_id TEXT NOT NULL REFERENCES media_edit_versions(id),
          profile TEXT NOT NULL CHECK (profile IN ('draft','final')), idempotency_key TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL CHECK (status IN ('REQUESTED','CLAIMED','RUNNING','VALIDATING','DONE','FAILED','CANCEL_REQUESTED','CANCELLED','INTERRUPTED')),
          request_json TEXT NOT NULL DEFAULT '{}', claim_token TEXT, progress_json TEXT NOT NULL DEFAULT '{}', segments_json TEXT NOT NULL DEFAULT '[]',
          output_asset_version_id TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
          created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, finished_at TEXT);
        CREATE INDEX idx_media_render_jobs_status ON media_render_jobs(status, created_at);
        CREATE TABLE media_render_cache (cache_key TEXT PRIMARY KEY, rel_path TEXT NOT NULL, bytes INTEGER NOT NULL, probe_json TEXT NOT NULL DEFAULT '{}',
          tool_version TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT NOT NULL);
        CREATE TABLE media_qa_reports (id TEXT PRIMARY KEY, edit_version_id TEXT, render_job_id TEXT, asset_version_id TEXT,
          kind TEXT NOT NULL CHECK (kind IN ('technical','editorial','factual','rights','privacy')),
          status TEXT NOT NULL CHECK (status IN ('PASS','WARN','FAIL','NOT_RUN')), findings_json TEXT NOT NULL DEFAULT '[]', measurements_json TEXT NOT NULL DEFAULT '{}',
          created_by TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE INDEX idx_media_qa_reports_version ON media_qa_reports(edit_version_id, created_at);
        CREATE TABLE media_reviews (id TEXT PRIMARY KEY, edit_version_id TEXT NOT NULL REFERENCES media_edit_versions(id),
          kind TEXT NOT NULL CHECK (kind IN ('COMMENT','CHANGES_REQUESTED','CREATIVE_APPROVED','REJECTED')), timecode_ms INTEGER,
          text TEXT NOT NULL DEFAULT '', patch_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','APPLIED','DISMISSED','RECORDED')),
          result_version_id TEXT, provenance TEXT NOT NULL, actor TEXT NOT NULL, session_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX idx_media_reviews_version ON media_reviews(edit_version_id, created_at);
        CREATE TABLE media_variants (id TEXT PRIMARY KEY, edit_project_id TEXT NOT NULL REFERENCES media_edit_projects(id), master_version_id TEXT NOT NULL,
          platform_key TEXT NOT NULL, variant_version_id TEXT, status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','RENDERED','QA_FAILED','READY','INVALIDATED')),
          notes_json TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX idx_media_variants_project ON media_variants(edit_project_id, platform_key);

        CREATE TABLE content_manifests (id TEXT PRIMARY KEY, content_project_id TEXT NOT NULL REFERENCES content_projects(id),
          status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','INVALIDATED','SUPERSEDED')),
          body_json TEXT NOT NULL, manifest_sha256 TEXT NOT NULL, approval_json TEXT NOT NULL DEFAULT '{}', approved_by TEXT, approved_at TEXT,
          invalidated_reason TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE content_release_attempts (id TEXT PRIMARY KEY, manifest_id TEXT NOT NULL REFERENCES content_manifests(id), variant_id TEXT,
          platform TEXT NOT NULL, route TEXT NOT NULL CHECK (route IN ('manual_pack','api','assisted')), idempotency_key TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL CHECK (status IN ('PREPARED','UPLOADING','PROCESSING','DRAFT_EXTERNAL','SCHEDULED','PUBLISHED','FAILED','OUTCOME_UNKNOWN','PACK_READY','MISSED_NEEDS_DECISION','CANCELLED')),
          scheduled_for TEXT, timezone TEXT, external_json TEXT NOT NULL DEFAULT '{}', evidence_json TEXT NOT NULL DEFAULT '[]', error TEXT,
          created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX idx_content_release_attempts_manifest ON content_release_attempts(manifest_id, platform);
        CREATE TABLE content_metrics (id TEXT PRIMARY KEY, release_attempt_id TEXT, content_project_id TEXT, platform TEXT NOT NULL, metric_key TEXT NOT NULL,
          value REAL, unit TEXT NOT NULL DEFAULT '', observed_at TEXT NOT NULL, data_through TEXT, window TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL CHECK (source IN ('api','manual_import','fixture')), unavailable_reason TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE INDEX idx_content_metrics_attempt ON content_metrics(release_attempt_id, metric_key, observed_at);
        CREATE TABLE content_experiments (id TEXT PRIMARY KEY, title TEXT NOT NULL, variable TEXT NOT NULL, arms_json TEXT NOT NULL DEFAULT '[]',
          audience TEXT NOT NULL DEFAULT '', primary_metric TEXT NOT NULL, window_json TEXT NOT NULL DEFAULT '{}', analysis_rule_json TEXT NOT NULL DEFAULT '{}',
          design TEXT NOT NULL DEFAULT 'observational' CHECK (design IN ('randomized_native','observational')), simultaneous_changes_json TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REGISTERED','RUNNING','CLOSED','INCONCLUSIVE')), registered_sha256 TEXT,
          result_json TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE content_insights (id TEXT PRIMARY KEY, hypothesis TEXT NOT NULL, cohort_json TEXT NOT NULL DEFAULT '{}', sample_json TEXT NOT NULL DEFAULT '{}',
          units TEXT NOT NULL DEFAULT '', data_refs_json TEXT NOT NULL DEFAULT '[]', confounders_json TEXT NOT NULL DEFAULT '[]', result_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'HYPOTHESIS' CHECK (status IN ('HYPOTHESIS','OBSERVED_ASSOCIATION','EXPERIMENT_SUPPORTED','INCONCLUSIVE','RETIRED')),
          experiment_id TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE content_funnel_events (id TEXT PRIMARY KEY, content_project_id TEXT, release_attempt_id TEXT, opportunity_id TEXT REFERENCES sales_opportunities(id),
          kind TEXT NOT NULL CHECK (kind IN ('click','lead','proposal','contract','revenue_received')),
          attribution TEXT NOT NULL DEFAULT 'UNATTRIBUTED' CHECK (attribution IN ('DIRECT_TRACKED_LINK','SELF_REPORTED','UNATTRIBUTED')),
          amount REAL, currency TEXT, source TEXT NOT NULL CHECK (source IN ('manual','import','fixture')), evidence_json TEXT NOT NULL DEFAULT '[]',
          occurred_at TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE INDEX idx_content_funnel_project ON content_funnel_events(content_project_id, kind);
      `);
    },
  },
  {
    // M10: Lega PC Operator + zero-form plans + Studio completion. An operation plan is shown once and confirmed once; its steps
    // carry the derived authority (checked at every dispatch). Desktop sessions are exclusive; every desktop action is recorded with
    // its precondition and postcondition (redacted). Project imports are idempotent by the manifest hash. Import grants cover one
    // folder (once or persistent) without widening the global allowlist.
    version: 10,
    name: "m10-operator-plans",
    up(db) {
      db.exec(`
        CREATE TABLE ops_plans (id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('PROPOSED','CONFIRMED','RUNNING','PAUSED','DONE','FAILED','CANCELLED','EXPIRED','SUPERSEDED','NEEDS_OWNER')),
          body_json TEXT NOT NULL, summary_json TEXT NOT NULL DEFAULT '{}', plan_hash TEXT NOT NULL, nonce TEXT NOT NULL,
          proposed_by TEXT NOT NULL, proposed_via TEXT NOT NULL, confirm_by TEXT NOT NULL, expires_at TEXT NOT NULL,
          consent_json TEXT, authority_json TEXT, progress_json TEXT NOT NULL DEFAULT '{}', status_reason TEXT NOT NULL DEFAULT '',
          owner_session_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
        CREATE INDEX idx_ops_plans_status ON ops_plans(status, updated_at);
        CREATE TABLE ops_plan_steps (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES ops_plans(id), seq INTEGER NOT NULL, kind TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '', params_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','DONE','FAILED','SKIPPED','UNCERTAIN','CANCELLED','BLOCKED')),
          attempts INTEGER NOT NULL DEFAULT 0, result_json TEXT NOT NULL DEFAULT '{}', evidence_json TEXT NOT NULL DEFAULT '[]', error TEXT,
          started_at TEXT, finished_at TEXT, updated_at TEXT NOT NULL, UNIQUE (plan_id, seq));
        CREATE TABLE desktop_apps (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, status TEXT NOT NULL, exe_path TEXT, exe_sha256 TEXT, version TEXT,
          publisher TEXT, signature_json TEXT NOT NULL DEFAULT '{}', launch_json TEXT NOT NULL DEFAULT '{}', capabilities_json TEXT NOT NULL DEFAULT '{}',
          discovered_from TEXT NOT NULL DEFAULT '', authorized_json TEXT NOT NULL DEFAULT '{}', verified_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL);
        CREATE TABLE desktop_sessions (id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('ACTIVE','PAUSED','TAKEN_OVER','ENDED')),
          plan_id TEXT, controller TEXT NOT NULL, app_id TEXT, window_json TEXT NOT NULL DEFAULT '{}', started_at TEXT NOT NULL, ended_at TEXT,
          end_reason TEXT, updated_at TEXT NOT NULL);
        CREATE UNIQUE INDEX idx_desktop_one_active ON desktop_sessions(status) WHERE status IN ('ACTIVE','PAUSED');
        CREATE TABLE desktop_actions (id TEXT PRIMARY KEY, session_id TEXT, plan_id TEXT, step_id TEXT, op TEXT NOT NULL, app_id TEXT,
          action_class TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('DONE','FAILED','REFUSED','SUSPENDED','UNCERTAIN')),
          target_json TEXT NOT NULL DEFAULT '{}', pre_json TEXT NOT NULL DEFAULT '{}', post_json TEXT NOT NULL DEFAULT '{}', result_json TEXT NOT NULL DEFAULT '{}',
          error TEXT, actor TEXT NOT NULL, channel TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT);
        CREATE INDEX idx_desktop_actions_session ON desktop_actions(session_id, started_at);
        CREATE TABLE media_project_imports (id TEXT PRIMARY KEY, import_key TEXT NOT NULL UNIQUE, source_dir TEXT NOT NULL, manifest_sha256 TEXT,
          format TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('PREVIEWED','IMPORTING','IMPORTED','FAILED')), preview_json TEXT NOT NULL DEFAULT '{}',
          mapping_json TEXT NOT NULL DEFAULT '{}', content_project_id TEXT, error TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE media_import_grants (id TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK (mode IN ('once','persistent')), root_path TEXT NOT NULL,
          files_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL CHECK (status IN ('ACTIVE','USED','EXPIRED','REVOKED')), plan_id TEXT, owner_session_id TEXT,
          preview_sha256 TEXT NOT NULL, expires_at TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      `);
    },
  },
  {
    // M10.2: preserved work requests. A request the Hub cannot run yet (a blocker) is kept instead of dropped: its redacted text,
    // where it came from, the blocker signature and when the full explanation was given (spoken once per request + signature),
    // and the plan it became. It never executes by itself: when its blockers clear it is only re-proposed as a plan that still
    // needs the owner's one confirmation. Expires after 7 days.
    version: 11,
    name: "m10-2-work-requests",
    up(db) {
      db.exec(`
        CREATE TABLE work_requests (id TEXT PRIMARY KEY, text_redacted TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, channel TEXT NOT NULL,
          project_id TEXT, intent TEXT NOT NULL, effect_class TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','BLOCKED','PLANNED','CONFIRMED','DONE','CANCELLED','EXPIRED')),
          blocker_signature TEXT NOT NULL DEFAULT '', explained_at TEXT, explanation_json TEXT NOT NULL DEFAULT '{}', plan_ref TEXT,
          consent_json TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1);
        CREATE INDEX idx_work_requests_status ON work_requests(status, updated_at);
        CREATE INDEX idx_work_requests_project ON work_requests(project_id, status);
      `);
    },
  },
  {
    // M11 „Ifrim Delivery”: a delivery binds one verified software version to what is shown from it (preview, captures, clip,
    // vertical, commercial summary) through real links. Items carry the snapshot they are evidence of and their upstream items, so
    // a change marks exactly the dependent items STALE (delivery/stale.mjs); a STALE item never returns to CURRENT. Documents are
    // versioned (an owner edit is a new version), revisions record the owner's feedback and what it became. Purely additive.
    version: 12,
    name: "m11-deliveries",
    up(db) {
      db.exec(`
        CREATE TABLE deliveries (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), parent_id TEXT REFERENCES deliveries(id),
          lineage INTEGER NOT NULL DEFAULT 1, title TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('PLANNED','ARMED','ACTIVE','READY','NEEDS_OWNER','STALE','CLOSED','CANCELLED','EXPIRED','FAILED')),
          status_reason TEXT NOT NULL DEFAULT '', mission_id TEXT, envelope_id TEXT, envelope_hash TEXT, ops_plan_id TEXT,
          template_json TEXT NOT NULL, template_sha TEXT NOT NULL, ops_steps_json TEXT NOT NULL, ops_body_sha TEXT NOT NULL, consent_json TEXT,
          activate_by TEXT, activated_at TEXT, phase_expires_at TEXT,
          bundle_id TEXT, bundle_sha TEXT, change_set_id TEXT, change_set_sha TEXT, snapshot_sha TEXT, spec_version INTEGER, spec_sha TEXT, binding_sha TEXT,
          generation INTEGER NOT NULL DEFAULT 0, content_project_id TEXT, edit_project_id TEXT,
          labels_json TEXT NOT NULL DEFAULT '[]', verified_json TEXT NOT NULL DEFAULT '{}',
          created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT, version INTEGER NOT NULL DEFAULT 1);
        CREATE INDEX idx_deliveries_project ON deliveries(project_id, updated_at);
        CREATE INDEX idx_deliveries_mission ON deliveries(mission_id);
        CREATE UNIQUE INDEX ux_deliveries_envelope ON deliveries(envelope_id) WHERE envelope_id IS NOT NULL;
        CREATE UNIQUE INDEX ux_deliveries_open_project ON deliveries(project_id) WHERE status IN ('ARMED','ACTIVE');
        CREATE TABLE delivery_items (id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL REFERENCES deliveries(id),
          kind TEXT NOT NULL CHECK (kind IN ('bundle','e2e_shot','preview','capture','brief','claim','edit','render','variant','qa','export')),
          role TEXT NOT NULL DEFAULT '', ref_table TEXT NOT NULL, ref_id TEXT NOT NULL, ref_sha TEXT NOT NULL DEFAULT '', snapshot_sha TEXT NOT NULL DEFAULT '',
          generation INTEGER NOT NULL DEFAULT 1, upstream_json TEXT NOT NULL DEFAULT '[]', supersedes_id TEXT,
          status TEXT NOT NULL DEFAULT 'CURRENT' CHECK (status IN ('CURRENT','SUPERSEDED','STALE')), stale_code TEXT NOT NULL DEFAULT '', status_reason TEXT NOT NULL DEFAULT '',
          meta_json TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX idx_delivery_items_delivery ON delivery_items(delivery_id, kind, status);
        CREATE INDEX idx_delivery_items_ref ON delivery_items(ref_table, ref_id);
        CREATE TABLE delivery_documents (id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL REFERENCES deliveries(id),
          kind TEXT NOT NULL CHECK (kind IN ('commercial_summary')), version INTEGER NOT NULL, parent_id TEXT,
          sections_json TEXT NOT NULL, text TEXT NOT NULL, content_sha TEXT NOT NULL, basis_json TEXT NOT NULL, basis_sha TEXT NOT NULL,
          claims_to_verify_json TEXT NOT NULL DEFAULT '[]', warnings_json TEXT NOT NULL DEFAULT '[]',
          author_kind TEXT NOT NULL CHECK (author_kind IN ('template','owner','mixed')),
          status TEXT NOT NULL CHECK (status IN ('CURRENT','SUPERSEDED','STALE')), stale_reason TEXT NOT NULL DEFAULT '',
          approval_json TEXT, export_json TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (delivery_id, kind, version));
        CREATE TABLE delivery_revisions (id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL REFERENCES deliveries(id), text_redacted TEXT NOT NULL,
          classes_json TEXT NOT NULL DEFAULT '[]', target_json TEXT NOT NULL DEFAULT '{}', delta_json TEXT NOT NULL DEFAULT '{}', clarification_json TEXT,
          status TEXT NOT NULL CHECK (status IN ('NOTED','CLARIFY','PROPOSED','APPLIED','ROUTED_SOFTWARE','REFUSED','CANCELLED')),
          ops_plan_id TEXT, review_id TEXT, document_id TEXT, child_delivery_id TEXT,
          source TEXT NOT NULL, channel TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX idx_delivery_revisions_delivery ON delivery_revisions(delivery_id, created_at);
      `);
    },
  },
  {
    // M12 Sales: the synthetic preparation brief → offer → „Dosarul ofertei”. Purely additive: older code runs on this schema, so
    // `git revert` of the release + the managed upgrade is a valid rollback without a database restore.
    // - sales_evidence gains the C-03 data kind (FIXTURE / STATEMENT / INFERENCE), separate from the M04 confidence label. Existing
    //   rows are never rewritten: their kind stays NULL, shown as „nedeclarat (M04)”. An inference carries its basis and reasoning.
    // - sales_preparations: one confirmed `sales.prepare` plan, its immutable brief and the exact offer it waits for (id + sha); the
    //   plan whose consent governs it now (the root or a continuation card), its window (activate_by) and the reason of its status.
    // - sales_plan_ops: the C-01 ledger, one row per (confirmed root plan + operation + normalised params); a resume reads it
    //   instead of re-running an effect. `fixed_at` is the timestamp the operation's content uses, so a retry writes the same bytes.
    // - sales_dossiers: the local „Dosarul ofertei” (never `sales_handoffs`, which stays the Engineering hand-off after acceptance), with
    //   the draft and the inputs it is evidence of (inputs_sha: a change of the offer, the draft or the evidence makes it STALE).
    // Everything M12 writes here is synthetic (CHECK synthetic = 1). The status lists equal the constants in sales.mjs.
    version: 13,
    name: "m12-sales-prep",
    up(db) {
      db.exec(`
        ALTER TABLE sales_evidence ADD COLUMN data_kind TEXT CHECK (data_kind IS NULL OR data_kind IN ('FIXTURE','STATEMENT','INFERENCE'));
        ALTER TABLE sales_evidence ADD COLUMN basis_json TEXT;
        ALTER TABLE sales_evidence ADD COLUMN reasoning TEXT;
        CREATE TABLE sales_preparations (id TEXT PRIMARY KEY, root_plan_id TEXT NOT NULL, root_plan_hash TEXT NOT NULL, phase_b_plan_id TEXT,
          brief_json TEXT NOT NULL, brief_sha TEXT NOT NULL, org_id TEXT REFERENCES sales_orgs(id), opportunity_id TEXT REFERENCES sales_opportunities(id),
          proposal_id TEXT REFERENCES sales_proposals(id), awaited_proposal_id TEXT, awaited_proposal_sha TEXT, consent_json TEXT,
          status TEXT NOT NULL CHECK (status IN ('PLANNED','PREPARING','WAITING_OWNER','PACKAGING','READY','STALE','STOPPED','EXPIRED','CANCELLED','FAILED')),
          stale_reason TEXT NOT NULL DEFAULT '', synthetic INTEGER NOT NULL DEFAULT 1 CHECK (synthetic = 1),
          created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
          plan_id TEXT, status_reason TEXT NOT NULL DEFAULT '', activate_by TEXT);
        CREATE UNIQUE INDEX ux_sales_preparations_root ON sales_preparations(root_plan_id);
        CREATE INDEX idx_sales_preparations_opp ON sales_preparations(opportunity_id, status);
        CREATE TABLE sales_plan_ops (op_key TEXT PRIMARY KEY, root_plan_id TEXT NOT NULL, root_plan_hash TEXT NOT NULL, op TEXT NOT NULL,
          params_json TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('IN_PROGRESS','DONE','FAILED')), claim_token TEXT, result_json TEXT,
          fixed_at TEXT NOT NULL, synthetic INTEGER NOT NULL DEFAULT 1 CHECK (synthetic = 1), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX idx_sales_plan_ops_root ON sales_plan_ops(root_plan_id, op);
        CREATE TABLE sales_dossiers (id TEXT PRIMARY KEY, preparation_id TEXT NOT NULL REFERENCES sales_preparations(id),
          opportunity_id TEXT NOT NULL REFERENCES sales_opportunities(id), proposal_id TEXT NOT NULL REFERENCES sales_proposals(id), proposal_sha TEXT NOT NULL,
          revision INTEGER NOT NULL, folder TEXT NOT NULL, files_json TEXT NOT NULL DEFAULT '[]', manifest_sha256 TEXT, verification_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL CHECK (status IN ('WRITING','READY','STALE','SUPERSEDED','INCOMPLETE')), status_reason TEXT NOT NULL DEFAULT '',
          op_key TEXT NOT NULL UNIQUE, synthetic INTEGER NOT NULL DEFAULT 1 CHECK (synthetic = 1),
          created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          org_id TEXT, draft_id TEXT, draft_sha TEXT, inputs_json TEXT NOT NULL DEFAULT '{}', inputs_sha TEXT NOT NULL DEFAULT '', ops_plan_id TEXT,
          UNIQUE (opportunity_id, revision));
        CREATE INDEX idx_sales_dossiers_opp ON sales_dossiers(opportunity_id, status);
      `);
    },
  },
  {
    // M13 „Birou intern” (Operations / Customer Support / Finance-Admin): three internal flows over the operation plans. Purely additive:
    // older code runs on this schema, so `git revert` of the release + the managed upgrade is a valid rollback without a database restore.
    // - desk_records: one record per confirmed root plan (dsk_): the pinned inputs (offer id + sha, delivery, request), its state (checklist,
    //   questions, risks, deadlines, classification, sources), status, owner, next action, the plan whose consent governs it and the exact
    //   artifact it waits for (id + sha). Its status list equals RECORD_STATUSES in desk/desk.mjs.
    // - desk_artifacts: the versioned texts the owner approves (the support reply, the deviz): content sha, status, the approval.
    // - desk_exports: the local export folders (revisions), with their manifest and verification; never overwritten.
    // - desk_plan_ops: the C-01 ledger of these plans (same shape as sales_plan_ops).
    // Everything M13 writes is synthetic in this stage (CHECK synthetic = 1).
    version: 14,
    name: "m13-desk",
    up(db) {
      db.exec(`
        CREATE TABLE desk_records (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('ops_start','support_case','finance_doc')),
          department TEXT NOT NULL CHECK (department IN ('operations','customer-success','finance-admin')), internal_no TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
          project_id TEXT, opportunity_id TEXT, proposal_id TEXT, proposal_sha TEXT, delivery_id TEXT, request_text TEXT NOT NULL DEFAULT '',
          source_json TEXT NOT NULL DEFAULT '{}', inputs_sha TEXT NOT NULL DEFAULT '', state_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL CHECK (status IN ('PLANNED','PREPARING','WAITING_OWNER','PACKAGING','READY','STALE','STOPPED','EXPIRED','FAILED','CANCELLED')),
          status_reason TEXT NOT NULL DEFAULT '', stale_reason TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL DEFAULT 'proprietar', next_action TEXT NOT NULL DEFAULT '', next_action_at TEXT,
          root_plan_id TEXT NOT NULL, root_plan_hash TEXT NOT NULL, plan_id TEXT, phase_b_plan_id TEXT, consent_json TEXT, activate_by TEXT,
          awaited_artifact_id TEXT, awaited_sha TEXT, synthetic INTEGER NOT NULL DEFAULT 1 CHECK (synthetic = 1),
          version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE UNIQUE INDEX ux_desk_records_root ON desk_records(root_plan_id);
        CREATE INDEX idx_desk_records_kind ON desk_records(kind, status);
        CREATE INDEX idx_desk_records_opp ON desk_records(opportunity_id);
        CREATE TABLE desk_artifacts (id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES desk_records(id),
          kind TEXT NOT NULL CHECK (kind IN ('support_reply','deviz')), version INTEGER NOT NULL, content_json TEXT NOT NULL, content_sha TEXT NOT NULL,
          inputs_sha TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK (status IN ('DRAFT','APPROVED_INTERNAL','SUPERSEDED','STALE')), status_reason TEXT NOT NULL DEFAULT '',
          approval_id TEXT, approved_sha TEXT, approved_at TEXT, approval_json TEXT, synthetic INTEGER NOT NULL DEFAULT 1 CHECK (synthetic = 1),
          created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (record_id, version));
        CREATE TABLE desk_exports (id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES desk_records(id), artifact_id TEXT, artifact_sha TEXT,
          revision INTEGER NOT NULL, folder TEXT NOT NULL, files_json TEXT NOT NULL DEFAULT '[]', manifest_sha256 TEXT, verification_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL CHECK (status IN ('WRITING','READY','STALE','SUPERSEDED','INCOMPLETE')), status_reason TEXT NOT NULL DEFAULT '',
          op_key TEXT NOT NULL UNIQUE, inputs_json TEXT NOT NULL DEFAULT '{}', inputs_sha TEXT NOT NULL DEFAULT '', ops_plan_id TEXT,
          synthetic INTEGER NOT NULL DEFAULT 1 CHECK (synthetic = 1), created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          UNIQUE (record_id, revision));
        CREATE INDEX idx_desk_exports_record ON desk_exports(record_id, status);
        CREATE TABLE desk_plan_ops (op_key TEXT PRIMARY KEY, root_plan_id TEXT NOT NULL, root_plan_hash TEXT NOT NULL, op TEXT NOT NULL,
          params_json TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('IN_PROGRESS','DONE','FAILED')), claim_token TEXT, result_json TEXT,
          fixed_at TEXT NOT NULL, synthetic INTEGER NOT NULL DEFAULT 1 CHECK (synthetic = 1), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX idx_desk_plan_ops_root ON desk_plan_ops(root_plan_id, op);
      `);
    },
  },
  {
    // M14: who runs a backup. A row left 'running' by a stopped Hub is reconciled at the next boot from these facts (the owning boot,
    // its process and computer, the last sign of life) — never guessed: another live instance's backup is left alone, an undecidable one
    // says so (owner_unknown). Additive: the old code ignores the columns; old rows keep them NULL (their owner is unknown).
    version: 15,
    name: "m14-backup-owner",
    up(db) {
      db.exec(`
        ALTER TABLE backups ADD COLUMN owner_boot_id TEXT;
        ALTER TABLE backups ADD COLUMN owner_pid INTEGER;
        ALTER TABLE backups ADD COLUMN owner_host TEXT;
        ALTER TABLE backups ADD COLUMN heartbeat_at TEXT;
        CREATE INDEX idx_backups_status ON backups(status);
      `);
    },
  },
  {
    // 2.19.1 (the owner's L3ga session of 2026-10-25): the owner's wishlist — what he wants the Hub or L3ga to do and it cannot do yet,
    // in his own words (owner/wishlist.mjs). A note, never a task. Additive: the older code ignores the table, so `git revert` of the
    // release + the managed upgrade stays a valid rollback without a database restore.
    version: 16,
    name: "l3ga-wishlist",
    up(db) {
      db.exec(`
        CREATE TABLE wishlist_items (id TEXT PRIMARY KEY, text TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('OPEN','DONE','REMOVED')),
          source TEXT NOT NULL CHECK (source IN ('typed','voice','ui')), origin TEXT, project_id TEXT, created_by TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, done_at TEXT);
        CREATE INDEX idx_wishlist_status ON wishlist_items(status, created_at);
      `);
    },
  },
];
