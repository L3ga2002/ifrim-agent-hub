---
name: site-premium
description: "Build a premium website from a client brief: structure, design tokens, implementation, responsive and accessibility verification. Use for new client sites."
license: Proprietary (Ifrim Digital internal use)
compatibility: Agent Skills format. Usable by Claude Code, Codex and Ifrim Agent Hub V2; tools and permissions are enforced by the Hub, not by this file.
metadata:
  hub-version: "1"
  hub-roles: "planner design frontend qa"
  hub-permission: WORKSPACE_EDIT
  hub-tools: "files.read files.edit process.build preview.check"
  hub-tests: "no fictional testimonials; responsive widths verified"
---
# Premium site

Build a premium website from a client brief: structure, design tokens, implementation, responsive and accessibility verification. Use for new client sites.

## Inputs

- client brief
- content provided by the client

## Steps

1. Brief and structure
2. Design direction and tokens
3. Implementation
4. Responsive and accessibility verification

## Outputs

- structure
- design tokens
- implementation
- responsive verification

## Verification

- [ ] no fictional testimonials
- [ ] responsive widths verified

## Hub rules

- This skill never grants tools or permissions: the Hub uses the intersection of this skill and the assigned role.
- No secrets in prompts, files or outputs. No paid API routes, credits or fallbacks.
- Never commit, push, deploy, publish or send anything without an approval bound to that exact action.
- Completion requires evidence (tests, independent review/QA or recorded manual verification).
