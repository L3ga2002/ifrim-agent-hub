# Raport de testare V2 — 2026-09-30

> Milestone 02 (2026-09-30): vezi `M02_TEST_REPORT.md`. Totaluri actuale: V2 197 teste (196 PASS, 1 SKIPPED_ENV), V1 552 (551 PASS, 1 SKIPPED_ENV). Conținutul de mai jos este istoricul Milestone 01 / V2.

Etichete: PASS_LIVE (model/provider real), PASS_LOCAL (componente reale locale, fără inferență), PASS_SIMULATED (provider simulat prin fixture), FAIL, BLOCKED, NOT_RUN. Un mock nu validează abonamentul real; un test sărit nu este trecut.

## Milestone 01 (2026-09-30)

Suita V2: `npm run test:v2` → **169 teste: 168 pass, 0 fail, 1 NOT_RUN** (symlink de fișier Windows, EPERM), 172,3 s, rulată după restartul mașinii. 119 teste sunt noi în Milestone 01 (fișierele `v2/tests/m01-*.test.mjs`); cele 50 de dinainte trec în continuare. Suita V1: `npm test` → **552 teste: 551 pass, 0 fail, 1 skipped** (același symlink), 16,5 s pe mașina liberă. `npm audit`: 0 vulnerabilități (postcss 8.5.28, nanoid 3.3.19). Build `npm run build:v2`: PASS.

Verificări locale pe binarul Codex real (fără cont, `CODEX_HOME` gol și temporar, doar `initialize`; PASS_LOCAL): după restartul mașinii, Codex desktop s-a actualizat singur la **0.159.0** (cale nouă a binarului, rezolvată automat de adaptor). Schema protocolului a fost regenerată local (`app-server generate-json-schema`): toate cele 9 metode din allowlist există. `codex features list` arată `fast_mode` stable, activ implicit. Override-ul per proces `-c features.fast_mode=false` (și `--disable fast_mode`) este acceptat, cu handshake reușit.

Validarea live (PASS_LIVE) a fost aprobată de proprietar pe 2026-09-30. Clasificatorul de permisiuni al Claude Code a refuzat însă rularea ei din sesiune: **NOT_RUN (blocaj de permisiune locală)**. Atestările și verificările de cont au fost făcute de proprietar în UI: Codex `prolite`, fără credite; Claude `max`.

Nicio verificare nu a pornit un model: providerii sunt fixture-uri (`v2/tests/fixtures/fake-codex.mjs`, `fake-claude.mjs`), iar Hub-ul live a rămas în BUILD_SAFE cu poarta suspendată. Nicio etichetă PASS_LIVE nu există în acest milestone.

### Trasabilitate §70

| Cerință §70 | Teste | Stare |
|---|---|---|
| Company hierarchy | M01-C01, C02, C03 | PASS_LOCAL |
| Goal/Mission/Task lifecycle | M01-C04, C05, C08, C09, C10, C11, C13 | PASS_LOCAL |
| State machines | M01-C12 (toate entitățile), C13, SCH09, `approvals-state` | PASS_LOCAL |
| Event persistence/replay | M01-CMD-05, CMD-10, POL-07, C14, NS4; `http` (Last-Event-ID), `data` (redeschidere) | PASS_LOCAL |
| Scheduler recovery | M01-SCH11, SCH12; `runs-handoff` (crash/restart, pornire duplicată) | PASS_LOCAL / PASS_SIMULATED |
| Locks | M01-CMP02 (computer/window), `approvals-state` (lease un writer, index unic) | PASS_LOCAL |
| Approvals | M01-CMD-06…12, POL-01…06, RUN-01, HTTP-02 | PASS_LOCAL / PASS_SIMULATED |
| Provider mocks | fixture-uri Codex/Claude, `providers` | PASS_SIMULATED |
| Execution surface registry | M01-surfaces-01…07, SURF-ASSIST | PASS_LOCAL |
| Codex protocol fără inferență | `providers` (app-server simulat, allowlist, aprobări), NI1, NI2 | PASS_SIMULATED |
| Claude Code process fără inferență | M01-BH-01…04, `providers` | PASS_SIMULATED |
| Detecția capabilităților native Claude | M01-surfaces-05, NS1…NS3 (`claude agents --json`) | PASS_SIMULATED; detecția reală `claude auth status` PASS_LOCAL (sesiunea de rebuild) |
| Protecția facturării prin abonament | M01-BH-01…11 (Fable/`[1m]` ca sufix literal, init, setări, gărzi de mediu Claude + `--no-chrome`, credite, override-uri Codex, `approvalsReviewer` user, fără substituire de model), router-08, BC4, surfaces-04, surfaces-06, router-02, router-04, `policy` | PASS_LOCAL / PASS_SIMULATED |
| Contaminare ANTHROPIC_API_KEY | M01-BC1, BC2, BC3, BH-02, BH-04 | PASS_LOCAL / PASS_SIMULATED |
| Contaminare OPENAI_API_KEY | M01-BC1, BC2, BC3, surfaces-06 | PASS_LOCAL / PASS_SIMULATED |
| Unified conversation | `runs-handoff`, `data` | PASS_SIMULATED |
| Construcția handoff-ului | M01-HO1, `runs-handoff` | PASS_SIMULATED |
| Referințe checkpoint native | M01-CK1, CK2, HO1 | PASS_LOCAL |
| Backup/restore | `backup` (5), M01-BKP-SLUG; backup real `bkp_munfsdem_b334f5f4fd` verificat | PASS_LOCAL |
| Migrare | M01-MEM-07, MEM-08; migrarea pe copia bazei live (`v2/tests/manual/migration-on-copy.mjs`) | PASS_LOCAL |
| Memory scopes | M01-MEM-01…06 | PASS_LOCAL |
| Versionarea skill-urilor | M01-SKILL-01, 02, 07, 08, 11, 13 | PASS_LOCAL |
| Compatibilitate Agent Skills | M01-SKILL-03, 04, 05, 09, 10, 12 | PASS_LOCAL |
| Permisiuni connector/unealtă | M01-INT-01, SKILL-06, POL-01 | PASS_LOCAL |
| Ownership programări | M01-SCH04…10 | PASS_LOCAL |
| Ownership computer runtime | M01-CMP01…03 | PASS_LOCAL |
| Explicația rutării | M01-router-01…07 | PASS_LOCAL |
| Etichetarea surselor de utilizare | M01-telemetry-01 (MEASURED / PROVIDER_REPORTED / DERIVED / UNKNOWN) | PASS_SIMULATED |
| UI reconnect | `http` (SSE Last-Event-ID); verificare în browser pe 8011 | PASS_LOCAL |
| Redactarea secretelor | `data`/`http` (redact), CMD-11 (payload aprobat intact, log redactat) | PASS_LOCAL |
| Fără inferență | M01-NI1, NI2 (BUILD_SAFE blochează chiar cu restul porții trecut) | PASS_LOCAL |
| Fără commit | M01-NG1 (scanare statică: fără git commit/push/tag/reset/checkout/clean), NG2 | PASS_LOCAL |
| Fără push / deploy | M01-NG1, NG2; `git status`: HEAD `e9ab563` neschimbat | PASS_LOCAL |
| Regresia istorică HUB-018 | poarta de backup (BKP-SLUG), eșec înainte de model (BH-01…03), fără gateway OpenClaw în runtime | PASS_LOCAL / PASS_SIMULATED |
| Continuation timeout (V1) | suita V1 pe mașina liberă: 0 eșecuri (cele 2 timeout-uri anterioare, 30 s pe API-ul V1 live, apăreau doar sub încărcare concurentă: latență izolată 1,2–22 s) | PASS_LOCAL |
| Problema de permisiuni Windows | symlink de fișier: EPERM fără Developer Mode/admin, raportat ca NOT_RUN; junction real PASS | NOT_RUN (symlink) / PASS_LOCAL (junction) |
| Revalidarea nanoid/postcss | `npm audit` 0, versiuni 3.3.19 / 8.5.28 | PASS_LOCAL |

### Defecte găsite și reparate în Milestone 01

Revizorii adversariali (workflow de teste) și testele au găsit, printre altele: filtrul LIKE al evenimentelor elimina `_` în loc să îl escape-uiască; Chief of Staff potrivea fragmente de cuvinte românești („ui” în „magazinului”, „api” în „rapid”); o misiune re-legată păstra obiectivul vechiului goal; `departmentKey` necunoscut era acceptat; comenzile aprobate cu câmpuri care arătau „sensibil” nu mai puteau rula (payload redactat); replay-ul unei comenzi eșuate răspundea 200; scope-urile ASK_ONCE_FOR_TASK nu erau folosite de bus; sensibilitatea `secret` excludea și uneltele locale Hub; override-ul ocolea excluderile de adaptor/proiect/rezervă; o programare retrasă păstra intenția; `buildChildEnv` era sensibil la majuscule (ocolire latentă pe Windows); un folder fără `SKILL.md` oprea boot-ul; exportul de skill-uri livra editări nevalidate; backup-urile cerute cu slug nu satisfăceau poarta; un sold de credite `null` era tratat ca 0. Fiecare are acum un test de regresie.

## Suita automată

Comandă: `npm run test:v2` (serial, date izolate în `.ifrim/tmp/v2-tests`, doar fixture-uri pot fi pornite).
Rezultat final: **50 teste: 49 pass, 0 fail, 1 NOT_RUN** (119,6 s). Suita a rulat de trei ori pe parcursul sesiunii; eșecurile găsite pe drum sunt mai jos.

Build: `npm run build:v2` PASS (bundle principal 180 KB, ecrane încărcate lazy). Build V1 `npm run build` PASS după actualizarea dependențelor. `npm audit`: 0 vulnerabilități.

## Trasabilitate T01–T28

| Test | Cerință | Modul | Dovadă | Stare |
|---|---|---|---|---|
| T01 | Snapshot Git/date, fără commit/push | checkpoint | `.ifrim/CHECKPOINTS/2026-09-29-v2-rebuild-start.json`; HEAD e9ab563 neschimbat, niciun commit | PASS_LOCAL |
| T02 | Scope de scriere; proiecte vecine neatinse | toată sesiunea | scrieri doar în PROJECT_ROOT; PROJECTS.md/.ifrim-system doar citite; backup-urile scriu doar pentru proiecte `execution_allowed` (doar Hub) | PASS_LOCAL |
| T03 | Backup complet + restaurare SQLite | backup | 5 teste (excluderi, junction real, arhivă alterată, buget) + backup real `bkp_mun7qdb3_88891aba89` verificat | PASS_LOCAL |
| T04 | Fix backup validat în runtime | backup service | backup real prin API-ul V2 activ, cu restaurare 245/245 fișiere și 2 baze; corecția V1 **nu** a fost reîncărcată în API-ul V1 | PASS_LOCAL (V2) / NOT_RUN (V1) |
| T05 | Poarta suspendată nu poate fi ocolită | gate, http | teste gate/mode/grant/OPERATIONAL; în UI „Rulează” a fost refuzat cu lista de verificări | PASS_LOCAL |
| T06 | Pornire/restart BUILD_SAFE fără inferență | recovery | test resetare mod; 6 reporniri reale ale Hub-ului în BUILD_SAFE, poartă suspendată | PASS_LOCAL |
| T07 | Rute API/Console/extra usage respinse | billing, adaptoare | 11 teste (API key, config, plan, env, metode credit, billing_error) | PASS_SIMULATED + PASS_LOCAL (env, config reale) |
| T08 | Adaptor Codex | codex.mjs | 6 teste simulate; handshake real `codex.exe` cu CODEX_HOME gol 2,2 s | PASS_SIMULATED + PASS_LOCAL (handshake); live NOT_RUN (aprobare) |
| T09 | Adaptor Claude; eșec înainte de model | claude.mjs | 3 teste simulate; `claude auth status` real prin Hub: claude.ai/firstParty/max | PASS_SIMULATED + PASS_LOCAL (auth); live NOT_RUN (aprobare) |
| T10 | Persistență după restart | runs, db | test redeschidere bază; mesajul real din UI reapare după restart | PASS_LOCAL |
| T11 | Handoff bidirecțional | handoff | 2 teste (round-trip Codex→Claude→Codex, punct sigur) | PASS_SIMULATED |
| T12 | Cotă → checkpoint, nu fallback plătit | usage, gate, codex | 3 teste | PASS_SIMULATED |
| T13 | Doi writeri nu dețin același workspace | leases | test + index unic SQLite | PASS_LOCAL |
| T14 | Owner/reviewer/QA cu dovezi distincte | runs, missions | 2 teste | PASS_SIMULATED |
| T15 | Aprobarea se invalidează la modificare | approvals | 4 teste (+HTTP) | PASS_LOCAL |
| T16 | Crash/retry fără efecte duble | recovery, runs | 2 teste (crash, pornire duplicată) | PASS_SIMULATED |
| T17 | Reconectare UI fără pierderi/duplicate | bus, SSE | test Last-Event-ID; clientul pornește de la lastSeq | PASS_LOCAL |
| T18 | Browser/desktop: oprire și scope | tools | instrumentele desktop/browser sunt blocate (Playwright neinstalat); Stop All testat | BLOCKED (necesită aprobare instalare) |
| T19 | Română: transcriere corectabilă, TTS, Stop local | voice | parser + endpoint Stop local testate; transcrierea și TTS depind de browser; voci românești locale neverificate pe această mașină | PASS_LOCAL (comenzi) / NOT_RUN (microfon real) |
| T20 | Microfon/wake word inactive fără acord | settings | vocea este dezactivată implicit; wake word refuzat de API | PASS_LOCAL |
| T21 | Prompt injection / preview fără privilegii | http, tools, claude | Host/Origin/token, traversare, SSRF, hooks neîncrezătoare refuzate; iframe sandbox | PASS_LOCAL |
| T22 | Responsive, reduced motion, fără WebGL | web | capturi reale 360/390/768/1024/1440/1920, fără overflow orizontal; nucleu static SVG verificat; reduced motion implementat, neemulat | PASS_LOCAL |
| T23 | Capabilități verificate per cont/rută | capabilities | registru cu stări separate; verificări reale de instalare și auth Claude; contul Codex neverificat (acțiune a ta) | PASS_LOCAL (parțial) |
| T24 | Plugin/evenimente resping acces neautorizat și duplicate | http, bus | token/Origin/Host; dedupe_key; companion/MCP public nu există (BLOCKED) | PASS_LOCAL |
| T25 | Regresie continuation, test Windows, vulnerabilități | V1 + deps | continuation V1: 3,3 s rece / 0,16 s cald izolat (timeout-ul de 30 s apare doar sub încărcare concurentă); symlink de fișier: NOT_RUN (EPERM), junction real PASS; nanoid 3.3.19 / postcss 8.5.28, audit 0 | PASS_LOCAL / NOT_RUN (symlink) |
| T26 | Secretele lipsesc din loguri/exporturi | redact | test redaction + evenimente stocate | PASS_LOCAL |
| T27 | Pornire/operare conform documentației | scripts | `npm run v2` / `v2:stop` / `v2:status` folosite repetat în sesiune | PASS_LOCAL |
| T28 | Nicio funcție decorativă sau succes inventat | web | stările nucleului derivă din date reale; progres = taskuri finalizate/total; funcțiile blocate au motivul afișat | PASS_LOCAL (revizie manuală) |

## Defecte găsite și reparate în sesiune

1. Invalidarea unei aprobări era anulată de rollback-ul tranzacției care arunca eroarea → `consume()` își gestionează singur tranzacțiile (test T15).
2. Atribuirile `token=…` nu erau redactate → regex extins (T26, T11).
3. Cursă: întreruperea înainte ca `turn/start` să răspundă era raportată `failed` → cererea de întrerupere este memorată, iar Hub-ul așteaptă id-ul turnului (test de regresie nou, 3 momente diferite).
4. UI: selectorul `useSyncExternalStore` returna un array nou la fiecare citire (buclă infinită, React #185).
5. UI: dialogul muta focusul la fiecare render (efect dependent de o funcție nouă).
6. UI: fluxul de evenimente relua istoricul ca notificări noi la încărcare.
7. Poartă: instalarea inspectată nu era folosită fără o verificare de cont recentă.
8. Diagnosticul OneDrive parcurgea arbori excluși (22 s, timeout) → verificare non-recursivă în directoarele copiate (4,6 s).
9. Import V1: slug `ifrim-scope-quote` ≠ `ifrim-scope-and-quote` → proiect duplicat; reparat, lotul anulat și reaplicat.
10. Bara de sus se suprapunea la 360 și 768 px → etichete scurtate/ascunse sub 400 și 1180 px.

## Neexecutat (cu motiv)

- Orice turn real Codex/Claude, întrerupere reală, review/QA real cu model: necesită aprobarea ta (LIVE_VALIDATION).
- Verificarea contului Codex (`account/read` + rate limits pe contul real): contactează serverele OpenAI cu credențialele tale; lăsată pentru click-ul tău în Integrări.
- Symlink de fișier Windows: EPERM fără Developer Mode/admin.
- Microfon real și voci TTS românești: depind de browser și de pachetele de limbă Windows.
- Playwright/desktop: instalarea necesită aprobare.
