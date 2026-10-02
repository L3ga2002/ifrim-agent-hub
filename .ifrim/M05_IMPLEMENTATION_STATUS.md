# M05 · Statusul implementării

Data: 2026-10-02. Versiunea codului: `2.6.0-m05`, pe disc, **necomisă**. Hub-ul a fost repornit de tine pe `2.6.0-m05` (2026-10-02 02:08 UTC, pid 26992, BUILD_SAFE, migrarea 5 aplicată).

**Aprobări folosite:**
- **(a)** cod M05 local, fără model și fără commit;
- **verificări WSL reale fără model:** canary, `codex sandbox` pe arbori fictivi, app-server doar pentru cont și modele;
- **pornirea Hub-ului** (2026-10-01, 20:55 UTC);
- **subagenți doar-citire** pentru explorare și review.

**Aprobări nefolosite:** (b), (c), (d).

| Componentă | Fișiere | Stare | Dovadă |
|---|---|---|---|
| Invocarea `wsl.exe` (argv validat, `--exec`, `env -i`) | `environments/wsl.mjs` | BUILD_READY | PASS_LOCAL real (inspecție, canary), M05-RT-01 |
| Inspecție și amprentă | `wsl-runner.mjs`, `scripts/inspect.sh` | BUILD_READY | PASS_LOCAL real: amprenta `7b3afa6ae2a7d1f3`, linia identică cu cea istorică |
| Verificarea contului prin mediu (C16) | `wsl-runner.mjs probeAccount` | BUILD_READY | PASS_LOCAL real: chatgpt `prolite`, 8 modele, profiluri permise, fără thread |
| Canary C1–C17 + atestarea | `canary.mjs`, `c14.mjs`, `scripts/canary.sh`, tabela `environment_attestations` | BUILD_READY | PASS_LOCAL real, 71/71 (driverul manual); în Hub: PASS_SIMULATED pe fixture |
| Transfer în mediu (copiere, fără montare) | `workspace.mjs`, `tar.mjs`, `scripts/prepare.sh` | BUILD_READY | PASS_LOCAL real (C14a, C14b) |
| Export + validator C14 + aplicare | `workspace.mjs`, `tar.mjs` | BUILD_READY | PASS_LOCAL real C14 26/26 + teste unitare adversariale |
| Adaptorul Codex în mediu | `providers/codex-wsl.mjs`, `providers/codex.mjs` (launcher) | BUILD_READY | PASS_SIMULATED (fake-wsl), **NOT_RUN live** (cere (c)) |
| Stop în mediu (`wsl.exe` + reaper) | `scripts/reap.sh`, `release.sh` | BUILD_READY | PASS_LOCAL real pe `codex sandbox` (0 procese rămase, 0,9–1,9 s); turn real NOT_RUN |
| Poarta pe ruta de mediu (`environment_route`, `isolation`, `host_isolation`) | `policy/gate.mjs`, `policy/isolation.mjs` | BUILD_READY | PASS_SIMULATED (ENV-03/04, RT-02/04/05/RV-08) |
| Aprobarea (b), legată de amprentă | `environment-commands.mjs`, `ENV_POLICY_TEXT` | BUILD_READY, **neacordată** | PASS_SIMULATED (ENV-04, RT-11) |
| Ruta per proiect (fără trecere pe Windows) | `environments/registry.mjs`, `runs.mjs` | BUILD_READY | PASS_SIMULATED (ENV-02/03) |
| Verificări și QA în mediu | `wsl-factory-runner.mjs`, `factory/routed-runner.mjs` | BUILD_READY | PASS_SIMULATED (RT-06, RV-07); comportamentul socket-urilor măsurat real |
| Preview/E2E în mediu | — | **BLOCAT** (sandbox fără socket-uri) | EPERM la `listen` măsurat real; decizie separată |
| Harta etapelor + REAL_PROJECT_ELIGIBLE | `routed-runner.mjs stageMap`, factory view/bundle | BUILD_READY | PASS_SIMULATED; azi `false` pe orice rută |
| R2 pe runner-ul Windows (proiecte reale) | `factory/runner.mjs readiness(project)` | BUILD_READY | RT-07 |
| Snapshot git pentru proiecte mari (> 4000 de fișiere) | `factory/snapshot.mjs takeGitSnapshot`, `tools/git.mjs` | BUILD_READY | RT-12 (4.200 de fișiere), RV-04 |
| Git fără programe din repository (fsmonitor) | `tools/git.mjs` | BUILD_READY | EXP-06 cu control pozitiv; mutant prins |
| Stop în timpul unei comenzi QA | `factory.mjs` (`tracked`, `shouldStop`) | BUILD_READY | M05-FAC-01, RV-07 |
| RT-07 post-redirect-get | `tools/browser.mjs` | BUILD_READY | PASS_LOCAL cu Chromium real pe Windows (BR-01/02); mutant prins |
| Preflight / încălzire (implicit oprit la boot) | `environment.warmup`, `runner.preflight` | BUILD_READY | WSL real: 1,6–2,7 s în sandbox; Windows NOT_RUN (profil real cu ACL) |
| Diagnostic Lega + regula încercării | `runtime/lega.mjs`, `providers/codex-realtime.mjs`, `shell/Lega.jsx` | BUILD_READY | LEGA-01/02/03 (fixture); NOT_RUN live |
| Canalul `cli` (atribuire onestă) | `runtime/commands.mjs`, `http/routes.mjs` | BUILD_READY | RT-11 |
| UI: Sistem → Medii de execuție, panoul misiunii | `screens/system/Environments.jsx`, `lib/environmentLogic.js`, `FactoryPanel.jsx` | BUILD_READY (build OK) | UI-01/02/03; nu a fost văzut în Hub-ul live |
| Migrarea 5 | `storage/migrations.mjs` | BUILD_READY | probată pe o bază de test cu schema M04 (4→5, integritate ok); proba pe copia bazei live o rulezi tu (`node v2/scripts/migration-dry-run.mjs`) |
| Suprafața `openai.codex_wsl_runner` | `config/ecosystem/surfaces.json`, `domain/surfaces.mjs` | BUILD_READY | M01-surfaces-01; documentele `.ifrim/V2_*` regenerate |
| Curățarea proceselor v2 (nu se mai numără pe sine) | `scripts/reap.sh`, `canary.mjs exerciseReaper` (C15r/C15s) | BUILD_READY | PASS_LOCAL real: v1 dădea `remaining=3`, v2 dă `remaining=0`, cu procese-martor; LR-06 |
| `node --test` în același proces în mediu; BLOCKED doar pentru eșecuri numai de socket | `wsl-factory-runner.mjs` (`TEST_NODE_OPTIONS`, `environmentBlocked`) | BUILD_READY | PASS_LOCAL real (ieșirea pierdută vs completă); LR-01/02; 2 mutanți prinși |
| Orice aprobare pe ruta de mediu e refuzată automat | `providers/codex.mjs` | BUILD_READY | LR-03; mutant prins |
| Intrări-director în export (`.git/` ignorat, folder trimis acceptat) | `environments/workspace.mjs` | BUILD_READY | LR-04; 2 mutanți prinși |
| Instrucțiunile writer-ului pe ruta de mediu (copie Linux, fără cale Windows) | `runtime/prompt.mjs`, `runs.mjs` | BUILD_READY | LR-05 |
| Fixture nou cu nume propriu (`--name`) | `scripts/create-factory-fixture.mjs` | BUILD_READY | `node --check`; folosit în planul (c) |

## Niveluri (§32)

| Nivel | Stare |
|---|---|
| BUILD_READY | **atins**: cod, teste locale, build UI |
| LOCAL_ENVIRONMENT_ATTESTED | **atins și înregistrat** la 2026-10-02 ~02:13 UTC (PASS_LOCAL, 71 de verificări, amprenta `7b3afa6ae2a7d1f3`), apoi **invalidat** la ~03:50 UTC, intenționat: canary-ul a primit verificarea reală a curățării (C15r/C15s), deci are o versiune nouă. Atestarea trebuie refăcută din UI. Driverul manual a trecut și el |
| WSL_LIVE_SANDBOX_VALIDATED | **neatins**: cere (c) |
| PIPELINE_ISOLATION_VERIFIED | **neatins**: preview, E2E și review rămân pe Windows |
| REAL_PROJECT_ELIGIBLE | **neatins**: `realProjectEligible = false` pe orice rută |
| OWNER_ACCEPTED | decizia ta |
