# Ifrim Agent Hub Roadmap

## Phase 1 - Read-Only Scanner

Goal:

- show live project context without editing anything.

Features:

- read `PROJECTS.md`
- read `.ifrim-system/PORTS.md`
- read each project `.ifrim/` memory
- show preview URLs
- show open issues
- show latest loop reports
- show current stage/phase

Acceptance:

- ProDelivery appears with Phase 2 warning and restaurant panel priority.
- No source files from other projects are edited.
- No agents are invoked automatically.

## Phase 2 - Task Queue And Locks

Goal:

- turn project context into explicit work packets.

Features:

- task packets
- owner/reviewer/QA routing
- advisory/exclusive locks
- status tracking
- acceptance criteria

Acceptance:

- a ProDelivery Phase 2 task can be created and locked.
- future-phase ProDelivery tasks require Catalin approval.

## Phase 3 - OpenClaw Bridge

Goal:

- invoke OpenClaw specialist agents safely.

Features:

- availability check
- per-agent invocation
- result capture
- timeout handling
- failure diagnosis

Acceptance:

- hub can run `ifrim-qa` or a reviewer and store the result.

## Phase 4 - Review And QA Loop

Goal:

- make implementation, review, and QA separate.

Features:

- reviewer state
- QA checklist state
- regression QA checklist
- done/unverified split

Acceptance:

- important work cannot be marked complete without review/QA evidence or explicit unverified risk.

## Phase 5 - Claude Bridge

Goal:

- use Claude Code only when useful and available.

Features:

- model routing display
- cost gate for Opus/Fable
- fallback to Codex/OpenClaw
- result capture

Acceptance:

- Claude unavailability does not block normal work.

## Phase 6 - Snapshots

Goal:

- preserve versions Catalin likes.

Features:

- snapshot registry
- git state capture
- preview route
- verified workflow
- known limitations

Acceptance:

- "asta imi place" creates a durable checkpoint note.

## Phase 7 - Scheduled Loops

Goal:

- recurring read-only health checks.

Features:

- project health loop
- preview health loop
- weekly security/quality loop
- Telegram summary option

Acceptance:

- loops create reports/tasks, not unapproved source changes.
