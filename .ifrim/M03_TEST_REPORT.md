# M03 · Raport de teste

Data: 2026-10-01. Versiune: `2.4.0-m03`. Mediu: Windows 11, Node 24.14.0. Codex CLI instalat 0.159.2 și Claude Code 2.1.175, dar **neutilizați**: testele folosesc doar fixture-urile `fake-codex` / `fake-claude`.

Suitele sunt raportate separat, fără un procent global.

## 1. Suita V2 (`npm run test:v2`, fără modele)

Rezultatul final: vezi §5 (completat după rularea completă).

Fișiere noi M03:

| Fișier | Teste | Ce acoperă | Status |
|---|---|---|---|
| `m03-readiness.test.mjs` | 17 | plan model/efort, cronologie, R2/R3, spec, plan, integritate, validarea review-ului, diff, parsarea runner-ului, poarta (R2, `run_plan`), efort `max` moștenit oprit, MCP la reluare | PASS_LOCAL / PASS_SIMULATED |
| `m03-factory.test.mjs` | 1 | Demo A cap-coadă | PASS_SIMULATED |
| `m03-factory-flows.test.mjs` | 24 | Demo B (cu E2E real), review loop, INCONCLUSIVE, integritate, stagnare, Stop, Stop All, pauză, restart, aprobări idempotente, grant revocat, un singur writer; FAC-14…25: pauză/Stop/termen în fiecare fereastră, baseline și verificări complete la reluare, pornire refuzată imediat, încercări, ciclu suplimentar, teste sărite | PASS_SIMULATED |
| `m03-factory-integration.test.mjs` | 4 | handoff cu context, pachet STALE, Lega fără autoritate, gărzi statice | PASS_SIMULATED / PASS_LOCAL |
| `m03-guards.test.mjs` | 4 | review STALE la fișiere schimbate, plafonul restituirilor, consumul vocii UNKNOWN, helperele UI | PASS_SIMULATED / PASS_LOCAL |
| `m03-browser.test.mjs` | 8 | pașii E2E validați; **browserul real** (Playwright 1.61.0, Chromium 1228 cu sandbox OS): inspecție izolată, E2E pe formularul Demo B pe mobil, E2E care pică la pasul exact | PASS_LOCAL (SKIPPED_ENV fără Playwright) |

Testele M01/M02 existente rămân, cu aceleași aserțiuni. Niciun test nu a fost relaxat sau retras.

După instalarea Playwright, două teste M02 și unul M03 au devenit dependente de mediu, fără să fie relaxate:
- **RT-03:** verifică ramura „neinstalat” pe o cale din afara Hub-ului, iar ramura „instalat” cere aprobare pe URL-ul exact și nu rulează nimic fără ea.
- **RT-04:** statusul trebuie să corespundă instalării reale.
- **FAC-02:** cu Playwright, AC-7 trebuie să fie PASS_EVIDENCE, cu E2E PASS pe versiunea verificată (12 pași, captură); fără el, NEEDS_INSTALL_APPROVAL.

Pe parcurs au picat și au fost reparate în cod (nu în teste):
- **M01-NI1:** problema de plan apărea înaintea porții; acum e verificarea `run_plan` a porții.
- **M01-NG1:** forma de pornire a runner-ului.
- **M01-SKILL-01/02/09:** rolul `qa` adăugat greșit pe skill-ul `release`.

## 2. Suita V1 (`npm test`)

Codul V1 nu a fost modificat în M03: `src/`, `apps/`, `tools/` și `tests/` sunt neatinse; în `package.json` s-a adăugat doar scriptul `v2:factory-fixture`.

**Rularea din 2026-10-01 (108 s):** 552 de teste: **548 PASS, 3 FAIL, 1 omis**.

Cele 3 FAIL sunt toate timeout-uri de 30 s, în fișierele care apelează **API-ul V1 live de pe 8004**:
- `continuation-api-contract.test.mjs`: 1;
- `model-policy-api.test.mjs`: 2.

**Condiții la momentul rulării:**
- serverul V1 de pe 8004 răspundea, dar lent: `/api/health` în 5,6 s;
- rulate separat, cele 3 pică și ele azi (în M02 treceau separat), deci depind de starea serverului V1, nu de suita completă.

**Ce nu am făcut, conform regulii:** nu am pornit, oprit sau modificat V1 și nu am mărit timeout-urile.

**Verdict:** dependență de mediu (API V1 live lent), nu o regresie M03. Dovada: niciun fișier V1 schimbat; eșecurile sunt doar în testele care fac cereri HTTP la 8004.

## 3. Fixture-urile, rulate direct (PASS_LOCAL)

Comandă: `node --test` într-o copie a fixture-ului, pe 2026-10-01.

- **`bug-demo`:**
  - înainte de fix: 5 teste, 4 trec, **1 pică** (AC-1, motivul așteptat);
  - după patch-ul `bug-fix`: **6/6**.
- **`service-request`:**
  - schelet: **5/5 pică** (API-ul răspunde 501);
  - după patch-ul `feature-b`: **7/7** (integrare reală: server HTTP local + node:sqlite de test).

## 4. Probe OS / provider / browser

| Probă | Status | Motiv |
|---|---|---|
| Canary Codex pe arbore fictiv (R3 DENIED, `KNOWN_GAP_R2`) | **PASS_LOCAL** (2026-10-01, la cererea ta) | 50 de verificări trecute: `config.toml`, `config.toml.bak` și `history.jsonl` DENIED, runner-ul sandbox funcționează; 4 citiri ale proiectului „alt client” ALLOWED = `KNOWN_GAP_R2` (R2 deschis, nu e trecut ca izolare); arbore șters |
| Măsurarea sandbox-ului fără model, profil fictiv | **PASS_LOCAL** (2026-10-01) | prima comandă 4,7 s; următoarele 3,7–6,4 s (N = 6); detalii în `M03_PERFORMANCE_REPORT.md` §3.1 |
| Măsurarea sandbox-ului, profil real (`--real-profile`) | NOT_RUN | reaplică DENY-urile reale; o rulezi tu |
| Runner sau preview sub `codex sandbox` real, prin fabrică | NOT_RUN | odată cu validarea live 2.1 |
| Playwright 1.61.0 instalat (fără descărcare; Chromium 1228 din cache) | **PASS_LOCAL** (2026-10-01, la cererea ta) | Browser Workspace: `available`; Chromium pornit cu sandbox-ul OS (`chromiumSandbox: true`) |
| Browser real: inspecție izolată (M03-BR-01) | **PASS_LOCAL** | pagina locală se încarcă, celelalte origini sunt blocate (inclusiv `example.com`), o captură scrisă |
| Browser real: E2E pe formularul Demo B, mobil 390 px (M03-BR-02) | **PASS_LOCAL** | 12 pași: fără depășire orizontală → trimitere validă → „Solicitarea a fost trimisă.” → listă → trimitere goală → „Corectează câmpurile marcate.” |
| Browser real: E2E care pică (M03-BR-03) | **PASS_LOCAL** | raportează exact pasul care pică (text lipsă, depășire 900 px > 390 px); nu pretinde niciodată PASS |
| Fabrica cap-coadă cu E2E real (FAC-02, Demo B) | **PASS_SIMULATED** + browser real | provideri falși, dar E2E rulează în Chromium real pe preview-ul versiunii verificate; AC-7 → PASS_EVIDENCE cu captură |
| Execuții cu model (Codex, Claude, Lega) | NOT_RUN | fără aprobare de inferență în M03 |
| Build UI (`npm run build:v2`) | PASS_LOCAL | — |
| Verificare vizuală a ecranelor noi | vezi §5 | — |
| Testul de symlink (SKIPPED_ENV din M02) | SKIPPED_ENV | Windows fără Developer Mode: s-a testat doar junction-ul, nu symlink-ul; nu e trecut |

## 5. Rezultatele rulărilor

### Rularea completă 1 (2026-10-01, `node --test --test-concurrency=1 "v2/tests/*.test.mjs"`, 58 min)

282 de teste: **275 PASS, 6 FAIL, 1 SKIPPED_ENV**. Toate cele 6 eșecuri au fost tratate:

| Test | Cauza | Tratare |
|---|---|---|
| M01-NG1 | runner-ul pornea `ready.binary.executable`, o formă nerecunoscută de scanarea statică | cod: aceeași variabilă `binary` ca la provideri (testul neschimbat) |
| M01-SKILL-01/02/09 | rolul `qa` adăugat pe skill-ul `release` nu avea nicio unealtă permisă | cod: revenire la rolul `devops` (testele neschimbate) |
| M03-LEGA-12 | instabil sub încărcare (build UI rulat în paralel) | trece rulat separat; reconfirmat în rularea 2 |
| M03-RF-01 (ultima parte) | aserțiunea „fără model cerut, Codex își păstrează implicitul și nu e oprit” | **cerință înlocuită explicit** de M03 §09/T06: Hub-ul trimite acum implicitul contului din `model/list`, deci o variantă raportată oprește execuția. Aserțiunea e înlocuită cu acoperirea succesoare (blocked, model trimis explicit, `modelSource`), iar restul testului a rămas neschimbat. În fixture-ul fake s-a adăugat un al doilea model, „gpt-5”, ca verificarea exactă a adaptorului să rămână testată după poartă |

SKIPPED_ENV: T25 (symlink de fișier, EPERM fără Developer Mode). Junction-ul e testat; symlink-ul nu e trecut.

### Rularea completă 2: finală, cu toate reparațiile (2026-10-01, aceeași comandă, 36 min)

286 de teste: **283 PASS, 2 FAIL, 1 SKIPPED_ENV**.

| Test | Cauza | Dovadă după |
|---|---|---|
| M03-GRD-03 | greșeala mea în test: fără sesiune, `lega.state()` e `null`, iar testul aștepta un obiect | aserțiunea corectată („fără sesiune, nicio cifră de consum”); `m03-guards` 4/4 |
| T07 (providers, preexistent, cu limită de timp 4,5 s) | sensibil la încărcare: am rulat o depanare în paralel | rulat separat: 3,7 s, PASS |

Recontrol curat, fără altă încărcare: `node --test --test-concurrency=1 v2/tests/providers.test.mjs v2/tests/m03-guards.test.mjs` → **15/15 PASS**.

**Concluzie V2:** 286 de teste; 285 PASS după recontrol, 0 FAIL rămase, 1 SKIPPED_ENV (symlink).

### Rularea completă 3: după Playwright și E2E (2026-10-01, aceeași comandă, 12,5 min)

**290 de teste: 289 PASS, 0 FAIL, 1 SKIPPED_ENV** (T25, symlink de fișier, EPERM fără Developer Mode). Include cele 4 teste noi cu browserul real și FAC-02 cu E2E real.

### Rulările complete 4–7: după fiecare rundă de reparații (2026-10-01, aceeași comandă)

| Rularea | Teste | PASS | FAIL | SKIPPED_ENV | Durata |
|---|---|---|---|---|---|
| 4 (runda 1) | 295 | 294 | 0 | 1 | 14,4 min |
| 5 (runda 2) | 301 | 300 | 0 | 1 | 18,2 min |
| 6 (runda 3) | 307 | 305 | **1** | 1 | 13,2 min |
| 7 (finală) | 307 | **306** | **0** | 1 | 14,0 min |

FAIL-ul din rularea 6 a fost M01-HTTP-01: `EADDRINUSE` pe portul aleator 18789, deja ocupat de un proces `node.exe` pornit înainte (nu de mine; nu l-am atins). Rulat separat: 3/3 PASS. Reparația e în infrastructura de test: hub-ul de test primește de la sistem un port liber în acel moment (`freePort()`), nu unul aleator dintr-un interval fix. Aserțiunile nu s-au schimbat. Rularea 7 e cea curată.

### Alte verificări

- `npm run build:v2`: OK (și după modificările E2E).
- `npm audit`: 0 vulnerabilități (2026-10-01, și după instalarea Playwright).

### Verificare vizuală în simulator (browser intern, 2026-10-01)

- **Flux complet din UI, PASS_SIMULATED:**
  - „Fabrica A” → misiunea → „Cere aprobarea scope-ului” → „Aprobă și pornește” (hash afișat);
  - baseline FAIL → Codex fixture → verificări PASS → review PASS → QA PASS;
  - `DELIVERY_READY` → „Accept local” → `ACCEPTED`, pachet `OWNER_ACCEPTED`, 7/7 taskuri COMPLETED.
- **Bug găsit și reparat:** panoul citea `command.id`, dar HTTP întoarce `commandId`.
- **Telefon (280 px):**
  - depășire orizontală de la calea pachetului și de la tokenul `READY_FOR_OWNER_ACCEPTANCE` → reparat (`overflow-wrap`);
  - butoanele bannerului simulatorului ieșeau din ecran (preexistent, agravat de cele 3 butoane noi) → derulare în banner;
  - după reparații, fără depășire orizontală la 280 px și la 1280 px.
- **Integrări → Izolare → R2:** se afișează corect (proiect de test admis; proiectul demo cu risc acceptat, marcat „nu este o izolare”).
- **Nerulate:** FPS, „reduced motion”, cititor de ecran (ca în M02).

### Hub-ul live după repornire (2026-10-01, 05:35 ora României)

- Backup verificat `bkp_muox3o1y_de8f59b508` (453 de fișiere) înainte de repornire.
- Hub-ul rulează pe `2.4.0-m03`, în BUILD_SAFE; migrarea 3 e aplicată; poarta neschimbată (deschisă, cum a lăsat-o proprietarul); 0 execuții, 0 sesiuni Lega.
- Previzualizarea porții pentru Codex pe „Ifrim Hub Test” arată exact ce trebuie:
  - `run_plan`: NU (lipsește `model/list`);
  - `isolation`: NEEDS_LIVE_APPROVAL (amprentă `9cab02fd58238507` → `0f5b7efee0143fa8`, R3);
  - `host_isolation`: OK (proiect de test);
  - `mode`: BUILD_SAFE.

### Hub-ul live după a doua repornire (2026-10-01, 07:24 UTC)

- Backup verificat `bkp_mup7k806_6a6c984ce2` (454 de fișiere) înainte de repornire.
- Hub-ul rulează pe `2.4.0-m03` cu codul E2E: BUILD_SAFE, poarta deschisă (cum a lăsat-o proprietarul), 0 granturi active, 0 misiuni ale fabricii, nicio execuție.
- Browser Workspace: `available`, Playwright 1.61.0. Runner-ul fabricii găsește `codex.exe` (CLI 0.159.2).
- Previzualizarea porții, Codex workspace-write pe Demo A: singura verificare care refuză e `mode` (BUILD_SAFE). `run_plan` (`gpt-6.1-sol` · `medium`), `isolation` (acordul `0f5b7efee0143fa8`, dat de proprietar din UI) și `host_isolation` (proiect de test) sunt OK. Grantul lipsește, cum trebuie.

## 6. Verificarea dinainte de commit (2026-10-01, la cererea de commit și push)

Rulată ca workflow cu mai mulți agenți (ultracode), **doar citire**: 3 recenzenți în paralel (secrete și date personale, igiena setului de fișiere, review pe codul E2E), apoi o verificare adversarială pentru fiecare problemă (cel mult 6).

**Rezultat pentru commit:** nimic care să blocheze.
- Fără secrete sau date personale reale: numai date fictive, amprente de liste și id-uri locale ale Hub-ului.
- Setul are 105 fișiere, exact cele din `git status`, fără build sau date de rulare.
- Lockfile-ul conține doar `playwright` / `playwright-core` 1.61.0, plus `fsevents` opțional (macOS).

**Probleme reale confirmate în codul M03 și reparate înainte de commit:**

| # | Severitate | Problemă | Reparație | Test |
|---|---|---|---|---|
| 1 | ridicată | Pauza în timpul unui pas al runner-ului (baseline, verificări, QA, preview, E2E) omora procesul. „FAIL”-ul ducea la remediere, deci **o execuție Codex putea porni deși misiunea era pe pauză**. | `halted()` după fiecare pas așteptat; comanda oprită devine INTERRUPTED (exclusă din dovezi); niciun dispatch, finding sau etapă nouă pe pauză | **FAC-14**, cu verificare prin mutație: cu comportamentul vechi, testul pică exact cu remedierea nedorită |
| 2 | medie | Pașii E2E (texte, selectori) nu ajungeau la writer și la reviewer | pașii aprobați apar, doar-citire, în ambele brief-uri; finding-ul E2E poartă pasul așteptat | FAC-02, REV-01 |
| 3 | medie | AC-7 nu era repetabil: aceleași date în 10 min → 409 | `{run}` devine un cod unic la fiecare rulare | BR-04 |
| 4 | medie | `goto` nu urma o redirecționare în aceeași origine | bucla limitată, ca la inspecție; HTTP ≥ 400 pică pasul | BR-04 |
| 5 | medie | Un browser care nu pornește era tratat ca defect de cod (remediere inutilă cu model) | BLOCKED („infrastructura browserului”), fără finding, fără remediere | **FAC-15** |
| 6 | medie | `page.evaluate` fără limită de timp putea bloca misiunea | limită pe fiecare apel + termen total; Stop/Pauză închid browserul imediat | BR-05, BR-06 |

**Probleme minore, reparate și ele:**
- pași fără `goto` refuzați (BR-00);
- portul preview-ului trebuie să fie liber (nu pornește peste alt server);
- pachetul folosește cea mai nouă dovadă, nu prima;
- viewport-ul implicit e desktop până la un pas `viewport`;
- RT-03 acoperă din nou ramura „Playwright neinstalat” la nivel de Hub (`browserRoot`);
- fixture-urile de review nefolosite sunt acum testate;
- `.gitattributes` forțează LF pentru fixture-uri.

### 6.2 A doua verificare, pe reparații: 3 perspective + verificare adversarială

S-au confirmat probleme noi, în cea mai mare parte **preexistente** în logica de pauză și reluare a fabricii. Toate sunt reparate și au test.

| Severitate | Problemă | Reparație | Test |
|---|---|---|---|
| ridicată | Pauză cât timp execuția încă pornea (backup, git): modelul pornea totuși, iar misiunea arăta PAUSED | pornirea e urmărită; execuția apărută după pauză e întreruptă imediat; reluarea face o încercare nouă | **FAC-19** |
| ridicată | Reluarea după un baseline BLOCKED (runner neconfigurat, de exemplu acordul ACL) pornea writer-ul fără baseline | baseline-ul contează doar complet (fiecare comandă, fără BLOCKED sau INTERRUPTED); altfel rulează din nou | **FAC-16** |
| ridicată | Reluarea după o pauză pe a 2-a verificare sărea verificările rămase și pornea review-ul | completitudine pe lista aprobată de comenzi; o etapă rulată din nou înlocuiește rezultatele vechi | **FAC-17** |
| medie | Stop în timpul pornirii: CANCELLED devenea BLOCKED (reluabil) | CANCELLED se confirmă doar după ce nu mai e nimic în curs; o etapă finală nu mai poate fi redeschisă | **FAC-20** |
| medie | Termenul atins cât timp pornea preview-ul: misiunea mergea mai departe, până la pachet | orice etapă care nu e activă oprește pasul în curs | **FAC-18** |
| medie | Un rând BLOCKED vechi forța verificări și review-uri repetate | se folosește doar ultimul rezultat pe comandă | FAC-16 / FAC-17 |
| medie | Un rezultat terminat în timpul pauzei era aruncat și refăcut (o execuție cu model în plus) | e păstrat (DONE_LATE) și evaluat la reluare | cod + revizuire |
| medie | Reluarea după termen nu putea avansa | reluarea prelungește termenul ca decizie a ta (eveniment `factory.deadline_extended`) | FAC-18 |
| medie | `idle()` nu se termina niciodată (`serial()` nu ștergea lanțul) | comparație pe promisiunea păstrată | FAC-18 (`idle()` cu limită) |

Minore, reparate și ele:
- un browser care moare în timpul E2E înseamnă infrastructură, nu defect (BR-07);
- `{run}` funcționează și în `expectText` (BR-04);
- pașii E2E invalizi nu se mai pierd la revizie, iar editorul din UI îi păstrează (SPEC-02, guards);
- eticheta corectă pentru BLOCKED;
- taskul pasului oprit devine PAUSED;
- închiderea Hub-ului oprește E2E-ul;
- testele de browser au limită de timp și își curăță folderele.

**Verificare prin mutație:** am anulat pe rând fiecare reparație importantă (FAC-14, 16, 17, 18, 19, 20). De fiecare dată testul ei a picat, iar codul a fost restaurat. Testele chiar prind problemele.

**Limitare documentată (nereparată):** un formular care trimite prin POST și răspunde cu redirecționare (post-redirect-get) nu e urmat de filtrul de cereri. E o politică deliberată din M02, testată în RT-07. Pasul pică, iar motivul apare în dovezile E2E (`network.blocked`).

### 6.3 A treia verificare: 2 perspective, verificare adversarială, probe cu provideri falși

**Constatare principală:** reparațiile din runda a doua **nu strică fluxurile normale**. Fiecare pas pornește dintr-o etapă activă setată de apelant.

S-au confirmat cazuri-limită noi, în mare parte preexistente. Toate sunt reparate și au test.

| Severitate | Problemă | Reparație | Test |
|---|---|---|---|
| ridicată | O pornire refuzată imediat de adaptor (plan MCP, hooks în workspace, model refuzat) nu era văzută: misiunea arăta „modelul lucrează” până la termen | dispatch-ul e găsit și după id-ul lui (`correlation_id`); misiunea devine BLOCKED, cu motivul real | **FAC-21** |
| medie | Pauzele consumau încercările, iar după limită nu mai era nicio cale înainte | întreruperile tale (Pauză, Stop, termen) nu sunt încercări; o reluare după încercări epuizate e decizia ta de a mai permite una | **FAC-22**, **FAC-25** |
| medie | „Încă un ciclu” după un QA, preview sau E2E eșuat reluma doar QA pe același cod | ciclul suplimentar merge la writer; bugetul aprobat nu mai scade | **FAC-23** |
| medie | Un test sărit trecea drept PASS la o reluare simplă | o singură regulă „trecut” (fără skip/todo) peste tot: verificări, QA, reluare, pachet | **FAC-24** |
| medie | Progresul era umflat de rezultatele vechi ale aceleiași versiuni | progres măsurat pe ultimul rezultat pe comandă și pe findings distincte | cod + revizuire |
| medie | Reluarea imediat după o pauză în timpul pornirii era anulată de rezultatul întârziat | un rezultat întrerupt de tine nu mai schimbă etapa | FAC-19 |

**Minore, reparate:**
- brief-ul de remediere listează doar eșecurile versiunii curente;
- termenul e verificat înainte de a număra un ciclu de remediere;
- un rezultat întârziat e evaluat indiferent de opțiunea de reluare;
- acceptarea sau respingerea refuză dacă un Stop a intervenit între timp;
- `tick()` mută la decizia ta doar o misiune pusă efectiv pe pauză;
- `recover()` închide taskurile unei misiuni oprite;
- pașii E2E de orice formă rămân în ciornă;
- portul preview-ului se verifică la nivel TCP (RUN-02).

**Verificare prin mutație:** FAC-21, 22, 23 și 24, fiecare anulat pe rând. Toate au picat, iar codul a fost restaurat.
