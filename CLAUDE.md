# IfrimDigital Ifrim Agent Hub - Claude Code Context

## V2 - 2026-09-30

V2 is in `v2/` (see `.ifrim/OPUS_HANDOFF.md` → V2 section and `.ifrim/RUNBOOK.md`). It runs on 127.0.0.1:8011 and starts in BUILD_SAFE. Tests: `npm run test:v2` (no models). Milestone 01 (2026-09-30, version `2.1.0-m01`, commit `f31240b`) added the company runtime, execution surfaces, command bus, approval policy, router, schedules, skills and the OpenAI/Anthropic audit (`v2/config/ecosystem/*.json` → `node v2/scripts/gen-ecosystem-docs.mjs` → `.ifrim/V2_*`). Milestone 02 (commit `0fb71d2`) added the JARVIS experience and security readiness; the Lega voice assistant followed (`30bfbef`, `dac2db4`, `ce819b9`, `bbe8757`; see `.ifrim/LEGA.md`). Milestone 03 (2026-10-01, version `2.4.0-m03`, committed on `v2-milestone-01` on 2026-10-01 at the owner's request (the commit right after `6432c5e`; push: see `git status`/GitHub); `main` is still `e9ab563`) added runtime readiness (explicit model/effort per run, a phase timeline, the R2 host-isolation and run-plan gate checks, R3 deny entries) and the Software Factory in `v2/server/factory/` (spec → plan → Codex writer → Hub runner through `codex sandbox` → read-only Claude review → bounded repair → QA → preview → delivery bundle); see `.ifrim/M03_REPORT.md`. R2 is open. Live 2026-10-01 (owner-approved): probe 2.1 PASS_LIVE (Codex gpt-6.1-sol · medium fixed Demo A through the factory; turn → first command 14 s) and probe 2.2 PASS_LIVE (Claude review with an explicit `sonnet` after the account default `fable[1m]` was refused before the model; PASS, QA 2/2, bundle `bnd_mupj3diq_d386324921` awaiting the owner's acceptance). Closure probes on 2026-10-01 evening (owner-approved, owner clicks): 2.3 PASS_LIVE (Demo B through one real repair cycle to E2E PASS, bundle `bnd_mupwze7b_e03f70f2d7` awaiting the owner; the first writer turn changed nothing because the Windows sandbox needed 145 s for its first command after a reboot), 2.5 PASS_LIVE (Stop during a real turn, stopped in 11.2 s, nothing left), 2.6 PASS_LIVE (Lega proposed `mis_mupy0no5_922d2614b0`, the owner clicked, SPEC_DRAFT, 0 runs); Demo A accepted by the owner. R2: the dedicated WSL2 distro `ifrim-runner` is installed and its canary passes 40/40 (`v2/tests/manual/r2-wsl-canary.mjs`); R2 stays open until the Hub `wsl-runner`, the gate change and a live probe through it. See `.ifrim/M03_CLOSURE_RESULTS.md`. Before the commit, three read-only multi-agent verification rounds found and fixed real defects (pause/stop/resume state machine, browser E2E), each with a regression test and a mutation check (`.ifrim/M03_TEST_REPORT.md` §6). On 2026-10-01 the owner re-consented to the R3 deny list (`0f5b7efee0143fa8`) and saved `model/list` in the UI; Playwright 1.61.0 is installed (no browser download) and the factory runs browser E2E on the verified preview. The first live probe (2.1, Codex RW via the factory on Demo A) needs the exact approval text in `.ifrim/M03_LIVE_VALIDATION_PLAN.md` §2.1. Milestone 04 (2026-10-01, version `2.5.0-m04`, committed as `2301dcd` on `v2-milestone-01`, not pushed) added the Sales department in `v2/server/sales/` (import → identity → provenance → fixture audit → qualification → opportunity → proposal → contact draft → owner decision → Software Factory SPEC_DRAFT), verified only on synthetic data; outreach and live collection are disabled and the catalog starts empty; see `.ifrim/M04_REPORT.md`. Live validation on the sanitized test project (2026-09-30): Claude Code read-only PASS_LIVE; Codex FAIL at 14:41 (thread/start timeout, fixed in `30bfbef`), then PASS_LIVE twice (workspace-write and read-only); Lega voice PASS_LIVE. Every Hub Codex process runs with plugins off and every MCP server of the owner's config disabled by name (checked before the turn); Claude runs stop before the model if init reports an MCP server. Hub runs of Claude Code refuse Fable models and load only user settings (`--setting-sources user`); do not loosen the billing guards in `v2/server/policy/billing.mjs` or `v2/server/providers/claude.mjs`. Never start a model, open the execution gate, create live grants, commit, push or deploy without the user's explicit approval for that exact action. V1 files (`src/`, `apps/api/`, `tools/`, `tests/`) are kept and still serve V1 on 3004/8004; do not delete them without approval.

## Current Handoff - 2026-09-29

Read `.ifrim/OPUS_HANDOFF.md` first, then the project memory and current Git/SQLite state. HUB-018 remains in progress: native Codex passed, but Claude acceptance and cancellation did not. The last Claude request failed before model admission at the backup gate; the execution gate is suspended. A backup-filter correction is in the local source but requires final review, an idle-API reload and a complete real backup before any new execution. Treat the older notes below as historical when they conflict with current evidence. This handoff alone does not authorize a model launch, data deletion, commit, push or deployment.

## Active Override - 2026-09-27

Catalin approved Claude Code as a local worker in the Agent Hub unified conversation runtime. The 2026-09-26 disabled note below is historical for the existing OpenClaw packet route. Work only in the selected Agent Hub workspace after Hub backup/lease checks. Never read or send secrets, modify another project, commit, push, deploy, delete important data, or send external messages without a separate explicit request. On handoff, inspect current Git state and continue rather than restarting.

## Disabled - 2026-09-26

Catalin selected OpenAI-only operation for this project. Do not invoke Claude. This file is retained as historical context; active routing is in `.ifrim/MODEL_POLICY.md`.

You are assisting Codex as an external senior engineering specialist for the IfrimDigital Ifrim Agent Hub project.

Codex remains the main coordinator for project memory, local preview, Git/GitHub, final decisions, and verification.

Read first:

- .ifrim/NEXT_SESSION.md
- .ifrim/PROJECT_STATE.md
- .ifrim/OPEN_ISSUES.md
- .ifrim/AGENTS.md
- .ifrim/OPENCLAW.md
- .ifrim/AGENT_HUB_RULES.md

Rules:

- Before any implementation task, do not implement as a demo. Implement as a real production feature, with validations, edge cases, error handling, loading states, duplicate-request protection, useful logs, and without breaking existing flows.
- Do not introduce external-builder branding.
- Do not read, print, summarize, copy, or modify secret files.
- Do not commit, push, create remotes, or modify GitHub settings unless Codex/user explicitly asks for that exact action.
- For review-only tasks, do not edit files.

Model policy:

- sonnet: normal coding and review
- opus: security, architecture, deep debugging
- haiku: simple summaries and log triage
- fable: hardest long-running investigations only
