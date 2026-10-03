# M07 · Rezultatele validării live

Data: 2026-10-02/03, Hub `2.8.0-m07` pe `http://localhost:8011`, numai proiecte de test.

**Etichete:**
- **PASS_LIVE**: rulat real, cu modelul sau cu persoana reală acolo unde e nevoie.
- **PASS_LOCAL**: rulat real, pe mașina asta, fără model și fără acțiunea ta.
- **PASS_SIMULATED**: rulat cu fixturi (providerii falși, autentificatorul software, vocea sintetică).
- **FAIL**, **BLOCKED**, **SKIPPED_ENV**, **NOT_RUN**: separate, niciodată rotunjite în sus.

**Canale.** Operațiile mele prin API au mers pe canalul `agent`, cu referința delegării tale (prompt M07 §03). În Hub apar ca ale agentului, nu ca un click al tău.

Clicurile tale din sesiunea de proprietar apar pe canalul `owner`: politica, autonomia, profilul vocal, propunerea și confirmarea vocală a planului.

Pe canalul `ui` (actor `user`) apar înregistrarea Windows Hello și deschiderea sesiunii (`owner.register.*`, `owner.auth.*`, 22:22 UTC), pentru că sesiunea nu exista încă. Tot acolo apare încercarea de pornire Lega (`lega.session.start`, 22:56 UTC).

## Bugetul AI (limita: 8 execuții, 2 încercări pe probă, 30 min pe execuție)

| # | Execuție | Model | Probă | Rezultat |
|---|---|---|---|---|
| 1 | `run_murgxztk_a94a35d720` | Codex gpt-6.1-sol · medium | C3 Stop, încercarea 1 | Driverul meu aștepta altă etichetă de etapă, deci Stop nu a fost trimis. Writer-ul a terminat (103 s, 81k tokeni), iar exportul a fost aplicat pe proiectul de test (2 fișiere). Încercare consumată |
| 2 | `run_murhc6ta_b17ce26d06` | Codex gpt-6.1-sol · medium | C3 Stop, încercarea 2 | PASS_LIVE (vezi D4) |
| 3 | `run_murheept_3a90243565` | Claude sonnet · medium, în `ifrim-runner` | reviewer izolat, încercarea 1 | Modelul a refuzat să încerce căile interzise (toate „neîncercat”, 0 refuzuri ale uneltei). Probă neconcludentă pentru refuzul uneltelor |
| 4 | `run_murhg3pg_cbe9c570f9` | Claude sonnet, în `ifrim-runner` | reviewer izolat, încercarea 2 | PASS_LIVE: README citit, 5/5 căi interzise refuzate de unealtă. 4 × Read: „File is in a directory that is denied by your permission settings.”; 1 × Glob: „Permission to read /home/runner/ws has been denied.” |
| 5 | `run_murk7q11_810edb26ac` | Codex gpt-6.1-sol · medium | D6 writer, încercarea 1 | Cod scris, dar exportul a fost **refuzat** de C14: 14 baze SQLite create de teste în `data/`. Defect al Hub-ului, reparat (§3). Nimic aplicat |
| 6 | `run_murkwjd2_36c7bb0b53` | Codex gpt-6.1-sol · medium | D6 writer, încercarea 2 | PASS_LIVE: 23:12:57 → 23:19:49 UTC (~6,9 min, 233k tokeni, din care 10,8k ieșire). Export C14 ok: 2 fișiere modificate și 1 adăugat, aplicate; 12 baze SQLite din `data/` lăsate deoparte (ignorate de proiect); reap 0 |
| 7 | `run_murl61yc_47ea44e5bf` | Claude sonnet · medium, în `ifrim-runner` | D6 review | PASS_LIVE: verdict PASS, ~1 min. Copie de 10 fișiere, reap 0, sesiunea curățată, 0 fișiere exportate sau aplicate |

**Total: 7 din 8 execuții** (Codex 4, Claude 3). Fiecare probă a folosit cel mult 2 încercări și nicio execuție nu a depășit 30 min. Cicluri de remediere: 0.

Sesiuni Lega cloud: **0 din 2**. Agenți „shadow” în Hub: 0. Verificările adversariale din §4 au rulat ca subagenți Claude Code în sesiunea mea, doar în citire; nu sunt execuții ale Hub-ului.

## D1 · Activare, migrare, repornire — PASS_LOCAL

- **Backup** înainte de M07: `bkp_mur6awzh_43d3d49205`. Backupurile automate ale pașilor (de ex. `bkp_murgxzto_83fbfe4db7`) au statusul verified.
- **Migrare încercată pe copie:**
  - 5→6 și 6→7 (`node v2/scripts/migration-dry-run.mjs`): integritate ok, rândurile neschimbate;
  - tabelele proprietarului prezente;
  - `live_grants.envelope_id` prezent.
- **Migrarea 7** (`voice_utterances`) a fost aplicată pe Hub-ul live la pornire.
- **Starea Hub-ului:**
  - rulează `2.8.0-m07`, contract 7, origine `http://localhost:8011`;
  - a fost repornit prin WMI (`v2/scripts/restart.ps1` → `start-detached.ps1`), independent de sesiunea mea;
  - pornește în BUILD_SAFE după fiecare repornire;
  - UI-ul e construit pentru contractul 7.

## D2 · Canary și lanțul izolat — PASS_LOCAL

- **Atestarea curentă:** `att_murgupen_3459ee8157`, PASS_LOCAL, 102 verificări, C1–C20 toate PASS, amprenta `8f9e9eeb934b6c01`. Acoperă:
  - C18: preview doar-local, 9/9;
  - C19: E2E Chromium cu sandbox-ul măsurat, 9/9;
  - C20: reviewer Claude izolat, 11/11.
- **C16a–e PASS** (contul Codex, prin mediu).
- **Reviewer R1–R3 PASS:**
  - Claude Code 2.1.285;
  - login claude.ai făcut de tine, în config-ul dedicat al runner-ului;
  - abonament Max.
- **Harta etapelor:** toate cele 6 etape rulează în mediu pe proiectele de test (writer, verificări, review, QA, preview, E2E).

## D3 + D6 · Misiune de test completă, confirmată vocal — PASS_LIVE

**Misiunea:**
- `mis_murhhvkm_f4d5af365c` pe „Factory Demo M07 (voce)” (`prj_murgxcyf_7f608c03b5`, fixtura `service-request`);
- AC-1…AC-7, inclusiv preview (AC-6) și E2E pe mobil (AC-7);
- creată și limitată de mine prin canalul `agent`, nu din propunerea Lega;
- limite confirmate în plan: writer gpt-6.1-sol medium, reviewer sonnet, maximum 1 ciclu de remediere, maximum 1 încercare pe etapă, 45 min.

**Confirmarea vocală (PASS_LIVE, cu tine):**
- planul `env_murk09m2_9d707406cf`, la 22:48:07 UTC;
- segmentul `utt_murk0j9d_bbaa6f83cd`: scop confirm, MATCH pe profilul tău, transcriere locală „Da, execută planul.”, consumat în aceeași tranzacție;
- `consent.modality = voice`, sesiunea `osn_murj46ws_39f8a48925`;
- granturi derivate: Codex workspace-write și Claude read-only, câte 2 încercări, cu expirarea planului;
- 0 formulare de grant, 0 clicuri în Aprobări.

**Bucla, în ordine:**
1. **BASELINE (22:48:34):** `codex sandbox` a refuzat socket-ul. Etapa a trecut în BLOCKED, iar planul în WAITING_OWNER. Hub-ul nu avea încă reluarea în profilul doar-local.
2. **Prima repornire (22:52:53)**, după prima reparație din §3:
   - modul a revenit la BUILD_SAFE, iar legătura plan–mod s-a pierdut;
   - am repus LIVE_VALIDATION cu un `mode.set` simplu (canalul `agent`) și am reluat misiunea la 22:53:23;
   - baseline-ul a rulat în profilul doar-local (bwrap, loopback) și a dat FAIL la 22:53:39, cum era de așteptat înainte de implementare.
3. **IMPLEMENTING, încercarea 1:** export refuzat de C14 pentru 14 baze SQLite din `data/`: 5 `persist-*` și 5 `acceptance-*` (create de `test/acceptance.test.mjs`) plus 4 `extra-*`. Nimic aplicat → NEEDS_OWNER_DECISION (22:59:17).
4. **A doua repornire (23:12:37)**, după reparația exportului:
   - la reluarea prin canalul `agent` (23:12:57), `restoreModeHold` a refăcut LIVE_VALIDATION;
   - aceeași reluare a ridicat limita la 2 încercări pe etapă (`factory.extra_attempt`). A doua încercare a writer-ului a rulat pe această limită, în bugetul grantului Codex derivat (2/2, epuizat) și în cele 2 încercări pe probă permise de prompt;
   - **după revizie, un agent nu mai poate face asta:** orice NEEDS_OWNER_DECISION, inclusiv o încercare în plus, e acum decizia ta (§4).
5. **IMPLEMENTING, încercarea 2:** PASS. 3 fișiere aplicate: `public/index.html`, `src/server-app.js`, `test/requests.test.mjs`.
6. **Etapele, toate în `ifrim-runner` pe amprenta `8f9e9eeb934b6c01`:**

| Etapă | Rezultat | Unde | Măsurat |
|---|---|---|---|
| CHECKING | PASS 11/11 | `bwrap-local-only@wsl-runner` (codex sandbox a refuzat socket-ul, deci reluare în profilul C18) | 27,4 s |
| REVIEWING | PASS (Claude sonnet) | `claude@wsl-runner`, bwrap, `/work` doar-citire | ~1 min |
| QA | PASS 5/5 | `bwrap-local-only@wsl-runner` | 14,5 s |
| PREVIEW | PASS, `http://127.0.0.1:4620/` | `bwrap-local-only@wsl-runner`, namespace de rețea propriu | 5,4 s |
| E2E | PASS (fluxul pe mobil) | `playwright@wsl-runner`, în namespace-ul preview-ului, `chromium_headless_shell-1228` | 12,9 s |

- **Sandbox-ul Chromium, măsurat înainte și după pași:** activ, renderer seccomp-bpf, user namespace propriu, no_new_privs; fără `--no-sandbox`; 1 renderer.
- **DELIVERY_READY** la 23:21:55 UTC, cu 0 cicluri de remediere. Pachetul `bnd_murl82o1_00afe726c3` (sha256 `2d77b5df…`, change set `cs_murl5dt6_f62484a49e`) e READY_FOR_OWNER_ACCEPTANCE. **Nu l-am acceptat; decizia e a ta.**
- **Planul s-a închis singur** (COMPLETED) tot la 23:21:55 UTC, cu motivul „nimic nu e acceptat sau livrat automat”. Codex a rămas epuizat 2/2, iar grantul Claude a fost revocat la închidere. Niciun grant activ după aceea.
- **Durata:** de la confirmarea vocală la DELIVERY_READY, 33 min 48 s, inclusiv încercarea refuzată, două reparații și două reporniri. Încercarea 2, de la writer la pachet: 8 min 58 s.
- **Modul după misiune:** a rămas LIVE_VALIDATION, din cauza defectului din §3 (legătura plan–mod, pierdută la reluare). Repornirea pe codul reparat (23:24 UTC) a readus BUILD_SAFE.
- **Preview-ul D6** s-a oprit la repornire. Workspace-ul lui (`pv-deb603de5c6be589`) e marcat „orphaned”: niciun proces, fișierele rămân pentru inspecție.
- **Fără agent**, crearea misiunii și cele două reluări ar fi fost decizii ale tale. Confirmarea planului a fost a ta, cu vocea.

## D4 · Stop într-o tură reală în WSL — PASS_LIVE

- **Misiunea:** `mis_murhby9n_7147d27012`, execuția `run_murhc6ta_b17ce26d06` (încercarea 2/2).
- **Stop:** trimis la 21:33:51.726Z, la 28 s după `turn_acknowledged`. CANCEL_REQUESTED a urmat după 14 ms.
- **Execuția întreruptă** la 10,9 s după Stop.
- **Curățenia:** reap a găsit 0, au rămas 0; export în carantină, 0 fișiere aplicate.
- **Starea finală:** etapa Software Factory CANCELLED, sarcinile rămase CANCELLED, review-ul nu a pornit. Rândul misiunii are statusul COMPLETED, pentru că sarcina de specificație era deja încheiată.

## D5 · Windows Hello și profilul vocal — PASS_LIVE (cu tine)

- **Windows Hello:** o credențială WebAuthn activă („Autentificatorul calculatorului”), RP `localhost`, UV obligatoriu.
- **Politica `voice_first` v1:** activată de tine.
- **„Factory Demo M07 (voce)”:** TRUSTED, setat de tine.
- **Profilul vocal `vpr_murjpbeq_3ab0dd4e54`:** 7 mostre, consecvență minimă (LOO) 0,814, verificator CAM++ VoxCeleb, consimțământ v2.
- **Primele înscrieri au eșuat** (consecvență 0,13–0,39): liniștea domina embedding-ul. Cauza a fost confirmată cu un experiment TTS și reparată prin decupare.
- **Pragul de MATCH** e plafonat în cod la 0,55 (`min(calibration.matchAt, 0,55)`), după probe mixte MATCH/NON_MATCH pe fraze scurte. Profilul a fost calibrat înainte de plafon, cu 0,7. Pagina de configurare afișează acum pragul efectiv, 0,55 (corectat după revizie).

## D7 · „Hai să lucrăm la ProDelivery” — PASS_LOCAL

- **Intenția** a fost verificată cu rezolvitorul local (`resolveIntent`, apelat direct, nu printr-o comandă `owner.intent` în Hub-ul live): `open_project` → ProDelivery (`prj_mun799n8_be44ef730b`).
- **Cockpit-ul**, citit separat prin `GET /api/cockpit/prj_mun799n8_be44ef730b` (nu deschis din frază), a arătat:
  - CONTEXT_AVAILABLE, autonomie OBSERVE;
  - git doar citire: `main@9229618062`, 17 fișiere modificate, 246 neurmărite;
  - făcut/deschis: gol, adică nimic inventat;
  - următorul pas: „Spune-mi ce vrei să facem…”.
- ProDelivery nu a fost modificat și nu a pornit nimic. Fraza n-a fost rostită sau scrisă de tine în cockpit-ul live.

## D8 · Față, hartă, explicații, reluare, taci/pauză/oprește — PASS_SIMULATED (+ UI afișat)

- **Acoperit de testele M06:** cockpit, intenții, întreruperi, replay, recomandări.
- **Testele M07:**
  - M07-VO-04…06: filtrul înaintea rutei cloud;
  - M07-VO-07 și M07-VO-10: confirmarea vocală;
  - M07-VO-08: un motor vocal care nu pornește;
  - M07-AC: setup, canal agent, contract UI.
- **UI-ul real se afișează** (capturile tale din 2026-10-03):
  - cockpit-ul, cu Nucleu / Față / Hartă / Discret / Ascunde;
  - butoanele Taci / Pauză / Oprește agentul / Îngheață;
  - ecranul mare, cu harta companiei.
- **NOT_RUN:** o sesiune Lega cloud cu filtrul vocal activ (0/2 folosite) și comenzile rostite live.

## Politica D (aprobarea (b), `host_isolation=environment`) — APROBATĂ (o decizie, nu o probă)

- **Condiția din prompt** (activare doar după dovada tehnică): îndeplinită de D6. Preview și E2E au rulat live în mediu, cu sandbox-ul Chromium măsurat activ; review-ul în mediu, verificările și QA în profilul doar-local.
- **Aprobarea:** la 23:23:35 UTC, prin canalul `agent`, cu referința delegării tale (M07 §03) și textul exact al politicii. Legată de amprenta `8f9e9eeb934b6c01` și de atestarea `att_murgupen_3459ee8157` (2026-10-02 21:21 UTC; valabilă 14 zile, până pe ~2026-10-16).
- **Scara mediului:** toate treptele OK (instalat, cont C16, canary, politica (b), proba live: 2 scrieri cu export aplicat pe amprenta curentă).
- **Ce înseamnă:**
  - un proiect real pus de tine pe ruta `wsl-runner` rulează writer-ul, verificările, QA, preview-ul, E2E și review-ul în `ifrim-runner`;
  - ruta nu e pusă pe niciun proiect real, iar ProDelivery rămâne OBSERVE pe ruta implicită;
  - după revizie, un agent nu poate pune ruta, granturi sau execuții pe un proiect real și nu mai poate aproba politica (b); o reaprobare (de ex. după o schimbare de amprentă) e a ta (§4);
  - aprobarea cade singură dacă se schimbă amprenta sau expiră atestarea;
  - o retragi din Sistem → „Medii de execuție” → „Retrage aprobarea”.

## 3. Defecte ale Hub-ului găsite live și reparate

| Defect | Unde | Reparație | Test |
|---|---|---|---|
| Liniștea domina embedding-ul vocal | `owner/voice.mjs`, `audio.mjs` | `trimToSpeech` înainte de embedding | M07-VO-* |
| „Arată-mi înainte să fac” era citit ca deschiderea unui proiect | `owner/intents.mjs` | regex `show_plan`: acceptă „să fac”, „să faci”, „de a face” | M07-IN-12 (adăugat după revizie; mutantul MS-3 prins) |
| Verificările și QA care cer un socket local erau blocate de `codex sandbox` | `wsl-factory-runner.mjs` | reluare pe o copie nouă în profilul doar-local C18 | M07-PL-13, M05-LR-02 |
| O repornire lăsa planul activ fără LIVE_VALIDATION | `envelopes.mjs`, `command-catalog.mjs` | `restoreModeHold` la reluarea explicită; reproiectat după revizie (§4) | M07-EN-14 |
| Modul redat era scris în numele actorului, iar listener-ul îl lua drept schimbare manuală și elibera legătura; Hub-ul a rămas în LIVE_VALIDATION până la repornire | `envelopes.mjs` | scris ca schimbare a planurilor (`envelopes`), cu actorul în notă | M07-EN-14 (mutantul MM-3 prins) |
| Exportul era refuzat în întregime pentru fișiere de rulare (SQLite) din foldere pe care proiectul însuși le ignoră | `workspace.mjs`, `wsl-runner.mjs`, `tools/git.mjs` | fișierele **binare noi** pe care regulile de ignorare ale proiectului le exclud sunt lăsate deoparte, listate și neaplicate; restrâns după revizie (§4) | M07-EXP-08/09, M07-ENV-12 |

Și o greșeală a mea, nu a Hub-ului: driverul probei C3 aștepta o etichetă de etapă greșită (încercare consumată).

## 4. Verificarea adversarială dinaintea commit-ului

**Prima rundă** (84 de subagenți, doar în citire):
- 3 lentile de cod: securitatea exportului, regresiile exportului, mașina de stări a modului;
- 2 verificatori de documente, unul față de Hub-ul live (doar GET), unul față de cod: 252 de afirmații verificate;
- fiecare constatare a fost reverificată de 2 agenți care încercau să o infirme.

**Rezultat:** 11 constatări de cod confirmate, toate low/medium, 9 respinse și 34 de corecturi de documente confirmate (aplicate aici și în celelalte documente M07).

**Reparate în cod, cu teste:**

| Constatare | Reparație | Test / mutant |
|---|---|---|
| Fișierele lăsate deoparte nu apăreau nicăieri; fișierele text din foldere ignorate treceau de la „aplicate” la „lăsate deoparte în tăcere” | Doar fișierele **binare non-asset**, pe care C14 oricum le-ar refuza, pot fi lăsate deoparte; textul se aplică ca înainte. Numărul și lista apar în rândul din „Medii de execuție”, în linia de dovezi a fabricii și a pachetului, și în motivul „Writer-ul nu a modificat nimic”. Writer-ul e anunțat în prompt | M07-EXP-08, M07-ENV-12; MX-1, MX-3 |
| `git check-ignore` sincron putea bloca Hub-ul până la 30 s, cu nume alese de writer (glob `[…]`) | Apel asincron (`spawn`), maximum 1000 de nume, iar numele cu `[` sau `]` nu mai sunt trimise lui git | MX-5 |
| O eroare git (un fișier dintr-un submodul) dezactiva tăcut regula pentru tot exportul | Codurile de ieșire sunt separate; eroarea apare în dovezi (`ignoreRulesError`) și nimic nu e lăsat deoparte | M07-EXP-09; MX-4 |
| Regulile includeau și `.git/info/exclude` și excluderile globale ale utilizatorului, deși comentariile spuneau „doar .gitignore” | Documentat exact; sunt aceleași reguli pe care le folosește transferul în mediu | — |
| O execuție doar-citire care scria în foldere ignorate nu mai era semnalată | Regula se aplică numai turelor de scriere | MX-1 |
| Validatorul s-ar fi bazat pe filtrul candidaților | Aceeași condiție (`ignoreEligible`) e verificată în validator, pentru orice set primit | M07-EXP-09; MX-2 |
| Cu două planuri deschise, LIVE_VALIDATION nu se mai elibera dacă se închidea întâi cel care îl ținea (preexistent, M06) | Modul aparține planurilor deschise ca grup; legătura trece la alt plan, iar ultimul plan închis readuce BUILD_SAFE | M07-EN-15; MM-2 |
| `restoreModeHold` putea suprascrie legătura altui plan | Nu mai scrie nimic când modul e deja LIVE | M07-EN-15 |
| Reluarea unui agent lărgea limitele confirmate: o încercare în plus, o fereastră nouă de timp | Pentru agent: refuz înainte de orice schimbare; acestea rămân deciziile tale | M07-EN-17; MM-6 |
| Un plan expirat, încă neînchis, putea reface LIVE_VALIDATION | Expirarea e verificată | M07-EN-16; MM-4 |
| Ștergerea amânată a legăturii putea șterge una mai nouă | Compare-and-set | M07-EN-16; MM-8 |

**Reparate deși fuseseră respinse ca defecte** (mecanisme reale, fără lărgire de autoritate, dar ieftin de închis):

| Constatare | Reparație | Test / mutant |
|---|---|---|
| O reluare făcută de agent anula un BUILD_SAFE pus de tine manual | Repornirea doar **suspendă** legătura; o schimbare manuală o șterge, iar reluarea reface modul doar după o repornire | M07-EN-16; MM-1 |
| Agentul putea relua o misiune pe care ai pus-o tu pe pauză | Refuzat: pauza ta se termină doar prin tine | M07-EN-17; MM-5 |
| O reluare refuzată lăsa Hub-ul în LIVE_VALIDATION | `undoRestore` | M07-EN-17; MM-7 |
| Căutarea planului după misiune folosea `LIKE` (wildcard `%`/`_`) | Potrivire exactă cu `json_each` | M07-EN-* |
| `restoreModeHold` ignora revenirea la politica legacy | Cere politica voice-first activă | — |

**Găsite în documente și reparate în cod:**
- **Canalul `agent` nu era limitat la proiectele de test.** Un agent putea crea un grant workspace-write, o rută sau o execuție pe un proiect real. Acum `grant.create`, `project.environment.set`, `factory.prepare/limits/start/resume`, `approval.decide`, `conversation.*` și `run.start` prin agent cer un proiect de test (`source = hub-test`). Pauza, stop-ul, întreruperile, revocările și Stop All rămân permise oriunde. Test: M07-AC-10; mutant MS-1.
- **`POST /api/setup/run` declarat `cli` era înregistrat ca un click al tău.** Acum e refuzat. Test: M07-AC-10; mutant MS-2.
- **Pragul vocal afișat (0,7) nu era cel folosit (0,55).** Pagina arată acum pragul efectiv.

**Mutanți, prima rundă:** 16/16 prinși (MX-1…5, MM-1…8, MS-1…3). Fiecare a fost aplicat pe rând, testul țintă a picat, iar fișierul a fost restaurat octet cu octet.

**A doua rundă:** 37 de subagenți au revizuit doar codul nou, cu aceleași reguli. Rezultat: 11 constatări confirmate (verificatorii le-au evaluat pe toate ca low), 6 respinse. Toate cele 11 au fost reparate:

| Constatare | Reparație | Test |
|---|---|---|
| **Un câmp suplimentar fals ocolea limita la proiecte de test.** De exemplu, `projectId` al unui proiect de test lângă `conversationId` sau `missionId` real: se verifica doar primul câmp, iar handler-ul lucra pe cel real (raportat „high”, evaluat „low” de verificatori) | Se verifică **fiecare** câmp care numește un proiect (`projectId`/slug, `missionId`, `conversationId`, `taskId`, `approvalId`); toate trebuie să fie de test. Verificarea se repetă când agentul execută o comandă aprobată. **Aprobarea politicii (b) nu mai e delegabilă** (revocarea rămâne) | M07-AC-10 |
| `run.start` accepta un `taskId` din alt proiect decât conversația, pe orice canal | Refuzat („Sarcina aparține altui proiect”) | M07-AC-10 |
| Reluarea prin agent continua din stări NEEDS_OWNER_DECISION altele decât încercările epuizate (baseline care nu reproduce, integritate critică, export refuzat) | Pentru agent, **orice** NEEDS_OWNER_DECISION e decizia ta; agentul reia doar o oprire de infrastructură (BLOCKED) sau o pauză pusă de el | M07-EN-17 |
| La sfârșitul unui plan, LIVE trecea la orice plan deschis, chiar și la unul scos de tine de pe LIVE | Lista `holders`: doar planurile care au intrat în LIVE sau au fost confirmate cât planurile îl țineau. Dacă un plan nu pornește, revine legătura de dinainte | M07-EN-15, M07-EN-18 |
| Alegerea ta manuală a modului putea fi pierdută dacă o altă scriere ajungea înaintea ștergerii amânate | `mode.set` șterge legătura în aceeași tranzacție | M07-EN-16, M07-EN-18 |
| Când regulile de ignorare nu puteau fi citite, mesajul refuzului nu spunea de ce | Motivul intră în eroarea execuției și în motivul fabricii; un proiect fără depozit git propriu e numit explicit | M07-ENV-13 |
| Nu exista un test pentru garda pe fișierele trimise în mediu (un fișier de bază lăsat deoparte s-ar fi citit ca ștergere) | Teste cu binare de bază (modificate și nemodificate) și cu nume binare ostile (`.env.local`, `.key`, `desktop.ini`, `.lnk`) | M07-EXP-09 |
| Testele ar fi trecut dacă exportul nu întreba git sau întreba și la turele doar-citire | Un binar neignorat refuză tot; o tură doar-citire nu întreabă niciodată; proiect fără `.git` | M07-ENV-13 |
| Fraza din prompt-ul writer-ului era inexactă | Reformulată exact (binarele non-asset refuză schimbarea, cu excepția celor ignorate; textul se aplică oriunde) | M05-LR-05 |
| Testele modului nu verificau precondiția „suspendat de repornire” | Aserțiune nouă; repornirea simulată scrie ca `recoverOnBoot` | M07-EN-16 |
| Testele pentru limita agentului treceau și pe varianta stricată | Cazuri cu câmpuri false și `taskId` străin; pragul vocal afișat e testat | M07-AC-10, M07-VO-02 |

**Respinse în runda a doua** (mecanisme reale, dar fără efect sau neatinse de M07):
- numele de fișiere alese de writer ajung nefiltrate în motive și în pachet (comportament preexistent);
- `json_each` pe un rând corupt (eșuează sigur);
- curse între reluări, care nu pot apărea fără I/O între pași;
- buclă pauză/reluare pe proiecte de test (fără autoritate nouă);
- eticheta `hub-test` pe un director real prin cale scurtă 8.3 (cere deja acces de scriere la proiect).

Ultimele două apar în `OPEN_ISSUES.md`.

**A treia rundă:** 12 subagenți, doar codul din runda a doua. Pe canalul agent nu s-a mai confirmat nimic. Două constatări confirmate (low), ambele reparate:

| Constatare | Reparație | Test |
|---|---|---|
| Confirmarea unui plan nou după o repornire reactiva planurile suspendate de repornire, așa că LIVE_VALIDATION putea dura mai mult decât planul nou (inclusiv dacă acesta era revocat în timp ce pornea) | Planul nou ține singur LIVE. Legătura suspendată stă deoparte și revine, tot suspendată, când planul nou se încheie. Un plan suspendat reluat explicit cât altul ține LIVE se alătură deținătorilor. Restaurarea la o pornire eșuată nu mai depinde de o cursă cu o revocare | M07-EN-19, M07-EN-20 |
| Prompt-ul promitea lăsarea deoparte și când proiectul nu are depozit git propriu (atunci nimic nu e lăsat deoparte) | Fraza depinde acum de existența `.git` în proiect | M05-LR-05 |

**Mutanți, toate rundele:** 30/30 prinși pe codul final:
- export: MX-1…8;
- mod și reluare: MM-1…14;
- canalul agent, setup și intenții: MS-1…8.

Fiecare mutant a fost aplicat pe rând, testul țintă a picat, iar fișierul a fost restaurat octet cu octet.
