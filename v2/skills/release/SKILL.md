---
name: release
description: "Delivery preparation: assemble the delivery bundle for a verified change set, separate local acceptance from commit, push, merge and deploy, and prepare (never run) those commands. Use after QA passes."
license: Proprietary (Ifrim Digital internal use)
compatibility: Agent Skills format. Usable by Claude Code, Codex and Ifrim Agent Hub V2; tools and permissions are enforced by the Hub, not by this file.
metadata:
  hub-version: "2"
  hub-roles: "devops"
  hub-permission: EXTERNAL_ACTIONS
  hub-tools: "git.status git.diff"
  hub-tests: "bundle bound to the tested change set; no push/deploy without an approval bound to the exact command"
---
# Release (delivery preparation)

A delivery is local until the owner decides otherwise. Every external step is a separate, approved action.

## Inputs

- the QA-verified change set (hash) and its evidence
- the approved specification and its criteria statuses

## Steps

1. Check that the workspace still equals the tested change set (otherwise the bundle is STALE).
2. Assemble the bundle: spec, change set, file manifest with hashes, review, QA, preview, start instructions, limitations, proposed migration, rollback.
3. The owner accepts or rejects locally (OWNER_ACCEPTED is not RELEASED).
4. Prepare commit/tag/push/deploy commands as text; request an approval bound to each exact command.

## Outputs

- delivery bundle (Markdown + JSON with its hash)
- prepared commands (not executed)

## Verification

- [ ] bundle hash and change set hash recorded
- [ ] limitations list every unverified criterion (e2e without Playwright, manual checks)
- [ ] no push/deploy without an approval bound to the exact command

## Hub rules

- This skill never grants tools or permissions: the Hub uses the intersection of this skill and the assigned role.
- The Hub never commits, pushes, merges or deploys by itself.
- No secrets in prompts, files or outputs.
