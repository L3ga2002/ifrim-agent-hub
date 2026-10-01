---
name: debug
description: "Bugfix procedure (Software Factory BUGFIX): reproduce with the independent acceptance test failing first, find the root cause with evidence, add a regression test and apply the minimal sufficient fix. Use for defects in an Ifrim Digital project."
license: Proprietary (Ifrim Digital internal use)
compatibility: Agent Skills format. Usable by Claude Code, Codex and Ifrim Agent Hub V2; tools and permissions are enforced by the Hub, not by this file.
metadata:
  hub-version: "2"
  hub-roles: "backend frontend qa"
  hub-permission: WORKSPACE_EDIT
  hub-tools: "files.read files.edit process.test git.diff"
  hub-tests: "the protected acceptance test fails before the fix and passes after it; a regression test was added; no unrelated files changed"
---
# Debug (BUGFIX)

Reproduce, explain and fix a defect with evidence. The acceptance criteria are fixed before the fix and are not relaxed.

## Inputs

- the approved specification: symptom, expected behaviour, acceptance criteria, protected acceptance test(s)
- the baseline evidence from the Hub runner (the acceptance test failing for the expected reason)

## Steps

1. Read the failing acceptance test and the code it exercises; reproduce locally without models when possible.
2. Form hypotheses and test them one by one; record the root cause with the line that proves it.
3. Add a regression test that fails on the old code and passes on the new code (a new file; never edit the protected test).
4. Apply the minimal fix that removes the cause, not the symptom.
5. Run the relevant suite and report the exact commands and results; the Hub runner verifies them again independently.

## Outputs

- root cause with evidence
- the fix (files changed)
- regression test
- report of what was verified and what remains uncertain

## Verification

- [ ] protected acceptance test unchanged, failing before and passing after
- [ ] regression test present
- [ ] no skip/only, empty catch or disabled lint added

## Hub rules

- This skill never grants tools or permissions: the Hub uses the intersection of this skill and the assigned role.
- No new dependencies, installs, external services or real databases. Never edit .codex/, .claude/, .mcp.json, AGENTS.md or CLAUDE.md.
- Never commit, push, deploy, publish or send anything without an approval bound to that exact action.
- Completion requires evidence (tests, independent review/QA or recorded manual verification).
