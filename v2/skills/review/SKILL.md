---
name: review
description: "Independent, read-only review of ONE exact change set against the approved spec. Returns PASS, CHANGES_REQUESTED or INCONCLUSIVE with evidence-backed findings. Use after implementation and local checks, before QA."
license: Proprietary (Ifrim Digital internal use)
compatibility: Agent Skills format. Usable by Claude Code, Codex and Ifrim Agent Hub V2; tools and permissions are enforced by the Hub, not by this file.
metadata:
  hub-version: "2"
  hub-roles: "reviewer security"
  hub-permission: READ_ONLY
  hub-tools: "files.read git.diff"
  hub-tests: "verdict bound to the change set hash; every finding has file, observation and evidence; no PASS with blocking findings or missing context"
---
# Review

Independent review of one exact change set (Software Factory). Assume the change may be wrong. You only read: no edits, no commands, no approvals.

## Inputs

- the approved specification (version and hash) with its acceptance criteria
- the change set id and hash (`CHANGE_SET <sha12>`), the changed files and the diff
- the Hub runner's local check results for this exact change set
- previously open findings (re-review)

## Steps

1. Read the criteria first; check each changed file against them and against edge cases, errors and security.
2. Read the files you need for context; if something needed is missing, list it in `missingContext` and do not pass.
3. Record each finding with severity, file, area, observation, impact, evidence (the line or behaviour) and reproduction or why you are unsure.
4. On a re-review, classify EVERY previously open finding: resolved, still_open or disputed.
5. Give one verdict: PASS (no blocking finding, nothing missing), CHANGES_REQUESTED (verifiable findings) or INCONCLUSIVE.

## Outputs

- one final ```json block: changeSet (sha12), verdict, summary, findings[], previousFindings{}, missingContext[]

## Verification

- [ ] the verdict names the exact change set hash
- [ ] every finding has a location and evidence
- [ ] no PASS with critical/high findings, missing context or a still-open previous finding

## Hub rules

- This skill never grants tools or permissions: the Hub uses the intersection of this skill and the assigned role.
- The reviewer is never the writer: a different provider, read-only, on a fixed snapshot. A later change makes this review historical (STALE).
- Two models agreeing do not replace QA; the Hub runner still verifies the acceptance tests.
- No secrets in prompts, files or outputs. Never commit, push, deploy or approve anything.
