# M03 · Status de implementare (trasabilitate: cerință → modul → test → dovadă → status)

Data: 2026-10-01. Versiune: `2.4.0-m03`. Bază: `6432c5e` (M01 + M02 + Lega, raport `M01_M02_REPORT.md`; limitările istorice rămân valabile acolo).

**Niveluri atinse:**
- **BUILD_READY:** atins.
- **SIMULATED_E2E_VERIFIED:** atins (demonstrațiile A/B/C cu provideri, review și runner falși).
- **LIVE_SANDBOX_VALIDATED:** NOT_RUN (cere aprobări, vezi `M03_LIVE_VALIDATION_PLAN.md`).
- **REAL_PROJECT_READY:** NU (R2 deschis).
- **OWNER_ACCEPTED:** decizia ta.

Toate testele de mai jos se rulează cu `npm run test:v2` (fără modele). Rezultatele complete sunt în `M03_TEST_REPORT.md`.

| ID | Cerință (spec M03) | Modul | Test | Status |
|---|---|---|---|---|
| T01 | R2: acces cross-project | `policy/isolation.mjs` (`evaluateHostIsolation`), `policy/gate.mjs` (`host_isolation`), comenzile `isolation.r2_*` | M03-ISO-02, M03-HUB-01; canary `KNOWN_GAP_R2` | logica PASS_LOCAL; poarta PASS_SIMULATED; **R2 DESCHIS**, confirmat de canary (4 citiri ALLOWED = `KNOWN_GAP_R2`, 2026-10-01) |
| T02 | R3: config și credențiale | `PROTECTED_CODEX_HOME_ENTRIES` + glob `config.toml.*`, amprenta nouă | M03-ISO-01; canary pe arbore fictiv | profil PASS_LOCAL; canary **PASS_LOCAL** (50 verificări, cele 3 intrări DENIED); ACL pe calculatorul real: după acordul tău |
| T03 | Profiluri RO/RW, subprocese | profilurile M02 (neschimbate) + runner-ul prin `codex sandbox` `ifrim_hub_rw` | M02 SEC-* (păstrate); FAC-* (runner simulat) | PASS_LOCAL / PASS_SIMULATED; sandbox real pentru runner NOT_RUN |
| T04 | MCP la start/resume/retry/handoff, paginare | `providers/codex.mjs` (neschimbat; toate traseele noi trec prin `startTurn`) | M03-MCP-01 (resume), MCP-01…09, FAC-* | PASS_SIMULATED |
| T05 | Efort explicit, fără `max` moștenit | `policy/run-plan.mjs`, `effortArgs`, verificarea efortului în `thread/start` | M03-RP-01…03, M03-HUB-02, FAC-01 | PASS_LOCAL / PASS_SIMULATED |
| T06 | Modelul primit = cel cerut, fără fallback plătit | `run_plan` (model din `model/list`) + verificarea exactă existentă | M03-RP-02; testele M02 model-swap/variant | PASS_SIMULATED |
| T07 | Aprobare + dispatch durabil (dublu click, două taburi, reconectare) | `factory_dispatches` (cheie unică + revendicare atomică), aprobarea de unică folosință a scope-ului | FAC-11; SSE replay (T17b) | PASS_SIMULATED |
| T08 | Grant expirat sau revocat, acțiune schimbată după aprobare | poarta la fiecare dispatch; recompararea scope-ului la pornire | FAC-12, FAC-11 | PASS_SIMULATED |
| T09 | Eșec pre-model, încercare returnată, fără buclă | `runs.refundPreInference` (dovadă: fără `turn_sent`; plafon `maxAttempts`) | M03-HUB-02, M03-GRD-02 | PASS_SIMULATED |
| T10 | Cerințe versionate, dependențe, criterii protejate | `factory/spec.mjs`, `factory/plan.mjs`, hash-urile testelor protejate | M03-SPEC-01/02, M03-PLAN-01, FAC-05, FAC-11 | PASS_LOCAL / PASS_SIMULATED |
| T11 | Un singur writer, snapshot fix, review vechi invalidat | lease + o misiune activă pe proiect; `takeSnapshot`; review `STALE` | FAC-13, FAC-03, M03-GRD-01, FI-02 | PASS_SIMULATED |
| T12 | Findings și QA validate structural, fără auto-aprobare | `factory/review.mjs`; reviewer pe alt provider | M03-REV-01, M03-PLAN-01, FAC-04 | PASS_LOCAL / PASS_SIMULATED |
| T13 | Runner izolat, teste de acceptanță nealterate | `factory/runner.mjs` (doar `codex sandbox`), `factory/integrity.mjs` | FAC-05, M03-INT-01, M03-RUN-01; `codex-sandbox-timing --fictive` | simulat PASS_SIMULATED; `codex sandbox` real pe arbore fictiv PASS_LOCAL (~4–6 s pe comandă); runner prin fabrică pe sandbox real NOT_RUN |
| T14 | Remediere limitată, stagnare, escaladare autorizată | `nextRepairOrDecision`, `madeProgress`, `allowExtraCycle` (doar UI) | FAC-02, FAC-03, FAC-05, FAC-06 | PASS_SIMULATED |
| T15 | Handoff complet, incomplet, refuzat, întrerupt | `runtime/handoff.mjs` (context fabrică + refuz cât misiunea e activă) | FI-01, FI-02; testele de handoff existente | PASS_SIMULATED |
| T16 | Stop înainte de turn, în timpul execuției, înainte de etapa următoare | `factory.stop`/`markCancel`, Stop All marchează sincron; codul M02 pentru Stop înainte de turn | FAC-07, FAC-08, FAC-09, **FAC-14** (pauză în timpul unei verificări), **FAC-17** (pauză pe a 2-a verificare + reluare), **FAC-19/20** (pauză / Stop cât execuția încă pornește) | PASS_SIMULATED, cu verificare prin mutație. Stop **în timpul unei comenzi QA**: același mecanism ca la verificări (`halted()`), fără test dedicat pentru QA |
| T17 | Restart fără inferență automată și fără efecte duplicate | `factory.recover()` la boot; reluarea nu sare niciodată un baseline sau verificări incomplete (`stageResults`); un rezultat terminat în pauză e evaluat, nu refăcut | FAC-10, **FAC-16**, FAC-17, **FAC-18** (termen) | PASS_SIMULATED |
| T18 | Allowlist browser, redirecționări, preview separat de Hub, E2E | `tools/browser.mjs` (M02 + `runE2E`, `validateE2ESteps`, `chromiumSandbox`); preview interzis pe porturile Hub; `runE2ECriteria` în fabrică | testele browser M02; M03-SPEC-02; **M03-BR-00…03 cu Chromium real**; FAC-02 (AC-7) | PASS_LOCAL (browser real, Playwright 1.61.0) |
| T19 | Propunere Lega → UI → aprobare → execuție, fără autoritate vocală | `lega.propose_mission` cu `eng_*` → `factory.initialize`; deciziile fabricii doar UI | FI-03; testele Lega M03 | PASS_SIMULATED; live NOT_RUN |
| T20 | Consumul vocii UNKNOWN versus măsurat | `planUsage.status = "UNKNOWN"` | M03-GRD-03 | PASS_SIMULATED |
| T21 | Interfața Engineering, scurtături, atașamente, SSE | `web/src/screens/factory/FactoryPanel.jsx`, Misiuni, Inspector, Integrări → R2 | M03-UI-01; testele UI M02; build | PASS_LOCAL (logică + build). Verificarea vizuală: vezi `M03_TEST_REPORT.md` |
| T22 | Pachetul de livrare corespunde versiunii testate | `buildBundle` + `accept` (reverifică workspace-ul) | FAC-01, FI-01 (STALE) | PASS_SIMULATED |
| T23 | Fără inferență, commit, push, merge sau deploy neaprobat în suită | supervisor în modul test (doar fixture-uri), M01-NG1, FI-04 | M01-NG1, FI-04 | PASS_LOCAL |
| T24 | Fixture-urile A/B/C, local / simulat / live separat | `v2/fixtures/factory/*`, patch-uri și review-uri fixture | rulare locală directă (baseline pică, fix trece); FAC-01/02/03 | local PASS_LOCAL; simulat PASS_SIMULATED; proiectele demo A și B create și înregistrate (2026-10-01); live NOT_RUN |

## Ce s-a construit (fișiere)

**Server:**
- `policy/run-plan.mjs` (nou): model și efort explicite, profilurile.
- `runtime/timeline.mjs` (nou): cronologia pe faze.
- `runtime/runs.mjs`: planul în poartă, cronologia, restituirea plafonată, hook-ul Stop All → fabrică.
- `providers/codex.mjs`: efortul per proces + verificat, faze, thread vechi reluat cu alt efort → thread nou.
- `policy/isolation.mjs`: R3 + `evaluateHostIsolation` (R2).
- `policy/gate.mjs`: verificările `host_isolation` și `run_plan`.
- `policy/approval-policy.mjs`: `factory.scope`.
- `factory/` (nou):
  - `factory.mjs`: conductorul;
  - `spec.mjs`, `plan.mjs`, `snapshot.mjs`, `diff.mjs`, `integrity.mjs`, `review.mjs`, `runner.mjs`, `fixtures.mjs`.
- `domain/missions.mjs`: șabloanele `eng_*`, `addTask`.
- `runtime/handoff.mjs`: contextul fabricii.
- `runtime/lega.mjs`, `policy/lega-policy.mjs`: fabrica în Lega.
- `runtime/command-catalog.mjs`: comenzile `factory.*` și `isolation.r2_*`; „Verifică contul” cere modele.
- `http/routes.mjs`: `/api/factory*`, `/api/isolation/r2/*`, cronologia în `/api/runs/:id`.
- `storage/migrations.mjs`: migrarea 3, aditivă.
- `sim/simulation.mjs`: Fabrica A/B/C.
- `tools/browser.mjs`: Chromium cu sandbox-ul OS (`chromiumSandbox: true`), pașii E2E declarativi (`validateE2ESteps`) și runner-ul E2E (`runE2E`), în același context izolat ca inspecția.
- `config.mjs`: versiunea `2.4.0-m03`.

**Web:**
- `screens/factory/FactoryPanel.jsx` (nou);
- `screens/Missions.jsx`;
- `screens/focus/Inspector.jsx` (plan + timp pe faze);
- `screens/focus/Composer.jsx` (eticheta efortului);
- `screens/Integrations.jsx` (R2);
- `shell/Shell.jsx` (butoanele simulatorului);
- `shell/Lega.jsx` (consum UNKNOWN);
- `lib/uiLogic.js` (helperele fabricii).

**Fixture-uri și scripturi:**
- `v2/fixtures/factory/{bug-demo,service-request}`;
- `v2/tests/fixtures/factory-{patches,reviews,solutions}`;
- `fake-codex` (coadă, efort, writer, `sandbox`) și `fake-claude` (coadă, review);
- `v2/scripts/create-factory-fixture.mjs`, `npm run v2:factory-fixture` (rulat pentru demo A și B pe 2026-10-01);
- `v2/tests/manual/codex-sandbox-timing.mjs`;
- canary-ul R2/R3;
- `v2/tests/m03-browser.test.mjs` (4 teste cu browserul real; SKIPPED_ENV fără Playwright);
- `package.json`: devDependency `playwright` 1.61.0 (exact), instalată fără descărcare de browser.

**Skill-uri, versiunea 2** (numărul rămâne 11): `debug` (bugfix), `feature` (intake → livrare), `review` (verdict legat de change set), `handoff`, `release` (pachet de livrare).

## Ce nu e făcut (cu motiv)

- **Validări live (Codex RW, Claude RO, round-trip, Stop real, Lega engineering):** cer aprobări de inferență și granturi.
- **ACL-uri:** acordul nou pentru R3 și `codex-sandbox-timing --real-profile` rămân la tine (modificări ACL pe calculatorul real). Canary-ul și măsurarea pe profil fictiv sunt făcute (PASS_LOCAL).
- **R2 (mediu separat):** cere o decizie și o instalare (WSL2 / VM).
- **E2E live:** runner-ul E2E e făcut și testat cu browserul real (PASS_LOCAL). Pe un proiect demo, cu writer-ul real: NOT_RUN (proba 2.3).
- **Planul propus de un model:** planul e determinist, din șablon. Un plan propus de model nu e implementat; nu era necesar pentru fluxurile cerute.
- **Virtualizarea logurilor:** nu e necesară încă. Dovezile își limitează ieșirea (20 000 de caractere), iar diff-ul e limitat (120 000 / 40 000 în brief).
