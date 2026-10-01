---
name: handoff
description: "Verifiable handoff of a task between sessions or providers: freeze, safe point, reconcile, checkpoint, sanitized package (with the Software Factory spec, change set and findings when present), writer transfer, authorized start and acknowledgement. Use when another provider continues the work."
license: Proprietary (Ifrim Digital internal use)
compatibility: Agent Skills format. Usable by Claude Code, Codex and Ifrim Agent Hub V2; tools and permissions are enforced by the Hub, not by this file.
metadata:
  hub-version: "2"
  hub-roles: "project-manager"
  hub-permission: READ_ONLY
  hub-tools: "git.status git.diff"
  hub-tests: "objective, criteria and constraints survive the round trip; the target confirms the package hash; no secrets in the package"
---
# Handoff

Moves responsibility without losing context and without two writers. Hidden reasoning is never transferred: the package is.

## Inputs

- conversation and task
- for a Software Factory mission: approved spec (version, hash), current change set (hash), open findings, stage and limits

## Steps

1. Freeze scheduling; refuse while a Software Factory step of this conversation is active (pause or stop it first).
2. Reach a safe point (no active run) and reconcile processes, leases and uncertain effects.
3. Checkpoint the real file and test state.
4. Package: objective, criteria, constraints, decisions with sources, file state, tests, findings, approvals, processes, next safe action.
5. Transfer write exclusivity; never transfer write rights to a read-only route.
6. Start the target only through the execution gate with its own grant; verify `HANDOFF_ACK <id> <sha12>`.

## Outputs

- HandoffPackage (hash)
- acknowledgement check

## Verification

- [ ] objective, criteria and constraints survive the round trip
- [ ] the target names the package hash
- [ ] no secrets in the package

## Hub rules

- This skill never grants tools or permissions: the Hub uses the intersection of this skill and the assigned role.
- Codex (workspace write) and Claude (read-only on native Windows) are not interchangeable writers.
- Never commit, push, deploy, publish or send anything without an approval bound to that exact action.
