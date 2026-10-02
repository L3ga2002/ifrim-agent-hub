# M05 · Raport final: wsl-runner, R2 și robustețea execuțiilor

Data: 2026-10-02.

**Nivel atins:**
- **BUILD_READY**;
- **LOCAL_ENVIRONMENT_ATTESTED**, înregistrat în Hub-ul live: re-atestarea din 2026-10-02 06:59 UTC, PASS_LOCAL, 73 de verificări, amprenta `7b3afa6ae2a7d1f3`;
- **WSL_LIVE_SANDBOX_VALIDATED** (2026-10-02, 07:20–07:30 UTC, Factory Demo A2):
  - writer Codex `gpt-6.1-sol` prin `wsl-runner`, cu export C14 aplicat;
  - verificări PASS 6/6 și QA PASS 2/2 în mediu;
  - review `sonnet` PASS pe change set-ul exportat.

  Pachetul `bnd_muqn17e6_19ce971a24` așteaptă decizia ta. C3 (Stop live în mediu) e NOT_RUN. Detalii: `M05_LIVE_RESULTS.md`.

**R2 rămâne deschis.** Niciun proiect real nu e eligibil pe nicio rută.

Detalii:
- `M05_IMPLEMENTATION_STATUS.md`;
- `M05_ENVIRONMENT_OWNERSHIP.md`;
- `M05_WSL_RUNNER.md`;
- `M05_WORKSPACE_TRANSFER_AND_EXPORT.md`;
- `M05_ISOLATION_ATTESTATION.md`;
- `M05_TEST_REPORT.md`;
- `M05_LIVE_VALIDATION_PLAN.md`.

## 1. Baseline Git și runtime (verificat 2026-10-02)

**Git**
- **Branch:** `v2-milestone-01`. `main`, `origin/main` și `origin/v2-milestone-01` sunt toate la `895c215`.
- **Codul M05 e necomis:**
  - 38 de fișiere modificate, inclusiv documentele de predare și `CLAUDE.md`;
  - fișiere și foldere noi sub `v2/server/environments/`, `v2/tests/m05-*`, `v2/web/src/screens/system/` și `.ifrim/M05_*`;
  - un singur `git mv` în stage: `v2/tests/manual/r2-wsl-canary.sh` → `v2/server/environments/scripts/canary.sh`.
- **Fără** commit, push, merge, deploy, reset, clean sau stash.

**Runtime**
- **Hub-ul live:** pid 11088, `2.5.0-m04`, `BUILD_SAFE`, poarta `open`, fără simulare. Pornit pe 2026-10-01 la 20:55 UTC, cu aprobare, după backup-urile verificate `bkp_muq0l3bf_cdf0ef523b` și `bkp_muq0lsyt_958237ca8f`.
- **Actualizare 2026-10-02 02:08 UTC:** ai rulat proba de migrare (schema 4→5, integritate ok, rânduri neschimbate) și ai repornit Hub-ul din terminalul tău. Acum rulează pid 26992, `2.6.0-m05`, BUILD_SAFE, cu migrarea 5 aplicată.
- Codul M05 (`2.6.0-m05`) intră în Hub doar la o repornire aprobată, cu migrarea 5.
- V1 pe 3004/8004: neatins.

**Lecție:** un Hub pornit din sesiunea agentului moare odată cu procesul ei, iar preview-ul Demo B (4610) a murit așa. Pornește Hub-ul din terminalul tău.

## 2. Demo B și deciziile tale rămase

- **Bundle-ul Demo B `bnd_mupwze7b_e03f70f2d7`:** așteaptă decizia ta. Nu l-am acceptat și nu l-am respins.
- **Preview-ul Demo B (portul 4610) e oprit:** a murit odată cu Hub-ul anterior. Îl repornești din panoul misiunii, după repornirea Hub-ului.
- **Draftul `mis_mupy0no5_922d2614b0`:** SPEC_DRAFT, cu 5 probleme de completat de tine. Neatins.
- **Neatinse:** AROBS, ProDelivery, Sales live.

## 3. Aprobările

| Aprobare | Stare | Folosită pentru | Limite respectate |
|---|---|---|---|
| (a) cod M05 local | acordată | tot scope-ul M05 | fără model, fără commit, ruta nouă inactivă |
| Verificări WSL reale fără model | acordată | canary C1–C17, app-server doar pentru cont și modele, `codex sandbox` pe arbori fictivi | fără thread/turn, fără instalări, fără schimbări de `wsl.conf`, profiluri sau login |
| Pornirea Hub-ului | acordată | 2026-10-01, 20:55 UTC | — |
| Subagenți | acordată | 3 subagenți doar-citire pentru review și explorare | scrierea doar în sesiunea principală |
| (b) `host_isolation=environment` | **neacordată** | — | codul există; textul exact e mai jos |
| (c) probe live prin WSL | **neacordată** | — | pachetele C1–C4 sunt în `M05_LIVE_VALIDATION_PLAN.md` |
| (d) `.wslconfig` | **neacordată** | — | nu e necesară pentru nimic din M05 |

## 4. Adaptorul WSL și contul prin mediu

**Invocarea:**
```
wsl.exe -d ifrim-runner -u runner --cd <cale> --exec /usr/bin/env -i HOME USER LOGNAME LANG PATH … <executabil absolut>
```
- Fără shell. Argumentele sunt validate.
- Mediul Windows nu trece granița: fără `WSLENV`.
- Workspace-ul e **copiat** în `/home/runner/ws/hub/<run>/repo`, nu montat.

**Contul (C16)**, verificat prin clientul din mediu, fără thread și fără turn:
- cont `chatgpt`, plan `prolite`;
- 8 modele în catalog;
- profilurile `ifrim_runner_ro` și `ifrim_runner_rw` raportate permise;
- limitele citite.

**Secrete:** `auth.json` există doar în `~/.codex` din mediu (600). Nu a fost citit, afișat sau copiat.

## 5. Canary-ul, C14, C16 și amprenta

- **Canary C1–C17:** PASS_LOCAL **71/71**, 60 s, versiunea `m05-canary-1+dd76e97d`.
- **Amprenta `7b3afa6ae2a7d1f3`:** neschimbată înainte și după rulare. Linia comparabilă e identică cu cea din 2026-10-01:
  `distro=ifrim-runner wslconf=b8890b2f40e0327e codex=0.159.2 config=4a7c12306a171922 kernel=6.6.114.1-microsoft-standard-WSL2`
- **C14:** 26/26 pe arhive GNU tar reale:
  - cazul curat a fost aplicat octet cu octet;
  - conflictul a fost detectat;
  - 21 de cazuri ostile au fost refuzate fiecare cu motivul lui, iar exportul ostil a fost refuzat integral.
- **C16:** PASS (vezi §4).
- **Etape acoperite de atestare:** `writer-profile`, `checks`, `qa`, `export`, `account`.

## 6. Unde rulează fiecare etapă

| Etapă | Ruta implicită (Windows) | Pe ruta `wsl-runner` (când o alegi pe proiect) |
|---|---|---|
| Writer (Codex) | sandbox Windows, R2 deschis | **`ifrim-runner`**, pe o copie, cu export validat C14 |
| Verificări / QA | `codex sandbox` Windows | **`ifrim-runner`**: testele cu socket-uri sunt raportate BLOCKED, nu FAIL |
| Preview | Windows | **Windows** (sandbox-ul Linux refuză socket-urile, EPERM) |
| E2E | Chromium Windows | **Windows** |
| Review (Claude) | Windows, graniță de unealtă (`Read/Glob/Grep`, `dontAsk`, deny) | neschimbat |
| Lega | Windows, fără workspace | neschimbat |

Ruta `wsl-runner` **nu e activată pe niciun proiect**. Tu o alegi per proiect. Dacă mediul refuză, execuția se oprește; nu trece pe Windows.

## 7. Căi blocate și riscuri rămase

**Blocate (cu teste):**
- Mediul Windows în WSL: `env -i`, fără `WSLENV`.
- Discurile Windows, interop, sudo: verificate la fiecare inspecție, iar o abatere blochează execuția.
- `thread/shellCommand` și `process/spawn` (rulează fără sandbox) sunt excluse din lista albă.
- Escaladările de permisiuni sau de rețea sunt refuzate automat pe ruta de mediu.
- Exportul e acceptat doar întreg, după validator. Sunt refuzate:
  - legături, tipuri speciale, nume ostile, nume 8.3;
  - foldere și fișiere de control la orice adâncime;
  - secrete, binare;
  - testele protejate.
- Aplicarea se face doar pe conținutul de bază neschimbat, cu rollback și recitire.
- O amprentă schimbată între poartă și dispatch oprește execuția înainte de model.
- Git-ul Hub-ului nu mai rulează programe din repository (`core.fsmonitor`, hooks, `diff.external`).

**Riscuri rămase:**
- Preview-ul, E2E-ul și review-ul rămân pe Windows, deci R2 e deschis pentru ele.
- Clientul Codex din mediu are rețea nefiltrată spre OpenAI; comenzile modelului nu au.
- Kernelul WSL e comun cu `Ubuntu` și `docker-desktop`, iar administratorul Windows are acces (`\\wsl$`). Nu există VM dedicată: Windows 11 Home nu are Hyper-V.
- (b) nu are nonce de UI: oricine are tokenul local al Hub-ului e tratat ca UI, la fel ca în restul Hub-ului.
- Workspace-ul nu are cotă de disc proprie; VHD-ul e plafonat la 40 GB.
- Niciun turn real de model nu a trecut prin mediu.

## 8. Transfer/export, Stop, PRG și inițializare

- **Transfer/export:**
  - transfer cu modificări necomise, fără a atinge git-ul (EXP-05);
  - round-trip cu diacritice, CRLF și binar (EXP-07);
  - aplicare cu conflict, junction și rollback (EXP-04);
  - snapshot git pentru 4.200 de fișiere: exact 3 schimbări (RT-12).
- **Stop:**
  - în turn (RT-08), în export (RV-05), în copiere (RV-06), în comanda QA (FAC-01, RV-07);
  - real în mediu: arborele `codex sandbox → bwrap → sh → sleep` oprit în 0,9–1,9 s, cu 0 procese rămase (n=4).
- **PRG (RT-07):** POST → 303 → GET, cu un singur POST, pe Chromium real **Windows** (BR-01). 307/308 și redirectul spre altă origine sunt refuzate (BR-02). Mutantul e prins.
- **Inițializare:** încălzirea e oprită implicit la boot. După repornire, dispatch-ul reinspectează mediul dacă inspecția are peste 10 minute.

## 9. Diagnosticul Lega și regula încercărilor

- **Ultima eroare** e păstrată redactat (`lega.session.error`, maxim 5 pe sesiune). Se văd motivul închiderii și activitatea: transcrieri, turnuri, unelte.
- **Regula reală:**
  - **eșec înainte de cererea GPT-Live** (`thread/realtime/start`): contorul intern al grantului se restituie, de cel mult `maxAttempts` ori;
  - **după cererea GPT-Live:** încercarea rămâne folosită, fiindcă consumul real la provider e **necunoscut**.
- Restituirea e doar „contor Hub”, nu o rambursare de la provider.
- Testele sunt pe fixture (LEGA-01…03). **Nu a fost probat live.**

## 10. Măsurători (eșantion mic, cu suita rulând în paralel)

| Măsurătoare | Valoare | n |
|---|---|---|
| Pornirea distribuției la rece / inspecție | 8,2–38,7 s | 5 |
| Preflight în sandbox (cald) | 1,6–2,7 s | 5 |
| Pregătire + preflight | 3,6–6,7 s | 5 |
| Stop pe arbore real `codex sandbox` | 0,9–1,9 s | 4 |
| Preflight Windows | NOT_RUN: folosește profilul real cu ACL; îl pornești tu din UI | — |

Timpii sunt umflați de încărcare. Nu sunt o referință de performanță.

## 11. Teste locale vs live

- **V2 (după reparațiile dinaintea probei):** 500 de teste, 499 trecute, 0 eșuate, 1 sărit (T25), 23 min.
  - Prima rulare finală, înainte de ele: 494 de teste, 493 trecute, 0 eșuate, 1 sărit (T25, symlink de fișier fără privilegiul Windows, ca la M04).
- **V1:** 552 de teste, 551 trecute, 0 eșuate, 1 sărit (ca înainte).
- **Teste noi:** 9 fișiere `m05-*`, inclusiv `m05-live-readiness.test.mjs` (vezi `M05_TEST_REPORT.md`).
- **Verificări de mutație:** 8, toate prinse: 3 la implementare și 5 la reparațiile dinaintea probei.
- **Review adversarial:** 2 HIGH și 19 MEDIUM găsite; toate reparate, în afară de 2 documentate (§7).
- **Verificarea dinaintea probei:** 2 blocaje și mai multe riscuri, confirmate real și reparate (§13).
- **Live:**
  - nicio probă cu model nu a rulat prin mediu;
  - atestarea din Hub a trecut la 02:13 UTC, dar e invalidată intenționat de noua versiune a canary-ului;
  - ecranul nou „Medii de execuție” a fost văzut și folosit în Hub-ul live.
- **Regresii:** niciuna în suite. Singurele teste M01 schimbate sunt lista canalelor (`cli`) și NG1, care e acum mai strict.

## 12. Ce mai trebuie făcut înainte de primul proiect real

1. ~~Repornirea pe `2.6.0-m05`~~: făcută de tine (02:08 UTC). Apoi am repornit eu Hub-ul pe reparații (~03:50 UTC).
2. **Atestarea din nou**, din Sistem → Medii de execuție: Inspectează → C16 → atestarea. Rezultatul așteptat e PASS_LOCAL, cu C15r/C15s.
3. **(c):** pachetele C1–C4 pe **Factory Demo A2**, nu pe Demo A. Pașii sunt în `M05_LIVE_VALIDATION_PLAN.md`, „Precondiții”.
4. **Izolarea preview-ului, E2E-ului și review-ului.** Fără ea, REAL_PROJECT_ELIGIBLE rămâne fals. Variantele sunt decizii separate și fiecare cere o instalare sau o schimbare de profil:
   - un profil `experimental_network` cu legare locală;
   - un runner de preview cu `bwrap` propriu;
   - Chromium Linux;
   - Claude Linux.
5. **(b)**, cu textul exact din `ENV_POLICY_TEXT` afișat în UI lângă amprentă, numai după punctele 2–4.
6. **Pentru proiectul real:** acceptarea R2, datele și regulile lor.

## 13. După atestare: verificarea dinaintea probei live (2026-10-02, ~02:20–04:30 UTC)

**Delegarea.** Mi-ai scris în chat să fac eu toate aprobările. Am folosit delegarea pentru:
- o verificare doar-citire înainte de probă;
- verificări reale în mediu, fără model;
- reparațiile;
- repornirea Hub-ului pe reparații (dintr-un tab de terminal al aplicației, ca Hub-ul să nu depindă de sesiunea mea);
- documentele și commit-ul local.

N-am folosit-o pentru:
- (b): fără izolarea etapelor 4, nu aduce nimic și crește riscul;
- instalări în WSL;
- Demo B.

**Ce a găsit verificarea:** 35 de agenți doar-citire, fiecare concluzie verificată de un agent care a încercat s-o infirme.

1. **Blocaj, reparat: curățarea proceselor se număra pe ea însăși.**
   - Cu prima probă, fiecare turn real de writer s-ar fi terminat FAILED după inferență: exportul pierdut, proiectul blocat, încercarea consumată.
   - Confirmat real: v1 a dat `remaining=3` pe un workspace gol; v2 dă `remaining=0`, cu procese-martor.
   - Verificarea face acum parte din atestare (C15r/C15s).
   - Canary-ul complet nou, prin driverul manual: PASS_LOCAL, 73 de verificări, 0 eșuate, amprenta neschimbată.
2. **Blocaj, nu de cod: Demo A e deja reparat.** Misiunea s-ar fi oprit la baseline. Proba folosește un proiect nou, „Factory Demo A2”, creat cu `create-factory-fixture --name` (opțiune nouă).
3. **Reparate:**
   - **ieșirea testelor din sandbox-ul Linux:** `node --test` rulează acum în același proces; confirmat real, inclusiv pentru `npm test`;
   - **clasificarea BLOCKED:** nu mai ascunde eșecuri reale;
   - **escaladări:** orice cerere de ieșire din profil e refuzată automat;
   - **intrările-director din export:** `.git/` creat în mediu e ignorat, iar `.github/` neschimbat trece. Fără corecție, orice proiect real cu `.github` ar fi fost refuzat;
   - **instrucțiunile writer-ului:** nu mai conțin calea Windows.

**Ce m-a oprit.** După repornirea Hub-ului pe reparații, stratul de permisiuni al sesiunii a refuzat continuarea, cu motivul „Production Deploy”. Am respectat refuzul. N-am mai acționat pe Hub-ul live: n-am re-atestat, n-am pus ruta, n-am trecut în LIVE_VALIDATION, n-am dat granturi și n-am pornit misiunea. Proba (c) nu a rulat.

Pașii ei sunt în `M05_LIVE_VALIDATION_PLAN.md`, „Precondiții”, și se fac din UI-ul Hub-ului.

## Recomandarea

Ordinea propusă, pe baza rezultatului:
1. atestarea din nou în Hub, cu C15r/C15s;
2. proba (c) C1 pe Factory Demo A2 (writer prin mediu, export C14);
3. C3 (Stop);
4. C4 (review pe change set-ul exportat).

Asta ar atinge **WSL_LIVE_SANDBOX_VALIDATED** pentru writer, verificări și QA. Pilotul real și Sales cu date reale **nu** sunt încă potrivite: izolarea nu e gata pentru preview, E2E și review. După (c), următorul pas tehnic e decizia de la §12 punctul 4, nu un departament nou.
