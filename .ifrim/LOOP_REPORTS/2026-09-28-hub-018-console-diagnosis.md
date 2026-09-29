# HUB-018 - Native runtime and console diagnosis

## Latest finding and containment - 21:47 local

The initial cmd.exe-only snapshot below was insufficient. At21:42:11/21:42:42 Gateway29248 spawned23 managed codex.exe app-server children and23 new OpenConsole hosts. Native logs show cold session-catalog producers acquiring clients in the same interval. This establishes the parent of the new process burst; the exact initiating UI request and causal link to the earlier Windows crash are NOT established.

Read-only Hub SQL confirmed running/blocked provider custody0. Suspended the gate, stopped only the identity-verified isolated Gateway, and verified all owned children absent. First stop attempt correctly refused a date-string comparison; corrected exact datetime identity matched. After parent stop, a child exited between CIM and Stop-Process; second reconciliation verified absence rather than stopping unrelated PIDs. Final21:47:53: Gateway absent, children0,18790 listeners0, Desktop Codex14916 alive. No task, other project, credentials, transcript or Windows system setting removed.

Independent maintenance QA10/10 PASS, initial shared-lock race closed. Remaining P2: acquisition write failure needs handle/lock cleanup; startup must verify physical state boundary before lock creation. Gateway stays OFF and subscription gate SUSPENDED until those source issues and native catalogue fan-out/hidden launches are resolved. Auth certification earlier in this report is historical evidence, not current authorization or functional acceptance.


## Scope and protection

Hub only. Owner ifrim-backend; independent reviewer and QA. Backup backup-mulka6sa-16465p, isolated checkpoint2026-09-28T18-09-06.513Z, original command config checkpoint supported-codex-1790619703467. No data deletion, Git history change, commit/push/deploy, provider API activation, vendor patch or external message.

## Owner findings

- Prior creation failed finally after711744ms: model/list timed out, queue wait0ms. Native rolling log: AppData/Local/Temp/openclaw/openclaw-2026-09-28.log. Model turn was not submitted. Native list was reconciled before retry preparation.
- Isolated native command changed from Desktop alpha0.158.0-alpha.2.1 to already installed managed0.155.1. This tests an incompatibility hypothesis; it is not yet proof of repair.
- Controlled stop: verified prior PID6360/start/executable/command/port/config digest, no active Hub custody,46 owned idle children. All captured children were rechecked by PID/creation date/parent/executable. Subsequent parent/child/listener checks were empty.
- New isolated startup PID29248/port18790, start2026-09-28T18:23:44.6133739Z. Native schema audit PASS; actual fresh subscription certificate Codex+Claude/all23 roles/no failures. Dynamic account model discovery remains enabled, homeScope agent, no fallback, no uniform Astra route. Certification is not an executed model result.
- Catalin then requested investigation of numerous blank console windows. No new model probes were launched.12 CMD processes were stable in repeated snapshots. Five are direct children of Desktop Codex14916 and run the installed codex-app-tools MCP launcher. The launcher itself executes its Node server, not an agent task.
- Other console startup sources include global gateway-visible.cmd, n8n, opportunity-monitor and DisplayFusion launcher. They were observed only, not modified or terminated.
- The isolated Gateway has one readonly SQLite worker23348. Its official spawnOptions do not set windowsHide. A conhost child and OpenConsole appeared at the worker's launch time21:25 local. This is a concrete hiding omission, but the exact attribution of every visible screenshot window remains unverified.
- Free memory snapshot14176996KiB (~13.5GiB). No evidence that CMD windows caused the Windows bugcheck; prior local mini dump points to AV_nt!MiUseSlabAllocator during python.exe NtReadFile/NTFS cached read, without a proven third-party culprit.

## Review and QA

- Reviewer approved exact isolated managed-command selection with fail-closed process identity checks. QA found initial maintenance/start/certification race; owner added common exclusive maintenance.lock across all three tools, plus pre-replacement gate/process/listener rechecks.
- Fresh focused authentication/gate/certification tests10/10 PASS. Node syntax for selection/certification and PowerShell startup parser PASS. Additional independent maintenance QA is pending when this report is first saved.
- No browser/UI acceptance or model/cancellation acceptance claimed in this report. Remaining work is source QA, safe hidden-child launch handling, bounded native turns and actual session visibility.

## Safety

Do not terminate all CMD, Node, Codex or WindowsTerminal processes. Desktop MCP processes support active chats/tools; unrelated services are outside Hub scope. No restart or driver repair was initiated. Do not claim HUB-018 done or repeat creation blindly without fresh native reconciliation.
