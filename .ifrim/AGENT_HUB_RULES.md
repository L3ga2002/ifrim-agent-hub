# Agent Hub Rules - Ifrim Agent Hub

This project participates in the IfrimDigital Agent Hub system.

## Coordinator

- Codex coordinates.
- OpenClaw provides local specialist agents.
- Claude Code is optional premium review/advisory capacity.
- Project memory is the source of truth, not chat memory.

## Required Before Non-Trivial Work

- identify active project
- read .ifrim/NEXT_SESSION.md
- read .ifrim/PROJECT_STATE.md
- read .ifrim/OPEN_ISSUES.md
- read .ifrim/PREVIEW.md
- read .ifrim/AGENTS.md
- read .ifrim/OPENCLAW.md
- read this file
- run git status --short --branch

## Task Packet Rule

Every non-trivial task should define:

- title
- goal
- affected screens/files/API
- owner agent
- reviewer agent
- QA path
- acceptance criteria
- risks
- approval needed or not

## Lock Rule

Use advisory or exclusive locks for risky/shared workflows before parallel agent work.

Lock candidates:

- auth/session
- shared UI components
- database/schema
- deployment/build scripts
- external integrations
- payment/email/outreach/send flows

## Snapshot Rule

When Catalin says a version is good, stable, or liked, create a snapshot note under .ifrim/CHECKPOINTS/ or .ifrim/LOOP_REPORTS/.

Snapshot should include:

- date/time
- git state
- preview URL
- what Catalin liked
- verified workflow
- known limitations

## QA Rule

Important work is not done until build/test/preview/regression checks are run or the unverified risk is clearly reported.