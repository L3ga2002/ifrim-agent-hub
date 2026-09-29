# Open Issues - Ifrim Agent Hub

## Current Open Items - 2026-09-29

- HUB-018 P1: automatic Hub backup timed out before Claude admission. Local exclusion/reparse-point source fix requires final focused/full QA, independent review, exact idle-API reload and a valid complete real backup; preserve the failed partial ZIP.
- HUB-018 P1: native Claude turn and actual cancellation/browser acceptance remain unverified. Keep the execution gate suspended and do not retry until backup evidence and approval are current.
- HUB-018 P2: continuation API contract timed out at30s in a full serial run; it passed separately in24.5s. Investigate latency without masking the timeout.
- GitHub handoff: local source/tests/reports must be scanned, committed and pushed to the private Agent Hub repository; never include `.ifrim/private`, backups, `.env`, output or credentials. Verify remote state after push.
- Dependency audit: `nanoid` and `postcss` each have `high` advisories reported by `npm audit --audit-level=moderate`. This handoff is WIP, not a release. Assess supported updates and verify tests before release.


## Authoritative Checkpoint - 2026-09-29, Native Readiness Unknown

- Supersedes older PID/readiness notes below. HUB-018 is NOT operationally accepted. Isolated Gateway23596/18790 remains source-receipted; API22828/8004 replaced30808 through existing hidden supervisor4852 after SQLite leases0/runs0. Frontend3004 is Vite dev, not production preview.
- Backup backup-mululwl8-9lomtj123files0skipped and consistent isolated checkpoint2026-09-28T22-58-34.718Z integrityOK protect this work. No other project/global/vendor/Git history edits or PC restart.
- Owner full serial regression186/186 PASS and production build PASS. Reviewer source GO; independent transport QA48/48 PASS, connection classification5 persistent plus4 additional simulated checks PASS. New connection helper is now loaded by API22828.
- Native creation-only request6:dfcb6fab-d660-49f5-ad5d-949386c36410 SUCCEEDED after1780436ms (~29m40s), sessionId6273c92f-f187-48ea-a7df-a13d78f2b543, exact key agent:ifrim-backend:ifrim-hub:d79b32fc58d1542d5d5439f8edd1d8a2. runStarted:false; no agent/model submitted.
- Read-only describe/chat.metadata confirm the same session, Hub cwd, Luna/max, read-only, native Codex, user-pinned approved subscription and webSearch:false. Actual transport observer coverage confirmed:66 records/8 PIDs,8 initialize OK,7 model/list OK. These are not executed task acceptance.
- Fresh subscription certification PASS for Codex+Claude/all23 roles. A single reviewed120s existing-session ensure was stopped BEFORE send by its readiness guard: health/status omitted modelRuntime. This means UNKNOWN, not demonstrated degradation/auth failure. Official success publishes degraded:false/pendingAgents:[]; undefined projection can also follow runtime invalidation or closure. No create/agent request was sent by that ensure.
- Execution gate re-suspended; certificate evidence preserved. No reuse branch implemented: sessions.create has an official existing-session ensure path, not necessarily recreation. Do not bypass idle/binding checks, increase timeout blindly or treat omitted modelRuntime as ready.
- Remaining: diagnose why publication readiness disappears and severe cold preparation takes~30m; then one bounded Hub-native Codex turn, Claude turn, real cancellation and clicked actual Hub-session visibility. Main Luna/max chat and pure tests do not satisfy these gates. No automatic retry or API billing fallback.
- Owner, reviewer and QA evidence is in LOOP_REPORTS/2026-09-29-hub-018-finalization-plan.md. Preserve existing session/history; reconcile before any next native action.

## Current Override - 2026-09-29

- Latest override: Gateway29340 readiness is resolved; real native sessions.create still fails80420ms with codex app-server request timeout. Exact session key absent after failure; official runtime health/status ready. No model turn submitted. Fresh-home ephemeral/stdio initialize1657ms PASS only narrows the issue; actual account/runtime/session preparation remains unverified. No blind retry or vendor/global patch.
- Final owner serial171/171/build PASS; separate QA16/16 contract/BOM PASS after writer correction. Native Codex/Claude execution, cancellation and clicked Hub-session visibility remain open. Gate stays suspended.

- Native Codex acceptance57d9e6e3 failed before agent admission. Authoritative old Gateway response at00:23:57EEST: sessions.create973187ms UNAVAILABLE, Codex app-server initialize timed out CODEX_APP_SERVER_STARTUP_CANCELLED. Gate suspended; no inference retry loop.
- Clean-home binary initialize-only passed928ms, child24828 closed, no auth/model. Real backend home/runtime/catalog preparation remains unverified; login success is not task readiness.
- Diagnostic SDK startup PID19068 failed state lease heartbeat after5000ms, onlineObservedtrue/entry-not-observed. Native constant has no verified config override. Process/children/listeners are absent; lease was not deleted or disabled. Worker-preload inheritance hypothesis was disproven. SDK diagnostic bootstrap rolled back for a single controlled comparison; pure sanitizer remains staged and receipt-bound, not loaded.
- Full regression169/169 PASS and build PASS; independent focused67/67 PASS do not resolve native startup, provider turn, cancellation or clicked-session visibility. Latest comparative startup in progress; update evidence before claiming availability.

## Current operational override - 2026-09-28

- HUB-018 native acceptance blocker: sessions.create timed out120s before an agent turn was submitted. Read-only reconciliation found no Hub session, but timeout does not cancel server-side creation. Trace lifecycle/catalog/runtime preparation and reconcile before retry; no vendor edits or blind retries.
- Isolated OAuth/auth-source audits and certification now passed for all23 roles and both providers; historical expired-login and unisolated API-profile blockers below do not describe the isolated runtime. Gate is suspended because native acceptance failed, not because login failed.
- Real Codex/Claude turn, cancellation and native clicked-session visibility remain unverified despite pure tests/build passing. No uniform Astra default;6 Luna/max,13 Sol/high,4 Astra/xhigh role defaults remain.
- Global scheduled Gateway task was stopped but not permanently disabled. PC reboot auto-start risk remains. Windows mini dump establishes bugcheck0xA in nt!MiUseSlabAllocator during python.exe cached file read, not a proven third-party/root cause.

## P0

- None recorded yet.

## P1

- Gateway startup is now blocked before spawn when effective stores contain API/token/unknown-provider credentials; actual audit rejects preserved openai:manual. This is prevention, not completed subscription-runtime isolation. Do not remove credentials or restart to bypass it.
- Scheduled Windows OpenClaw Gateway task remains Ready, not disabled (Access denied; elevation cancelled). Current process is stopped, but automatic startup risk remains until administrator disable/isolation is verified.
- Native acceptance remains incomplete despite 107 owner / 22 independent pure tests passing; static legacy environment contract and API health do not prove live session creation, cancellation, recovery, visibility or billing.

- HUB-018 SAFETY STOP: installed OpenClaw setup-inference probes attempted the historical OpenAI API route (observed 403 at api.openai.com/v1/responses) outside the pinned Hub run path. Controlled Gateway stopped and subscription gate suspended; no restart/reactivation until independent ambient no-API audit. Existing API profiles were NOT deleted. Native acceptance third attempt also timed out at sessions.create after 120s. No verified native Hub turn; billing outcome unverified. OAuth device login was cancelled, not completed.

- HUB-018 acceptance: approved global role defaults are applied. OpenAI OAuth is expired (refresh 401); user reconnection is required. Claude native subscription certification passed, but acceptance has not produced a verified turn: sessions.create first rejected creation idempotency (reviewed fix applied), then timed out (latest bounded timeout 120s). Recertify after controlled Gateway restart. Real provider/model/effort evidence, cancellation/lease settlement and OpenClaw visibility remain acceptance gates. Do not present this integration as live-complete.

## P2/P3

- Reviewer P2: generic ZIP backups with skipped files are still recorded as created and can pass the backup gate (pre-existing behavior). Do not approve live GPT-6 execution until skipped-file handling and recovery evidence are hardened. This upgrade has separate complete source and consistent SQLite checkpoints; that does not fix the generic contract.
- GPT-6 OpenClaw live verification is pending. Luna Max works through Codex subagents, but this does not verify the separate bridge. Require explicit approval for any live bridge probe; keep OAuth and no-fallback metadata checks.
- Global OpenClaw and the central role registry still contain GPT-5.6 defaults. Hub overrides them per invocation; no global migration was authorized in HUB-016.
- Backup enumeration now prunes dependency/cache directories before traversing them and excludes all `.env*`. A new packet backup succeeded on 2026-09-26. Locked SQLite files still require a separate consistent SQLite checkpoint; the pre-upgrade checkpoint passed integrity checks. Failed archives are preserved.
- Claude is disabled under the current OpenAI-only policy. Re-enabling it requires an explicit new request.
- Optional: add scheduled read-only loops only when Catalin explicitly wants them; do not enable recurring model calls by default.
- Add design inspiration notes field for UI tasks, with source URL/category and no-copy rule.
