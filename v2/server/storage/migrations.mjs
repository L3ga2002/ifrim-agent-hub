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
];
