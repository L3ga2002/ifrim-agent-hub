# HUB-018 - OpenClaw provider visibility

Date: 2026-09-28
Project: Ifrim Agent Hub only
Status: approved global configuration applied; local implementation verified; native acceptance BLOCKED, safety stop

## OAuth reconnection completed (supersedes expired-login blocker only for backend's new profile)

- Catalin confirmed ifrimcatalin30@gmail.com as his account with remaining usage, completed device-code login and Keep current restrictions; exit code0 and login process ended.
- Owner plus independent reviewer verified actual profile email/type/provider, reported plan prolite and expiry2026-10-08T12:48:06.210Z. Credential owner is local ifrim-backend; effective ifrim-qa and ifrim-reviewer stores lack it. Old profile preserved; source runtime pin is still old. Availability/usage is user-reported, not inferred from auth success.
- Global config structurally unchanged against checkpoint login-catalin30-2026-09-28T12-41-58.923Z, including roles 6Luna/13Sol/4Astra. No models started. Gateway remains stopped and gate suspended. Account-routing/isolation/session acceptance are still incomplete; do not claim team-wide reconnection.


## Final local closeout (supersedes earlier test counts)

- Owner: implemented pre-spawn effective-profile audit, refusing API keys, tokens, unknown OAuth providers and custom API providers without deleting data. Actual read-only auditor refuses preserved openai:manual. Both legacy launch/compiler now require gate before writes and use receipt-bound executable, entrypoint and environment; no inherited process.env or shell shim.
- Reviewer: independent source-only GO for final legacy environment correction; independently confirmed startup auditor rejects the actual API profile. No operational no-API guarantee or native success claimed.
- QA: owner regression 107/107 PASS (workflow-refresh-api.test.mjs excluded for outside-project fixture writes); independent QA 22/22 pure PASS (gate 2, auth 5, provider 13, config 2); build PASS, diff check PASS. Legacy launcher contract is static, not an actual launch. Hub API reloaded after zero active provider/execution runs and leases.
- Safety backup backup-mul369op-pelx7k: 93 files, zero skipped. Final implementation lock LOCK-mul3gtbk-mp01ls released at closeout. HUB-018 remains blocked in SQLite.
- Windows scheduled OpenClaw Gateway task remains Ready, not disabled. Disable returned Access denied and the elevation attempt did not complete and was cancelled. Current Gateway remains stopped; Windows restart/autostart is still a residual risk requiring administrator action and verification.
- Native completion is still blocked by unsafe ambient API credential availability, expired OpenAI OAuth (401 refresh), and sessions.create timeout (120s). No verified Hub model turn/deep-link/cancel/recovery result exists. Official device auth was cancelled, not completed. No further model invocation or Gateway restart performed during final local closeout.


## Final safety stop

- Third read-only Hub acceptance attempt provider-run-5983aafd-3102-4f2c-8ac2-3341c8faf064 failed with sessions.create timeout at 120 seconds. No verified Hub agent turn/model/effort result exists. All Hub runs are terminal and leases zero.
- Gateway logs independently exposed setup-inference incognito probes for configured agents attempting https://api.openai.com/v1/responses, including GPT-6 Sol with 403 model-access rejection. These were not submitted by the Hub agent RPC. Exact initiating surface is still under audit; do not infer that cron isolation suppresses setup probes. Existing stored API profile fallback is a residual ambient-runtime risk. Do not claim zero API attempts or confirmed zero billing.
- Stopped only our controlled Gateway PID20020 and its children. Source/config/history/credentials preserved. Subscription certificate status changed to suspended while retaining evidence; no fabricated approval. Existing scheduled Gateway service remains stopped. Hub API/frontend stay running, with launches failing closed.
- Official OpenAI device login cancelled; OAuth was not reauthenticated. Prior transient code is not stored here and must not be reused as a continuation instruction.
- HUB-018 blocked in SQLite with all three blockers; implementation lock LOCK-mul0g0b8-o6zrsa released after zero runs/leases confirmation. Final owner regression 105/105 PASS, build PASS, diff check PASS. Independent final pure QA 20/20 PASS. Desktop/mobile browser: one correct conversation panel, selected provider/model/effort visible; width390/pageWidth375, no page overflow. OpenClaw browser displays GPT-6 role defaults and native session catalogs, but Hub session/deep-link/cancel/recovery acceptance remains incomplete.
- Next safe work: identify and disable or subscription-pin the official setup-inference route without deleting credential/history data, independently review that boundary, then reauthenticate OpenAI and rerun bounded acceptance. Do not restart the unsafe Gateway just to make the UI look operational.

## Activation follow-up (supersedes historical activation status below)

### Owner - ifrim-backend responsibility, Codex coordinator

- Approved official config.patch applied to all 23 OpenClaw entries: 6 Luna/max, 13 Sol/high, 4 Astra/xhigh; all fallback lists empty. Global historical default outside these overrides preserved. API directory: 23 configured, zero drift. Task model/effort selection remains adaptive and Sol/Astra max/ultra remains explicitly authorized only.
- Fresh backup backup-mul0g0e2-qtaq17: 88 files, zero skipped; SQLite checkpoints 08-52-24-056Z and 08-56-00-166Z passed integrity checks. Original global config retained privately with SHA abe925442b6b590ec34d0656a91454932910bfd3aca6cc2fbd7cadb54d929e8b.
- Controlled Gateway launch has a cleared/allowlisted environment, native Claude binary first on PATH, OPENCLAW_SKIP_CRON=1, executable/entrypoint/config hashes and PID/start-time receipt. Existing schedules, transcripts, client workspaces and credentials were not deleted. Scheduled-task startup has not been certified; every Gateway restart invalidates the subscription gate.
- Certification validates actual native Claude auth status (claude.ai, firstParty, Max), no API helper/settings overrides, exact native executable resolution, installed runtime fingerprints and effective Gateway environment. Codex reads effective per-agent/shared OAuth through the installed SDK with that same environment. Explicit profile binding must be user-pinned.
- Official OpenAI OAuth refresh returned 401. No successful refresh was persisted; the refresh helper now resolves the original credential owner before calling the provider and uses CAS with the correct shared/local transaction. Do not rerun against the rejected credential. Official device login awaits Catalin; codes and tokens are not stored in this report.
- Acceptance conversation: conversation-b6c7f066-fc77-4c14-9674-7683203cf24b, task HUB-018, requested Claude / anthropic/claude-sonnet-5 / medium / read-only. Attempt provider-run-1e409887-573d-46d9-8395-882d7973b104 rejected session creation idempotency before an agent turn; the reviewed fix removes ONLY creation idempotency, preserving deterministic session binding and agent-run idempotency. Attempt provider-run-1d133d99-efd2-4238-b742-7bcec3f3db9c timed out during sessions.create. A final bounded 120-second attempt is being observed; no successful native execution is claimed yet.
- Fixed unique conversation project keys; browser confirms one correct Hub conversation panel after switching from another project. Role defaults/model/provider/effort/transport are visible. Repository dirty files are no longer falsely assigned as files changed by the provider; missing provider file attribution remains unknown.
- Final owner regression: 105/105 PASS. Historical workflow-refresh-api.test.mjs excluded because its fixture writes outside the project; it is not counted as passed. Vite build PASS. Existing dirty Git checkout preserved.

### Independent Reviewer - Bernoulli, ifrim-reviewer

- Found and corrected six initial P1 defects: receipt listener identity, config certification race, Claude environment/executable origin, user-source auth pin, effective Codex agent-store lookup, and refresh persistence/import/CAS.
- Follow-up corrected shared credential owner before refresh and passed receipt environment to both Codex resolver and load functions. Final source acceptance: no remaining P1 in the audited fixes, 16 pure tests passed.
- Accepted removal of only sessions.create idempotency after the actual principal error; 13 pure tests passed. Explicit caution: operator.admin can change existing selection, so deterministic keys and strict returned binding remain mandatory.
- Acceptance is source-only; no independent native auth/run/restart claim.

### Independent QA - Arendt, ifrim-qa

- Final persisted pure tests: 20/20 PASS, zero fail/skipped. Wrong profile, auto/absent auth source and missing Gateway environment are rejected before any agent turn/credential read.
- Additional in-memory negative binding cases and receipt rejections passed earlier; those checks are not substitutes for native acceptance.
- Verified static latest timeout 120s, OPENCLAW_SKIP_CRON=1 and unique conversation key. Zero confirmed defects in executed scope. Full 105 owner regression/build/browser evidence not independently rerun by this QA.
- Native provider result, no-API-billing execution evidence, real cancellation/lease settlement, restart recovery and Hub-to-OpenClaw deep link remain acceptance gates.

## Historical local implementation report

## Checkpoint

- Source backup: `.ifrim/BACKUPS/2026-09-28T07-08-45-888Z-backup-mukwp682-cry9uc.zip`, 76 files, zero skipped files, private runtime excluded.
- SQLite: `.ifrim/BACKUPS/hub-018-2026-09-28T07-20-22-717Z.sqlite`, integrity_check OK.
- Global config privately backed up under `C:/Users/mihai/AppData/Local/IfrimDigital/OpenClawBackups/hub-018-2026-09-28T07-20-22-717Z`; SHA256 abe925442b6b590ec34d0656a91454932910bfd3aca6cc2fbd7cadb54d929e8b. Contains secrets: do not publish.
- Existing dirty checkout preserved; no commit/push/deploy or client-project source edits.

## Owner (Codex, ifrim-backend responsibility)

- Found direct Codex/Claude workers bypassing OpenClaw; provider/model/reasoning previously static in the UI.
- Added authenticated loopback Gateway client and session-first execution with exact project workspace, permission, runtime, model and reasoning binding.
- Disabled automatic provider fallback; deliver=false, disableMessageTool=true, webSearch=false.
- Added model/effort/access selectors and route preview; requested and verified execution metadata are separate. Historic runs do not gain invented OpenClaw sessions or metadata.
- Added cancellation during backup/preparation and gateway abort. Lost submitted requests, unconfirmed abort or unknown liveness retain the lease.
- Added subscription-only activation gate tied to current local config SHA, gateway revision, native-auth evidence and 24-hour freshness. No certificate was fabricated; launches remain disabled.
- Updated keyed-agent config reading for OpenClaw 2026.9.6 while preserving legacy-list compatibility.
- Source generator now builds role-based GPT6 defaults with no fallback. Application tool rejects stale or altered candidates.

## Independent Reviewer (Codex subagent Hegel, ifrim-reviewer)

- Initial verdict NO-GO: pre-execution billing/auth gate missing, unknown liveness released lease, binding did not verify effective workspace/permissions, local startup catch could release a live worker lease, idempotency conflicted with model changes, Claude trace alias mismatch, Auto-provider UI model mismatch.
- Fixes: preflight before connection/run creation, effective returned session binding, terminal/liveness checks, stop-before-release in startup catch, per-run idempotency, model/effort session isolation, explicit native Claude alias, resolved-provider UI handling.
- Further source-contract fix: sessions.create persists agentRuntimeOverride; binding now uses that field, not invented agentHarnessId. Returned execution still verifies agentHarnessId.
- Config consistency fix: connect uses the certified snapshot; Gateway config.get must be valid, match the certified hash and report nonempty identical configRevisionHash/appliedConfigHash before session creation. Stale/missing applied config cannot admit a session.
- Final independent fix audit: no additional defects found in the last strict fix; 13/13 pure tests PASS. Local fix accepted; live activation not accepted.
- Native auth/noAPIbilling remains unverified and live acceptance is not approved.

## Independent QA (Codex subagent Linnaeus, ifrim-qa)

- Initial independent run: 92/92 tests, 12/13 files; excluded historical workflow-refresh-api because its fixture/backup escapes .ifrim/tmp.
- Final focused independent run: 15/15 pure tests PASS, no API/model calls or writes by QA. Hashes unchanged during QA.
- Owner final regression: 100/100 tests PASS excluding workflow-refresh-api; Vite build PASS. One historical test is deliberately outside this final regression, not silently counted as a pass.
- Browser: isolated QA at 3005/8005 with test DB, adaptive/explicit Astra low route and read-only mode checked; 390px viewport had scrollWidth=clientWidth=375; launch blocked in test mode; console error log empty. Temporary services stopped.
- Real Hub API reloaded through existing tray after confirming zero active runs/leases; health returned OK. Real page at 3004 showed new model/effort/access controls, requested route and honest historical process metadata. No provider launched.
- Final live UI preflight: absent subscription certificate was displayed and Run was disabled before backup/run creation. HUB-018 task status is blocked; implementation lock LOCK-mukwu5m3-jdvoop was released. Source and private database history retained.
- Mocks and local UI do NOT prove native subscription authentication, actual Gateway model compatibility, native continuation, real abort settlement or session deep-link navigation.

## Approval / activation limits

- Auto-review rejected the first uniform Luna/max global patch before execution. No patch was applied and the rejection was not bypassed.
- Final global config SHA remains ABE925442B6B590EC34D0656A91454932910BFD3ACA6CC2FBD7CADB54D929E8B, identical to the original checkpoint.
- Corrected role candidate is code only; private old candidates are stale. A pending question asks Catalin to choose adaptive defaults plus Claude subscription, or preserve global defaults.
- Official CLI dry-run was cancelled after prolonged repeated native catalog validation; it produced no successful global validation result. SDK read-only connection/sessions.list succeeded; that proves Gateway access only.
- Next: approval, fresh candidate/checkpoint, official validation, subscription-only auth evidence, certified gate, bounded native read-only probes, real cancel/recovery QA and final reviewer acceptance. Keep HUB-018 not-done until these gates pass.
