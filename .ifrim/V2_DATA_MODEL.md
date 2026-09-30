# Modelul de date V2 (schemă și migrări)

Baza: `.ifrim/private/hub-v2.sqlite` (WAL, foreign keys). Migrări ordonate în `v2/server/storage/migrations.mjs`, înregistrate în `schema_migrations`. Fiecare migrare rulează într-o tranzacție proprie. Migrările sunt **aditive**: nu șterg rânduri; valorile vechi se mapează pe loc.

## Migrarea 2 — „m01-company-runtime-surfaces” (Milestone 01, 2026-09-30)

Conceptele minime din specificația Milestone 01 și unde trăiesc:

| Concept | Tabel / sursă | Note |
|---|---|---|
| Company | `companies` | o companie (Ifrim Digital); `company_id` implicit în evenimente |
| Department | `departments` | 12 departamente; `status` active/planned/paused; 4 validate în M01 (Executive, Engineering, Sales, Operations) |
| Goal | `goals` | ciclu de viață DRAFT→ACTIVE→AT_RISK/BLOCKED→ACHIEVED/ABANDONED; ACHIEVED cere dovezi |
| Objective | `objectives` | rezultate-cheie măsurabile; OPEN→IN_PROGRESS→MET/MISSED/DROPPED |
| Project, Client | `projects`, `clients` (+`company_id`, `domain`, `status`) | |
| Conversation, Message, Attachment | neschimbate | conversația canonică rămâne a Hub-ului |
| Mission | `missions` (+`company_id`, `department_id`, `goal_id`, `objective_id`, `client_id`) | stare derivată, validată de mașina `mission` |
| Task | `tasks` (+`department_id`, `task_type`, `route_decision_id`) | 12 stări, neschimbate |
| TaskDependency | `task_dependencies` | autoritativ; `depends_on_json` rămâne copie de compatibilitate; cicluri refuzate |
| AgentRole | `agent_roles` (+`department_id`) + `v2/config/roles.json` (18 roluri) | definiție, nu execuție |
| ManagerRelationship | `manager_relationships` | organigrama rolurilor (Chief of Staff → owner) |
| AgentRun | `agent_runs` (+`surface_id`, `department_id`, `route_decision_id`, `correlation_id`, `skill_versions_json`) | execuție; niciodată implicată de un rol |
| Provider | `integration_connections` (inspecții) + adaptoare | |
| ProviderSession | `provider_sessions` (+`surface_id`) | active/idle/lost/closed/superseded |
| ExecutionSurface | `execution_surfaces` + `v2/config/ecosystem/surfaces.json` | furnizor, tip, capabilități, plan, auth, facturare, nivel de control, locație, disponibilitate, restricții, operații |
| Tool / ToolExecution | `integrations` (registru) / `tool_calls` | |
| ComputerEnvironment | `computer_environments` + `computer.json` | lock de controller unic prin `leases` (`computer:*`, `window:*`) |
| Artifact | `artifacts` (+`mission_id`, `source`, `surface_id`, `native_ref`, `version`, `owner`, `title`) | ArtifactReference, fără sincronizare pretinsă |
| Checkpoint | `checkpoints` (+`label`, `hub_state_json`, `native_refs_json`, `next_action`, `created_by`) | cross-provider; referențiază checkpointurile native |
| Handoff | `handoffs` (+`from_surface`, `to_surface`) | |
| Decision | `decisions` | neschimbat |
| Approval | `approvals` + `approval_policies` + `task_approval_scopes` | AUTO_ALLOWED / ASK_ONCE_FOR_TASK / ALWAYS_ASK / DENIED |
| Capability / CapabilityVerification | `capability_registry` / `capability_verifications` | etichete PASS_LIVE/PASS_LOCAL/PASS_SIMULATED/FAIL/BLOCKED/NOT_RUN |
| UsageSnapshot | `usage_snapshots` | neschimbat |
| MemoryEntry | `memory_items` (+`source_kind`, `sync_direction`) | scope-uri GLOBAL…AGENT_ROLE |
| Skill | `skills` + `skill_versions` + `v2/skills/*/SKILL.md` | format Agent Skills; versiuni imutabile (SHA-256) |
| Automation | `automations` (existent) + `schedules` | |
| NativeScheduleReference | `native_schedule_refs` | PROPOSED→PENDING_USER_SETUP→LINKED→ACTIVE/PAUSED→ORPHANED→DETACHED |
| (rulări programate) | `schedule_runs` | UNIQUE(schedule_id, slot): cel mult o rulare per slot |
| (decizii de rutare) | `route_decisions` | factori, alternative, motiv, override manual |
| (telemetrie) | `execution_telemetry` | câmpuri etichetate MEASURED/PROVIDER_REPORTED/DERIVED/UNKNOWN |
| (comenzi) | `commands` | jurnalul command bus-ului; `idempotency_key` unic |
| (sesiuni native) | `native_sessions` | oglindă read-only `claude agents --json` |
| BackupRecord | `backups` | neschimbat |
| AuditEvent | `events` (+`company_id`, `department_id`, `mission_id`, `task_id`, `correlation_id`, `raw_ref`) | envelope v2; `schema_version` = 2 pentru evenimentele noi |

Mapări de date în migrare: `memory_items.scope` general/company/client/project/task → GLOBAL/COMPANY/CLIENT/PROJECT/TASK, decision/procedure → GLOBAL (tipul DECISION rămâne); `tasks.depends_on_json` → `task_dependencies`.

Verificare pe copie (2026-09-30, `v2/tests/manual/migration-on-copy.mjs`): copie coerentă a bazei live prin API-ul de backup SQLite în `.ifrim/tmp/migration-check/`, migrare 1→2, `integrity_check = ok`, 0 încălcări de foreign key, 22 de tabele noi, niciun tabel cu mai puține rânduri (V1 importat intact: 6 conversații, 39 mesaje, 26 taskuri, 21 run-uri, 83 backup-uri, 40 aprobări, 565 evenimente).

## Migrarea 1 — „v2-core-schema”

### Entități

| Entitate cerută | Tabel | Note |
|---|---|---|
| Project | `projects` | `execution_allowed` (doar Agent Hub), `trusted_config` |
| Client | `clients` | `demo` pentru date demonstrative |
| Conversation | `conversations` | `writer_provider`, `active_mission_id`, `version` |
| Message | `messages` | `position` unic per conversație, `content_sha256`, `client_message_id` (idempotență); final = imutabil |
| (rezumate) | `summaries` | separate de mesaje; originalele nu se șterg |
| Attachment | `attachments` | hash, tip, mărime, proveniență, permisiuni; fișier în `.ifrim/private/v2-attachments` |
| Mission | `missions` | tip, criterii, restricții, stare derivată |
| Task | `tasks`, `task_transitions` | 12 stări, tranziții validate cu motiv și actor |
| AgentRole | `agent_roles` | din `v2/config/roles.json` |
| AgentRun | `agent_runs` | provider, model, efort, acces, sesiune nativă, backup, grant, versiune cod, `pre_inference`, dovezi |
| ProviderSession | `provider_sessions` | sesiuni native atașate conversației (`legacy` pentru V1) |
| ToolCall | `tool_calls` | `idempotency_key`, efecte, rezultat |
| Artifact | `artifacts` | hash, cale |
| Checkpoint | `checkpoints` | git + manifest |
| Handoff | `handoffs` | pas, pachet, SHA-256 |
| Decision | `decisions` | sursă, autor, `supersedes_id` |
| Approval | `approvals` | hash canonic al acțiunii, versiune cod, tier, scope, expirare, un singur uz |
| (grant live) | `live_grants` | provider, proiect, acces, încercări, expirare |
| Capability | `capabilities` + `v2/config/capabilities.json` | registrul de capabilități |
| UsageSnapshot | `usage_snapshots` | doar date raportate de provider |
| IntegrationConnection | `integration_connections` | inspecții provider (fără identitate/secret) |
| Automation | `automations` | `external_effects`, ore de liniște, debounce, adâncime maximă (dezactivate în BUILD_SAFE) |
| BackupRecord | `backups` | manifest SHA-256, snapshot-uri SQLite, raport restaurare |
| AuditEvent | `events` | log append-only; tipurile `audit.*`/toate evenimentele formează jurnalul de audit |
| (lease) | `leases` | index unic parțial: un singur writer activ/reținut per resursă |
| (memorie) | `memory_items`, `memory_fts` | FTS5 `unicode61 remove_diacritics 2` |
| (lead-uri) | `leads` | cheie normalizată unică, dovezi cu sursă+dată |
| (propuneri skill) | `skill_proposals` | agenții propun, utilizatorul decide |
| (migrare V1) | `import_batches`, `legacy_map` | lot reversibil, mapare V1 → V2 |

## Migrarea datelor V1 (MIGRATE_DATA)

Implementare: `v2/server/storage/v1-import.mjs`; UI: Setări → Date V1.

1. **Snapshot** consistent din `.ifrim/private/agent-hub.sqlite` prin API-ul de backup SQLite, în `.ifrim/BACKUPS/v2-rebuild/`. Baza V1 nu se modifică niciodată.
2. **Dry-run**: numără, listează proiectele de creat, lock-urile V1 active și maparea taskurilor deschise; raportul este legat de SHA-256-ul snapshot-ului.
3. **Apply**: refuză un snapshot diferit de cel din dry-run; creează rânduri noi cu `legacy_id` și `legacy_map`; reaplicarea nu dublează.
4. **Revert** pe lot: șterge exact rândurile create de lot, în ordinea dependențelor.

Reguli: taskurile V1 `in_progress/review/qa` → `BLOCKED` cu statusul original în motiv (nu se reiau); `done` → `COMPLETED` cu dovada „importat din V1”; aprobările V1 → `legacy_*`, niciodată utilizabile; sesiunile native V1 → `legacy`, nereluate; backup-urile V1 → `legacy_*`, nu satisfac poarta; tabelele de referință (`agent_runs` V1, `execution_attempts`, `workflow_transitions`, `snapshots`, `task_drafts`, `hub_checkpoints`, `locks`) rămân lizibile prin `GET /api/legacy/table/:name` (redactate).

Execuție reală 2026-09-29: snapshot `agent-hub-v1-2026-09-29T21-58-30-599Z.sqlite` (SHA-256 identic cu checkpoint-ul inițial) → 5 conversații, 38 mesaje, 5 rezumate, 4 sesiuni, 20 run-uri, 26 taskuri, 81 backup-uri, 40 aprobări, 514 evenimente. Un prim lot a creat un proiect duplicat (`ifrim-scope-quote` vs `ifrim-scope-and-quote`); lotul a fost anulat prin revert (verificat: exact rândurile lotului) și reaplicat cu potrivire corectată.
