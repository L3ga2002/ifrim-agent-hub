# HUB-016 - GPT-6 OpenAI-Only Adaptive Routing

## Header

- Started: 2026-09-26; final local verification: 2026-09-27 (Europe/Bucharest).
- Active project: Ifrim Agent Hub.
- Path: `C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\Ifrim Agent Hub`.
- Mode: assisted-fix; Codex coordinator.
- Owner role: ifrim-backend, implemented by the coordinating Codex session.
- Independent reviewer role: ifrim-reviewer, GPT-6 Luna/max subagent Pascal.
- QA role: ifrim-qa, GPT-6 Luna/max subagent Socrates plus coordinator integration/API/browser checks.
- Runtime audit: GPT-6 Luna/max subagent Ramanujan, read-only.
- Claude: disabled by Catalin's OpenAI-only request. No OpenClaw model call was started.

## Product And Scope

The Hub remains the local control plane for task packets, locks, approvals and continuity. This change configures GPT-6 locally in the Hub, preserves OAuth/Codex and existing project boundaries, and separates model choice from reasoning effort. It does not migrate global OpenClaw settings or certify live GPT-6 bridge execution.

User clarification is authoritative: Luna keeps its explicit max preference; Sol/Astra use low, medium, high or xhigh according to task complexity. Max/ultra on Sol/Astra require an explicit request. Merely choosing Astra does not imply maximum reasoning.

## Backup And History

- Pre-change source checkpoint: `.ifrim/BACKUPS/2026-09-26-pre-gpt6-source.zip`, 74 entries, SHA256 `8E672678650A6E0C37F825B768994D3A94687F237B920DCD57C6F9056A8B17A5`.
- Separate consistent SQLite checkpoint: `.ifrim/BACKUPS/2026-09-26-pre-gpt6.sqlite`; integrity check OK.
- Failed initial automatic archive was preserved, not deleted. Subsequent backup enumeration succeeded after pruning excluded directories before traversal.
- Policy-v2 checkpoint packet: `run-muiwe4gm-eqkd6f`, Astra/xhigh, no approval or launch. It is preserved as obsolete after the final v3 bump; future execution needs a fresh v3 packet and approval.
- Packet backup: `.ifrim/BACKUPS/2026-09-26T21-24-38-038Z-backup-muiwe4gm-garysp.zip`.
- Comparing the live database with the pre-change checkpoint found zero missing or changed historical rows across tasks, locks, events, runs, backups, drafts, snapshots, approvals, attempts and workflow transitions. Only this task's appended coordination records were added.
- Existing dirty HUB-015 continuation changes were preserved. No commit, push, deployment or Git-history change.

## Owner Findings And Changes

- Central role defaults and global OpenClaw still referenced GPT-5.6. The Hub now applies its own versioned `gpt6-openai-adaptive-v3` policy and explicit model/effort flags without changing those shared files.
- All 23 roles are visible. Directory columns identify routine defaults separately from the global runtime configuration; old entitlement evidence is not presented as GPT-6 verification.
- Task risk, not an agent's name or compiler actor metadata, selects model escalation. Effort is selected independently, including medium for intermediate validation/local work.
- Standalone `Model:` and `Reasoning:`/`Rationament:` lines in task title/goal support explicit requests. Incidental words and compiler-generated directives do not authorize max/ultra.
- Packet validation binds each command to its agent and exact model/effort selection. Runner/compiler results must report the expected OpenAI model, Codex harness, reasoning and no fallback.
- Obsolete workflow packets refresh additively under the latest obsolete child, keep the stage/cycle and historical rows, require a fresh backup and approval, and do not launch automatically.
- Backup enumeration now prunes dependency/cache directories before traversal, excludes `.env*` files/directories, and preserves OneDrive source files instead of skipping all reparse points.
- Local CLI discovery resolves the installed OpenClaw shim and compatible Node 24 path. Claude commands/diagnostics and the Hub-local review wrapper are disabled.

## Independent Reviewer

Found and repaired during review:

- Stale retry child reuse that prevented migration to the current packet policy.
- Multiline PowerShell fallback flags bypassing last-line-only validation.
- Routine task escalation caused by role/compiler actor names.
- `.env*` directory traversal in the backup script.
- Command selections not bound to their corresponding agent/model/effort.
- Reasoning/model directives accepting a value from the next line.
- Retry requiring an already-valid old backup before it could create a new one.
- Current-policy children reused with missing/failed backup metadata; they are now preserved but skipped when selecting a reusable child.
- Policy version bumped after adding automatic medium so saved packets cannot retain earlier effort defaults.

Open P2, pre-existing in HEAD: partial ZIP backups with skipped files are still recorded as created and may pass the generic gate. This task has a separate consistent SQLite checkpoint and source checkpoint, but that does not repair the generic recovery contract. Harden partial-backup handling before approving live GPT-6 execution; do not claim the generic backup gate guarantees a complete recoverable snapshot.

## QA Evidence

- Full suite after final review fixes: `node --test tests/*.test.mjs`, 81/81 PASS, no skips.
- Build: Vite production build PASS.
- Read-only live API contracts: directory/current policy, cross-project routing previews with unchanged task rows, continuation selection contract PASS.
- Isolated workflow API test: a legacy failed/missing backup plus obsolete child refreshes to one current child; a repeated retry reuses it; old rows remain identical; no approvals/executions are created; test-mode launch is blocked.
- Backup archive test: API and frontend sources included; `.env*`, node_modules and tmp excluded. Test database/process isolated from the real Hub and stopped in finally. Fixtures were preserved.
- Browser: desktop 1440x960 and mobile 390x844; 23 rows, no document overflow, zero page errors. Table has intentional internal horizontal scrolling on mobile.
- Screenshots: `output/playwright/hub-gpt6-final-desktop.png` and `output/playwright/hub-gpt6-final-mobile.png`.
- Preview: http://127.0.0.1:3004; API: http://127.0.0.1:8004/api/.
- SQLite integrity check: OK. The pre-existing 23 tasks, 51 runs, 40 approvals, 80 attempts and 34 workflow transitions were preserved.

## Runtime Limits And Next Task

- GPT-6 Luna/max worked through Codex-native subagents. That is separate from OpenClaw bridge verification.
- Local OpenClaw 2026.7.1, Node 24.16.0 and configured Codex CLI 0.158.0-alpha.2.1 were inspected. No global configuration was changed.
- The installed explicit-model resolver uses an empty fallback chain; result metadata is additionally validated fail-closed. This is code/fixture evidence, not a new GPT-6 OpenClaw probe.
- Next: harden partial-backup recovery, then request approval for a narrowly scoped read-only GPT-6 OpenClaw probe with explicit model/effort and no fallback. Owner ifrim-backend, independent reviewer ifrim-reviewer, QA ifrim-qa.
- Do not start a paid/external probe, modify another project, commit, push, deploy or send messages automatically.
- Configuration and local verification are complete. Live bridge acceptance remains pending; HUB-016 is blocked at QA/acceptance, not represented as an end-to-end verified runtime upgrade. The implementation lock is released; no background agent work remains after closeout.
