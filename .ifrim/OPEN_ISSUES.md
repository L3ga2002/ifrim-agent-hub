# Open Issues - Ifrim Agent Hub

## Milestone 02 Open Items - 2026-09-30 (supersede the items below where they overlap)

- M02-LIVE (P1): Claude read-only PASS_LIVE on the sanitized test project (2026-09-30, run `run_muo6i9og_50c329673c`). Codex pending: the Claude Code auto-mode permission classifier refused the real ACL pre-flight (not worked around), so the owner runs the pre-flight in their own terminal and starts the prepared Codex run from the UI (grant `grant_muo6lo5l_7d6f521584`, 1 attempt, expires 16:09Z). The gate stays open in LIVE_VALIDATION until that test; afterwards return to BUILD_SAFE.
- Leftover (P3): an empty conversation titled with a broken character ("Validare live M02 � Claude") was created when curl sent non-UTF-8 text; there is no delete/rename command, it is harmless.
- Codex ACL consent (P1, your decision). Details: `M02_SECURITY_READINESS.md` F2–F4.
  - The Windows elevated sandbox enforces the Hub deny list by writing persistent DENY-read ACEs for `CodexSandboxUsers`; they also apply to Codex desktop sessions.
  - The gate blocks Codex on Windows until you record consent for the exact list: Integrations → Izolare, 16 paths, fingerprint `9cab02fd58238507`.
  - Then run the real pre-flight (no model).
  - Reversal per path: `icacls "<path>" /remove:d CodexSandboxUsers`.
- Codex account check after M02 (P1, your action). The last check (13:01) predates the sandbox readiness read, so the gate reports "neverificat" until a new "Verifică contul" (contacts OpenAI, no inference).
- Other projects under `Ifrim Digital Proiecte` (P2, decision).
  - With `:root = read`, Codex can read non-protected files of other projects by absolute path.
  - Absolute `**` globs work (F5) but would write ACEs into other projects, so they are prepared, not enabled.
- `~/.codex/config.toml*` (P2): readable by the sandbox and may hold MCP env values. Verify the runner with it denied during the pre-flight before extending the list (new fingerprint, new consent).
- Claude Code with shell/write on native Windows (P2, platform): SECURITY_BLOCKER (no OS sandbox). Read-only is tool-level only.
- Playwright (P2, NEEDS_INSTALL_APPROVAL): devDependency with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, reusing Chromium 1223/1228 from `%LOCALAPPDATA%\ms-playwright`. Browser Workspace E2E is not run.
- Local Romanian speech engine (P3, NEEDS_INSTALL_APPROVAL): strict local mode shows NEEDS_SETUP; the browser engine sends audio online and is not used.
- Not measurable in the test pane (P3): real FPS, OS reduced-motion emulation, long sessions, screen reader. Measured instead: GPU cost per frame, short-session heap, DOM audit.
- File symlink test (P3, SKIPPED_ENV): unchanged; Developer Mode not enabled.
- Uncommitted work (decision): M02 on branch `v2-milestone-01`; proposed commit message in `.ifrim/CHECKPOINTS/2026-09-30-milestone-02-done.md` (not executed).


## Milestone 01 Open Items - 2026-09-30 (supersede the V2 items below where they overlap)

- V2-LIVE (P1, blocked by a local permission): on 2026-09-30 the owner approved the live validation, recorded both billing attestations and ran the account checks. The Claude Code auto-mode permission classifier refused to let the session drive it (classified as a production deploy); it was not worked around. No PASS_LIVE label exists yet; see NEXT_SESSION for how to run it.
- Codex read access to private paths (P2): Codex has no per-path read denial; `.ifrim/private` and `.ifrim/BACKUPS` are protected for Codex only by the prompt rule. Evaluate permission profiles or a work tree without these directories during LIVE_VALIDATION.
- Billing attestations (P1, user action): Codex — credit balance 0 and automatic reload off (ChatGPT Settings → Usage); Claude — usage credits (formerly extra usage) off and auto-reload off. The claude.ai usage page read on 2026-09-30 showed Max plan with usage credits disabled; the formal attestation is still yours to record in Integrations.
- Codex account check not run (P1, user action): `account/read` + `account/rateLimits/read` + `model/list` contact OpenAI with your account (no inference). Needed to verify the plan (V1 reported `prolite`, unverified in V2), the credit balance and the GPT-6.x models available.
- Claude Code CLI 2.1.175 is older than the audited models (P2, your decision, global change): Opus 5.5 needs ≥ 2.1.280, Sonnet 5.5 ≥ 2.1.284, Fable 5.1 ≥ 2.1.257. On 2.1.175 `opus` = Opus 4.8 and `sonnet` = Sonnet 4.6. The Hub does not update global tools.
- Codex desktop auto-updated to 0.159.0 after the PC restart (P3, informative): the protocol schema was regenerated locally and the 9 allowlisted methods exist; fast mode is disabled per Hub process.
- `.claude/settings.json` `fallbackModel` (P3, downgraded): no longer applies to Hub runs (`--setting-sources user`); it still applies to your interactive sessions.
- OpenClaw gateway (P3, decision): not listening after the PC restart (18790 free), while V1 came back on 3004/8004. V2 does not start it; whether its scheduled task stays is your decision.
- Playwright (P2, approval): REUSE decided; installation needs approval. Computer runtime visual control stays native/assisted.
- Temporary local artifacts (P3, cleanup on your OK): `.ifrim/tmp/migration-check/` (coherent copy of the Hub DB used for the migration test, private data), `.ifrim/tmp/v2-tests/hub-*` left by a test agent, `.ifrim/tmp/regression/*.log`. All git-ignored.
- Uncommitted work (decision): V2 + Milestone 01 are not committed or pushed.

## V2 Open Items - 2026-09-30

- V2-LIVE (P1, blocked on approval): no live Codex/Claude turn, interruption or handoff executed yet. Proposal in NEXT_SESSION. Successor of HUB-018's acceptance criteria.
- HUB-018 (P1, historical, kept open): V1 criteria not met; V1 retired from execution in V2. Do not close without your decision. Open V1 locks imported as information only: `LOCK-mumsn13e-2kew8n` (HUB-018, exclusive) and `LOCK-PD-RESTAURANT-PANEL` (advisory).
- Billing attestations (P1, user action): extra usage (Claude) and automatic credit consumption (Codex) cannot be read by the Hub; routes stay blocked until you confirm in Integrations.
- Codex account check not run (P2, user action): contacts OpenAI with your account (no inference).
- `.claude/settings.json` of this project sets `fallbackModel: ["opus","haiku"]` (P2): automatic in-plan fallback; V2 records the actual model per turn. Remove it if you want to forbid fallback.
- `ANTHROPIC_BASE_URL` present in the Hub process environment when started from the Claude session (P3): stripped from all provider children; check your user environment if it is unexpected.
- Windows file-symlink test NOT_RUN (P3): EPERM without Developer Mode/admin; the junction branch is tested for real.
- V1 continuation latency (P3, historical): 3.3 s cold / 0.16 s warm in isolation; the 30 s timeout appears only under concurrent full-suite load. V2 equivalents respond in 35–45 ms.
- Browser automation (Playwright) and desktop control (P2): blocked until you approve installation/bridge.
- Voice (P3): transcription locality depends on the browser engine (labelled in UI); Romanian local TTS voices not verified on this machine.
- Plugin companion / MCP Events (P3): need a public HTTPS endpoint; not authorized.
- Cutover (decision): V1 tray/autostart and ports 3004/8004; OpenClaw gateway 23596 and the scheduled task.
- Uncommitted V2 work (decision): nothing committed or pushed.

## Current Open Items - 2026-09-29

- HUB-018 P1: automatic Hub backup timed out before Claude admission. Local exclusion/reparse-point source fix requires final focused/full QA, independent review, exact idle-API reload and a valid complete real backup; preserve the failed partial ZIP.
- HUB-018 P1: native Claude turn and actual cancellation/browser acceptance remain unverified. Keep the execution gate suspended and do not retry until backup evidence and approval are current.
- HUB-018 P2: continuation API contract timed out at30s in a full serial run; it passed separately in24.5s. Investigate latency without masking the timeout.
- GitHub handoff was pushed as a WIP snapshot to the private Agent Hub `main`; this does not close HUB-018 or authorize a release. Continue excluding `.ifrim/private`, backups, `.env`, output and credentials from future commits.
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
