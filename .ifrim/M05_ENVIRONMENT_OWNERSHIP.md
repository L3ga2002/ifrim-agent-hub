# M05 · Unde rulează fiecare etapă și ce graniță are

Data: 2026-10-02. Cod: `v2/server/factory/routed-runner.mjs` (`stageMap`) și `v2/server/environments/`. Statusurile de dovadă sunt PASS_LOCAL (real, fără model), PASS_SIMULATED (fixture), PASS_LIVE (cu model) și NOT_RUN.

**Ce protejăm:** celelalte proiecte, datele Hub-ului (`.ifrim/private`, backup-uri), credențialele, fișierele gazdei și integritatea codului care se întoarce în proiect.

**Atacatorul din model:** codul și inputul neîncrezător pe care un worker îl execută sau îl interpretează (codul generat, testele, scripturile, dependențele, paginile web).

**Ce nu promitem:**
- protecție față de administratorul Windows (`\\wsl$`, `wsl -u root`);
- protecție față de o evadare din kernelul WSL, comun cu distribuțiile `Ubuntu` și `docker-desktop`;
- o graniță de mașină virtuală dedicată: Windows 11 Home nu are Hyper-V.

## Harta pe etape

Ruta e aleasă de tine per proiect: Sistem → Medii de execuție → „Ruta Codex pe proiect”. Doar Codex se mută; Claude și Lega rămân pe Windows.

| Etapă | Ruta Windows (implicit) | Ruta `wsl-runner` | Graniță în ruta `wsl-runner` |
|---|---|---|---|
| Writer (Codex) | `codex.exe app-server`, sandbox Windows elevated, profil `ifrim_hub_rw`; R2 deschis | `wsl.exe --exec /usr/bin/env -i … codex app-server`, profil `ifrim_runner_rw`, pe o **copie** a proiectului; exportul e validat (C14) înainte de aplicare | **mediu** (atestat) |
| Verificări | `codex sandbox` Windows pe proiectul de pe disc | `codex sandbox -P ifrim_runner_rw` în `ifrim-runner`, pe o copie nouă a proiectului la fiecare comandă; nimic nu se întoarce în proiect | **mediu** (fără socket-uri, vezi limitele) |
| QA | la fel ca verificările | la fel ca verificările | **mediu** |
| Preview | `codex sandbox` Windows (server local) | **rămâne pe Windows**: sandbox-ul Linux cu rețeaua oprită refuză orice socket (EPERM la `listen`) | Windows (R2) |
| E2E | Chromium Windows (sandbox Chromium), doar originea preview-ului | rămâne pe Windows, contra preview-ului de pe Windows | Windows (R2) |
| Review | Claude Code, `Read/Glob/Grep`, `dontAsk`, reguli deny | neschimbat (Claude nu e rutat) | **unealtă**, nu OS |
| Lega (voce) | Codex realtime, fără workspace, cwd temporar gol | neschimbat | fără workspace |

**REAL_PROJECT_ELIGIBLE** e adevărat doar când toate etapele care execută cod din proiect sunt în granița mediului. Azi e **fals** pe orice rută: preview-ul, E2E-ul și review-ul rămân în afara ei. Panoul misiunii și pachetul de livrare listează exact etapele care împiedică eligibilitatea (`stageEnvironmentLimitations`).

## Detalii pe etapă (ruta `wsl-runner`)

**Writer**
- **Proces și utilizator:** `wsl.exe` (Windows) → `/usr/bin/env -i` → `/usr/local/bin/codex app-server`, ca `runner` (uid 1000, fără sudo, `/usr/local/lib/codex` aparține lui root).
- **Ce citește:** comenzile modelului văd workspace-ul copiat plus setul `:minimal` al Codex. `:root` e refuzat; sunt negate `~/.codex`, `/tmp`, `.env*` și celelalte workspace-uri (C7–C11, C13b).
- **Ce scrie:** doar `/home/runner/ws/hub/<run>/repo` (C7c, C7d), cu `TMPDIR` per rulare în `repo/.ifrim-tmp`.
- **Rețea:**
  - comenzile modelului nu au rețea (C12a–c);
  - clientul Codex comunică cu OpenAI, fără filtrare pe domenii;
  - mediul nu vede serviciile Windows de pe 127.0.0.1, inclusiv Hub-ul (C6, C6b).
- **Secrete:** `auth.json` există doar în `~/.codex` din mediu, cu permisiuni 600; comenzile modelului nu îl pot citi (C10c). Variabilele Windows nu trec granița (`env -i`, fără `WSLENV`; testul M05-RT-01).
- **Politică:** poarta are `environment_route`, `isolation` (profilul raportat permis de clientul din mediu) și `host_isolation`. Ultima cere o atestare validă pe amprenta curentă, plus aprobarea (b) dacă proiectul e real. Inspecția se repetă la dispatch; o amprentă schimbată oprește execuția înainte de model (M05-RT-04).
- **Dovezi:**
  - canary-ul real C1–C17: PASS_LOCAL 71/71, 2026-10-02, amprenta `7b3afa6ae2a7d1f3`;
  - C14 pe arhive reale: 26/26 (21/21 înainte de review);
  - fluxul complet prin mediul simulat: PASS_SIMULATED (M05-ENV-02).
- **Limită:** un turn real de model prin `wsl-runner` nu a rulat încă; asta e proba (c).

**Verificări și QA**
- Aceeași graniță ca writer-ul, pornită prin `codex sandbox`, cu formele de comandă aprobate în spec. Node-ul folosit e cel din mediu (`/usr/local/bin/node`).
- **Limită măsurată pe Codex 0.159.2** (sandbox Linux cu rețeaua oprită):
  - `listen` și `connect` dau EPERM pentru TCP și pentru socket-uri Unix;
  - un proces copil Node citit prin pipe își pierde ieșirea asincronă (`writeSync` merge, `process.stdout.write` nu);
  - `node --test` și `npm test` simple **trec**.

  Un test care pornește un server sau un proces copil cu pipe-uri e raportat **BLOCKED** (limita mediului), nu FAIL, deci nu pornește un ciclu de remediere.

**Preview și E2E**
- Rămân pe Windows. Pentru un proiect real, runner-ul Windows cere acum acceptarea R2 a proiectului, exact ca writer-ul pe Windows. Înainte de M05, runner-ul nu verifica R2 deloc.

**Review**
- Graniță de unealtă: `--tools Read,Glob,Grep`, `dontAsk`, reguli deny absolute. Nu e o graniță OS.
- Pentru date reale, blocajul rămâne explicit. Mutarea review-ului în mediu cere un Claude Linux, adică instalare și autentificare separate, cu aprobare.

**Lega**
- Suprafață separată pe Windows. Nu primește acces la fișierele sau la credențialele din WSL și nu e etichetată „izolată prin ifrim-runner”.

## Ce ar închide golurile (decizii separate, neactivate)

1. **Preview în mediu.** Două variante:
   - un profil de rețea „doar local”: `experimental_network` cu `allowLocalBinding` există în schema 0.159.2, dar e experimental și cere schimbarea profilului;
   - un runner `bwrap` dedicat, cu propriul network namespace și un releu pe un port fix.

   Ambele cer analiză și aprobare. Accesibilitatea din Windows a unui server pornit într-un netns izolat nu e demonstrată.
2. **E2E în mediu:** Chromium pentru Linux. E o instalare cu aprobare separată.
3. **Review în mediu:** Claude Code pentru Linux, plus login separat. Instalare și autentificare cu aprobare separată.

## Verificări și QA în mediu: ce s-a schimbat înainte de proba live (2026-10-02)

- **`node --test` rulează testele în același proces** (`NODE_OPTIONS=--test-isolation=none`).
  - Măsurat în `ifrim-runner`: cu izolarea implicită, sandbox-ul pierdea ieșirea proceselor copil. Rămânea doar `not ok 1 - <fișier>`, fără motivul erorii.
  - **Diferență față de Windows:** fișierele de test împart un proces.
- **BLOCKED doar când toate testele eșuate arată refuzul de socket.** Un eșec real lângă un test cu socket rămâne FAIL și intră în remediere.
- **Proba (c) C2 pe Demo A2 poate arăta doar ramura PASS:** testele demo nu folosesc socket-uri. Cazul BLOCKED e acoperit doar de testul M05-LR-02.
