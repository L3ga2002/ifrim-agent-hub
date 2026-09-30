---
name: test-browser
description: "Exercise local preview flows in a browser at standard widths and record evidence (screenshots, console errors, pass/fail). Use for responsive and UI verification of local builds."
license: Proprietary (Ifrim Digital internal use)
compatibility: Agent Skills format. Usable by Claude Code, Codex and Ifrim Agent Hub V2; tools and permissions are enforced by the Hub, not by this file.
metadata:
  hub-version: "1"
  hub-roles: "qa"
  hub-permission: DEVELOPMENT_TOOLS
  hub-tools: "preview.check browser.inspect"
  hub-tests: "no page-level horizontal overflow at 360px; no uncaught console errors"
---
# Browser test

Exercise local preview flows in a browser at standard widths and record evidence (screenshots, console errors, pass/fail). Use for responsive and UI verification of local builds.

## Inputs

- local preview URL
- flows to check

## Steps

1. Open only local/allowed URLs
2. Exercise each flow
3. Check overflow, contrast, focus
4. Record evidence

## Outputs

- screenshots at 360/390/768/1024/1440/1920
- console errors
- pass/fail per flow

## Verification

- [ ] no page-level horizontal overflow at 360px
- [ ] no uncaught console errors

## Hub rules

- This skill never grants tools or permissions: the Hub uses the intersection of this skill and the assigned role.
- No secrets in prompts, files or outputs. No paid API routes, credits or fallbacks.
- Never commit, push, deploy, publish or send anything without an approval bound to that exact action.
- Completion requires evidence (tests, independent review/QA or recorded manual verification).
