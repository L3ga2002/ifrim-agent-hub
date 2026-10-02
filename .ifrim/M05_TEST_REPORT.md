# M05 · Raportul de teste

Data: 2026-10-02.
- **Statusuri:** PASS_LOCAL (real, fără model), PASS_SIMULATED (fixture), PASS_LIVE (cu model; **niciunul în M05**), FAIL, BLOCKED, NOT_RUN, SKIPPED_ENV.
- **Testele nu fac nimic din următoarele:** nu instalează pachete, nu pornesc modele, nu schimbă ACL-uri sau setări globale, nu rulează `wsl.exe` (în teste, `wsl.exe` e fixture-ul `v2/tests/fixtures/fake-wsl.mjs`).

## Suitele automate

| Suită | Total | PASS | FAIL | SKIPPED_ENV | Notă |
|---|---|---|---|---|---|
| V2 (`npm run test:v2`) | 500 | 499 | 0 | 1 (T25, symlink de fișier fără privilegiul Windows) | după reparațiile dinaintea probei; înainte: 494 / 493 / 0 / 1; baseline M04: 450 / 449 / 0 / 1 |
| V1 (`npm test`) | 552 | 551 | 0 | 1 | baseline: 552 / 551 / 0 / 1 |

## Fișierele de test noi (T01–T20)

| Fișier | Teste | Ce acoperă (T) | Status |
|---|---|---|---|
| `m05-environment.test.mjs` | ENV-01…05 | inspecție, C16, atestare; o execuție completă prin mediu; poarta fără atestare; (b) legat de amprentă; atestarea fixture e PASS_SIMULATED, nevalidă în afara testelor (T02, T04, T17) | PASS_SIMULATED |
| `m05-routes.test.mjs` | RT-01…13 | argv/env (T01); contul prin mediu (T02); profiluri ro/rw, efort, MCP, MCP inline (T03); amprenta schimbată între poartă și dispatch (T04); expirare, revocare, dispatch concurent (T05); verificări/QA în mediu, socket → BLOCKED (T10); R2 pe runner-ul Windows, review neschimbat (T10, T11); Stop în turn (T12); restart (T13); preflight, eșec la copiere (T15); canalul cli (T17); proiect de 4.200 de fișiere (T18); probleme de graniță | PASS_SIMULATED (RT-12, RT-13: PASS_LOCAL, fără WSL) |
| `m05-export.test.mjs` | EXP-01…07 | nume ostile (T07); tipuri, căi protejate, coliziuni (T07); cititorul strict (T07); aplicare: conflict, junction, rollback (T08); transfer cu modificări necomise (T06); fsmonitor (T09, cu control pozitiv); round-trip diacritice, CRLF, binar (T19) | PASS_LOCAL |
| `m05-review-fixes.test.mjs` | RV-01…10 | constatările review-ului: 8.3 / `.GIT` / control la orice adâncime / `.scf` (F1, F3, F4); junction (F2); secrete după conținut, `build/` urmărit (F7, F8); mtime falsificat, identități git (F5); Stop în export, în copiere, în comanda runner-ului; atestare în curs; reap neconfirmat; escaladare refuzată | PASS_SIMULATED / PASS_LOCAL |
| `m05-factory-stop.test.mjs` | FAC-01 | Stop în timpul unei comenzi QA (T12) | PASS_SIMULATED |
| `m05-browser-prg.test.mjs` | BR-01, BR-02 | RT-07: POST → 303 → pagina de rezultat, un singur POST; 307 și 303 spre altă origine refuzate (T14) | PASS_LOCAL (Chromium real pe **Windows**; nu e o probă Linux) |
| `m05-lega-diagnostics.test.mjs` | LEGA-01…03 | eroare după conectare, persistată redactat; activitate ca dovadă; restituire limitată (T16) | PASS_SIMULATED |
| `m05-ui-logic.test.mjs` | UI-01…03 | trepte separate, fără „verde” unic; formularul (b); ecranul nu trimite nimic singur; Lega arată motivul (T17) | PASS_LOCAL |

**T20 (regresia M01–M04):** suita V2 completă de mai sus. Testele M01/M03 modificate sunt doar două:
- lista canalelor include acum `cli` (adăugare intenționată);
- verificarea statică NG1 s-a **întărit**: și apelurile `gitSync` trebuie să fie subcomenzi literale doar-citire.

## Verificări reale în `ifrim-runner` (2026-10-02, fără model, aprobate)

| Verificare | Rezultat |
|---|---|
| Schema app-server 0.159.2 generată în mediu | 167 de metode client. `thread/shellCommand` („unsandboxed with full access”) și `process/spawn` („without a Codex sandbox”) sunt excluse din lista albă; `command/exec` rulează în sandbox |
| Canary C1–C17 (driverul manual) | **PASS_LOCAL 71/71**, amprenta `7b3afa6ae2a7d1f3` neschimbată pe durata rulării, 60 s. Prima rulare: 66/66 |
| C14 pe arhive GNU tar reale | **26/26** (21 + cazurile din review) |
| C16 | cont `chatgpt`, plan `prolite`, 8 modele, profilurile permise, limite citite, fără thread/turn |
| Socket-uri în sandbox (rețea oprită) | `listen` TCP/Unix → EPERM; `connect` → EPERM; procesul copil Node cu pipe pierde ieșirea asincronă; `node --test` și `npm test` simple → PASS |
| Stop: omorârea `wsl.exe` | un proces Linux simplu moare; arborele `codex sandbox → bwrap → sh → sleep×2`: 0 procese rămase, 0,9–1,9 s (n=4); detectorul validat cu control pozitiv |
| Preflight | pornirea distribuției la rece 8–39 s; sandbox 1,6–2,7 s; total 3,6–6,7 s (n=5, cu suita rulând în paralel) |
| Inspecție | 8–39 s (include pornirea distribuției) |

## Verificări de mutație (mutantul trebuie să pice testul)

| Mutant | Test | Rezultat |
|---|---|---|
| `prg = false` (RT-07 dezactivat) | BR-01 | prins |
| fără `core.fsmonitor=false` | EXP-06 | prins (după ce testul a primit un control pozitiv; prima variantă nu îl prindea) |
| fără reverificarea amprentei la dispatch | RT-04 | prins |

## Review adversarial (3 subagenți doar-citire)

- **Securitate:** 2 HIGH, 7 MEDIUM, câteva LOW. Toate reparate, cu teste (RV-01…03, RV-10, EXP-*).
  - **F1:** 8.3, majuscule și control la orice adâncime. Pe Windows, `GIT~1/hooks/pre-commit` ajungea în `.git/hooks`.
  - **F2:** junction în calea git.
  - **F5:** snapshot-ul git păcălit prin mtime.
  - **F6:** reverificarea după rulare, escaladări, reaper.
  - **F7:** secrete.
  - **F8:** `build/` urmărit.
  - **F9:** rollback, git diff și textconv.

  Neadresate, documentate:
  - nonce pentru (b) (oricine are tokenul local e tratat ca UI, ca în tot Hub-ul);
  - limita de spațiu pe disc a workspace-ului (VHD-ul e plafonat la 40 GB).
- **Corectitudine:** 4 MEDIUM, câteva LOW, toate reparate:
  - Stop în export, Stop în copiere, Stop în comanda runner-ului;
  - repornirea C15 sub o execuție;
  - lease reținut;
  - identități git;
  - fișiere ignorate;
  - etichete pre-inferență;
  - mediul execuțiilor blocate;
  - suprafața de politică;
  - Lega `code` redactat;
  - limita de erori.
- **Onestitatea raportării:** 8 MEDIUM, 6 LOW, toate reparate:
  - atestarea fixture marcată SIMULATED;
  - contul cu vechime și amprentă;
  - treapta „live” doar cu export aplicat pe amprenta curentă;
  - pachetul de livrare din dovezi, nu din ruta curentă;
  - textul (b) complet;
  - formulări „izolat” corectate;
  - versiunea canary-ului din hash;
  - bwrap și tar în amprentă.

## Ce NU s-a testat

- **Niciun turn de model prin `wsl-runner`** (proba (c)); deci nici exportul unui writer real, nici Stop-ul unui turn real în mediu.
- **Preflight-ul Windows**, care folosește profilul real cu ACL.
- **Atestarea înregistrată în Hub-ul live**, care încă rulează codul M04.
- **UI-ul nou în Hub-ul live:** build-ul trece și logica e testată, dar ecranul nu a fost văzut.
- **Lega live** după schimbările de diagnostic.

## Verificări înainte de proba live (2026-10-02, după atestarea din Hub)

**Ce s-a rulat:** un workflow doar-citire de 35 de agenți, 4 investigatori plus 31 de verificatori adversariali, care a întrebat: ar irosi prima probă (c) o încercare reală? Răspunsul a fost **da**, din două motive:
1. Un defect real în cod.
2. Starea Demo A.

### Blocaje confirmate

**1. Curățarea proceselor (`reap.sh`) se număra pe ea însăși în modul „all”**
- Modul acesta e folosit după fiecare turn de writer, când rularea e singură în mediu.
- Fiecare turn real s-ar fi terminat FAILED după inferență: exportul necitit, munca writer-ului ștearsă, lease-ul proiectului reținut și încercarea consumată.
- Testele nu îl puteau vedea, pentru că `fake-wsl` nu rulează bash.
- **Confirmat real în `ifrim-runner`, fără model:** v1 în modul „all” pe un workspace gol a raportat `found=3 remaining=3`.
- **Reparat** în `reap.sh` v2: sunt excluși strămoșii (relay-ul wsl, `env`) și descendenții (subshell-urile `$(...)`, `tr`, `wc`, `stat`, `sleep`).
- **Real, v2:**
  - C15r (marker): procesul din workspace a fost oprit, cel din afară neatins, `remaining=0`;
  - C15s (all): procesul din afară a fost oprit, `remaining=0`, în 4,5 s.
- **Verificarea face acum parte din atestare** (C15r/C15s, doar când mediul e liber). `reap.sh` intră în versiunea canary-ului, deci **atestarea înregistrată la 02:13 UTC nu mai e validă** și trebuie refăcută.

**2. Demo A conține deja reparația acceptată (necomisă)**
- Baseline-ul BUGFIX ar trece, iar misiunea s-ar opri înainte de writer.
- Nu e un defect de cod. Proba cere un proiect hub-test nou, din fixture, de exemplu `ifrim-factory-demo-a2`.

### Riscuri confirmate și reparate

- **`node --test` în sandbox-ul Linux.** Fiecare fișier de test rulează într-un proces copil citit prin pipe, iar sandbox-ul pierde acea ieșire.
  - **Real:** cu izolarea implicită a venit doar `not ok 1 - test/fail.test.mjs`, fără textul erorii. Deci baseline-ul BUGFIX nu și-ar fi găsit textul așteptat.
  - Cu `--test-isolation=none` vin toate liniile, inclusiv `listen EPERM` în testul lui.
  - Runner-ul din mediu setează acum `NODE_OPTIONS=--test-isolation=none`, verificat real și pentru `npm test`.
  - **Diferență față de Windows:** fișierele de test împart un proces.
- **Clasificarea BLOCKED era prea largă.** O singură linie EPERM transforma și un eșec real în BLOCKED. Acum rezultatul e BLOCKED doar dacă **toate** testele eșuate arată refuzul de socket; un eșec real lângă ele rămâne FAIL și ajunge la remediere.
- **Escaladări.** O cerere „rulează fără sandbox” nu are mereu câmpurile de permisiuni, așa că ajungea la proprietar ca o comandă obișnuită. Pe ruta de mediu, **orice** aprobare de comandă sau de fișiere e acum refuzată automat, cu motivul afișat în rulare.
- **Exportul cu intrări-director reale.** `tar` emite `./.git/` și `./.github/` ca intrări de tip director.
  - Un `.git` creat în mediu refuza tot exportul; acum e ignorat.
  - Un folder `.github` trimis și neschimbat refuza tot exportul (pentru orice proiect real cu `.github`); acum trece.
  - Folderele protejate **noi** (`.husky/`, `.vscode/`, `GIT~1/`) rămân refuzate.
- **Instrucțiunile writer-ului pe ruta de mediu** arătau calea Windows și starea git. Acum spun că lucrează pe o copie Linux, fără `.git`, cu căi relative.

### Riscuri rămase (documentate, nereparate)
- Modelul writer-ului și limitele misiunii nu se pot seta din UI, doar prin API. Reviewer-ul implicit al contului (Fable) e refuzat; se alege `sonnet` la „Reia” sau prin limite.
- C16 expiră după 24 h. Ruta nu face parte din scope-ul aprobat, deci nu trebuie schimbată în timpul misiunii.
- Un `~/.codex` modificat de primul `thread/start` real ar schimba amprenta după rulare.
- Octeți NUL pe stdout prin `wsl.exe`: risc mic, C16 a mers pe aceeași cale.

### Teste noi și mutații
- **`m05-live-readiness.test.mjs`:** LR-01…06, toate PASS.
- **Mutanți: 5 din 5 prinși:**
  - aprobări refuzate doar după câmpuri;
  - `.git`-ul din mediu neignorat;
  - folder trimis refuzat;
  - fără izolare in-process;
  - vechea clasificare BLOCKED „orice linie”.
- **Pentru `reap.sh`:** verificarea reală C15r/C15s, cu un control v1 care dă `remaining=3`, plus o gardă statică (LR-06).

**Canary-ul complet după reparații** (driverul manual, real, fără model): PASS_LOCAL, 73 de verificări (71 + C15r + C15s), 0 eșuate, 75 s, `m05-canary-1+a2669128`, amprenta `7b3afa6ae2a7d1f3` neschimbată.
