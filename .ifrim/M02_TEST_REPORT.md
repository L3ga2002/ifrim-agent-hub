# M02 — Test report (§27)

Data: 2026-09-30 · Node 24 · Windows 11 · fără modele (fixture-uri și canary-uri fictive).

Statusurile rămân separate. **Omisiunile nu se adună la „trecute”.**

## Validare live — 2026-09-30 (aprobată explicit de utilizator)

| Provider | Rezultat | Detalii |
|---|---|---|
| Claude Code (read-only, `sonnet`) | **PASS_LIVE** | run `run_muo6i9og_50c329673c`: poarta a admis (grant 1 încercare), backup verificat automat înainte, 15 s, răspuns corect (a găsit cazul lipsă: nume format doar din spații), proiectul de test nemodificat (`git status` curat în afară de backupul Hub), cost: estimare client 0,028 USD — nu taxare, ruta e abonamentul |
| Codex (read-only) | **PENDING — pornit de utilizator** | preflight-ul real (ACL) a fost refuzat de clasificatorul de permisiuni al Claude Code; nu a fost ocolit. Grant `grant_muo6lo5l_7d6f521584` (1 încercare, expiră 16:09Z) și conversația „Validare live M02 — Codex (read-only)” sunt pregătite |

Proiectul de test: `Ifrim Digital Proiecte/ifrim-hub-live-test` (validator de formular, 4 teste, git propriu), creat cu `npm run v2:test-project` și înregistrat prin comanda nouă `project.register_test` (M02-SEC-13).

## Suite automate

| Suită | Comandă | Teste | PASS | FAIL | SKIPPED | Durată |
|---|---|---|---|---|---|---|
| V2 (M01 + M02) | `npm run test:v2` | 197 | 196 | 0 | 1 | ~245 s |
| V1 (regresie) | `npm test` | 552 | 551 | 0 | 1 | 17 s |
| Build UI | `npm run build:v2` | — | OK | — | — | ~1 s |
| Dependențe | `npm audit` | — | 0 vulnerabilități | — | — | — |

Cele două omisiuni sunt același caz de mediu: **SKIPPED_ENV**, pentru că symlink-ul de fișier dă EPERM fără Developer Mode, iar Developer Mode nu a fost activat.

- V2 T25 „file symlink branch”;
- V1 „database link is rejected…”.

Ramura cu junction este testată real (junction-urile se pot crea fără privilegii).

### Regresii găsite de suita M01 în timpul M02 și corectate

| Test | Cauză | Corecție |
|---|---|---|
| M01-NG1 (serverul nu rulează git mutant) | simulatorul crea proiectul demo cu `git commit` din `v2/server/sim` | mutat în `v2/scripts/sim-demo.mjs`; serverul doar verifică existența (`assertDemoProject`) |
| M01-INT-01 (unelte blocate) | `browser.inspect` a devenit dinamic | contract nou: `needs_setup` fără Playwright, `ALWAYS_ASK`; registrul nu mai raportează „available” fără instalare |
| M01-ART-01 (artefacte) | verificarea zonelor protejate folosea calea absolută; hub-ul de test stă în `.ifrim/tmp` | verificare relativă la proiect + pe calea reală (junction) |

## Teste M02 noi (28)

**SECURITY** — `v2/tests/m02-security.test.mjs` (14): toate PASS_LOCAL.

| ID | Ce dovedește |
|---|---|
| SEC-01 | Profilul Codex neagă zonele protejate, `.env`, credențialele; `~/.codex` nu e negat întreg; căile Hub sunt negate absolut; rețeaua e oprită |
| SEC-01b | Căi Hub absolute, deduplicate, fără intrări imbricate; amprenta urmează lista exactă |
| SEC-02 | Claude primește negări absolute `//c/…`, pentru proiect și pentru Hub |
| SEC-03 | Matricea de izolare, inclusiv acord lipsă sau amprentă schimbată → NEEDS_LIVE_APPROVAL |
| SEC-04/05 | Poarta blochează Codex fără sandbox „ready” sau fără profil permis (fake app-server) |
| SEC-06 | Thread cu full access → oprire înainte de turn; rulările poartă profilul, nu parametri vechi |
| SEC-07 | Claude cu shell pe Windows nativ → SECURITY_BLOCKER |
| SEC-08 | Argumentele reale `claude -p` conțin negările |
| SEC-09 | Rutele de fișiere refuză zonele protejate, numele secrete și junction-urile (canary fictiv) |
| SEC-10 | Artefacte: zone protejate relativ la proiect; junction spre zonă protejată sau în afara proiectului refuzat |
| SEC-11 | O unealtă care cere aprobare de instalare nu apare „available” |
| SEC-12 | Acord ACL: text exact + amprentă curentă; vocea refuzată; poarta blochează fără acord și după retragere |
| SEC-13 | Proiecte de test: doar un director marcat, copil direct al rădăcinii proiectelor, fără secrete și fără link-uri; idempotent; vocea refuzată; retragerea scoate execuția |

**RUNTIME** — `v2/tests/m02-runtime.test.mjs` (5): toate PASS_LOCAL.
- RT-01: citire paginată, fișiere binare refuzate.
- RT-02: căutare literală, redactată, fără zone protejate.
- RT-03: browser doar pe URL local cu port, niciodată Hub-ul; NEEDS_INSTALL_APPROVAL.
- RT-04: starea conține flag-ul de simulare, conversațiile/rezultatele recente, structura companiei; `/api/sim` răspunde 404 în afara simulatorului.
- RT-05: istoricul uneltelor, redactat.

**UI logic** — `v2/tests/m02-ui-logic.test.mjs` (9): toate PASS_LOCAL.
- UI-01: cele 10 stări ale nucleului vin din semnale reale.
- UI-02: Markdown fără HTML, linkuri nesigure transformate în text.
- UI-03: atașamente — tip, dimensiune, nume secrete.
- UI-04: etapa erorii.
- UI-05: layout Focus, conversația ≥360 px.
- UI-06: progres numărat, nu estimat.
- UI-07: catalog cu fapte separate.
- UI-08: comenzi vocale locale; aprobările, ștergerile și deploy-ul refuzate.
- UI-09: deduplicarea evenimentelor și secvențele vechi.

## Verificări manuale, fără model

| Verificare | Rezultat | Status |
|---|---|---|
| Canary sandbox Codex (`v2/tests/manual/codex-sandbox-canary.mjs`) | 46/46 | PASS_LOCAL |
| Probe ACL (persistență, excepție pe copil, glob-uri absolute, căi reale neatinse) | F1–F7 în Security readiness | PASS_LOCAL |
| Preflight profil real (`codex-real-profile-preflight.mjs`) | refuză fără amprentă (verificat); rularea completă schimbă ACL-uri | NOT_RUN (NEEDS_LIVE_APPROVAL) |
| Simulator (`npm run v2:sim`): seed complet, scenarii, banner | vizual + API | PASS_SIMULATED |
| Pierdere de context WebGL ×3 → SVG | 1 și 2 recuperate, a 3-a → SVG | PASS_LOCAL |
| Eroare injectată în nucleu → boundary | nucleu SVG, pagina și Stop All intacte | PASS_LOCAL |
| Reduced motion (ramura de cod) | rulează fără eroare; oprirea animației nemăsurabilă în panoul ascuns | PARȚIAL / NOT_RUN |
| Overflow 360/390/768/1024/1440/1920 + 720×450 (zoom 200%) | 0 | PASS_LOCAL |
| Latență UI | paletă 6,7–36,6 ms; ecran 3,9–20 ms | PASS_LOCAL |

## Plan §27 — acoperire

| Arie | Acoperit | Neacoperit (status) |
|---|---|---|
| SECURITY | fișiere private pe rutele efective, canary, subprocess (argumente reale), traversare/junction, redactare, BUILD_SAFE, fără inferență neautorizată, invalidarea aprobării (M01) | symlink de fișier (SKIPPED_ENV) |
| UI | navigare, layout, draft, conversație, atașamente, erori, empty states, graf/listă, căutare, accesibilitate (audit), responsive | screen reader real (NOT_RUN) |
| RUNTIME | snapshot/reconectare, deduplicare, evenimente întârziate, cotă simulată, handoff simulat și eșecul lui, Stop/Pause cu confirmare backend | — |
| TOOLS | preview fișier/diff autorizat, output vs terminal, browser izolat (static), lipsa bridge-ului | screenshot/consolă Playwright (BLOCKED, NEEDS_INSTALL_APPROVAL) |
| VOICE | motor lipsă → NEEDS_SETUP, permisiune refuzată, dispozitiv schimbat (cod), mute, fără fallback cloud ascuns, comenzi locale | transcriere locală reală (BLOCKED, NEEDS_INSTALL_APPROVAL) |
| PERFORMANCE | WebGL pierdut/indisponibil, cost GPU, memorie pe o sesiune scurtă, bundle | FPS real și sesiune prelungită (NOT_RUN) |
| LIVE | — | PASS_LIVE: niciunul (LIVE_VALIDATION_PENDING) |
