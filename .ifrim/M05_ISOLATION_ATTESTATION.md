# M05 · Amprenta, atestarea (canary C1–C17) și aprobarea (b)

Data: 2026-10-02. Cod:
- `v2/server/environments/wsl-runner.mjs`: `fingerprintOf`, `boundaryProblems`, `attest`, `attestationStatus`, `attestationStatusOf`, `probeProblem`, `writerReadiness`;
- `canary.mjs`, `c14.mjs`;
- `v2/server/policy/isolation.mjs`: `evaluateEnvironmentRoute`, `evaluateEnvironmentProfile`, `ENV_POLICY_TEXT`.

## Amprenta

Inspecția (`scripts/inspect.sh`) întoarce doar metadate: versiuni, hash-uri, nume de tabele, indicatori de prezență. Hash-ul amprentei acoperă:
- `distro`;
- `wslconf`: primii 16 caractere din sha256 al `/etc/wsl.conf`;
- `codex`: versiunea;
- `codexSha`: hash-ul binarului;
- `config`: hash-ul `~/.codex/config.toml` din mediu;
- `kernel`;
- `profiles`: numele profilurilor de permisiuni;
- `bwrap` și `tar`: versiunile.

**Amprenta citită pe 2026-10-02:**
`distro=ifrim-runner wslconf=b8890b2f40e0327e codex=0.159.2 config=4a7c12306a171922 kernel=6.6.114.1-microsoft-standard-WSL2`.
- Linia e identică cu valoarea istorică din 2026-10-01, care a fost doar comparată, nu introdusă ca dovadă.
- Hash-ul complet include și `codexSha`, `profiles`, bwrap 0.9.0, tar 1.35 și `codexExtras`: un hash peste `rules/`, `AGENTS.md`, `skills/`, `prompts/` și `hooks` din `~/.codex` al mediului, al cărui conținut nu se afișează. Valoarea curentă e `7b3afa6ae2a7d1f3`.

**Probleme de graniță care blochează** (`boundaryProblems`):
- alt utilizator sau root;
- sudo sau grup privilegiat;
- discuri în `/mnt` sau montări drvfs;
- `cmd.exe` accesibil;
- căi Windows în PATH;
- `wsl.conf` cu automount, interop sau appendWindowsPath activate;
- profil `ifrim_runner_*` lipsă;
- `mcp_servers` inline;
- provider de model propriu;
- preferință de login cu cheie API;
- `auth.json` lipsă (NEEDS_AUTH) sau cu permisiuni diferite de 600;
- binarul Codex care nu aparține lui root.

## Atestarea

Atestarea (`attest()`) rulează canary-ul C1–C17 (`runCanary`) pe amprenta curentă și o înregistrează în `environment_attestations`:
- **Verificările:**
  - C1–C13 în distribuție (`scripts/canary.sh`, mutat din `tests/manual` fără schimbarea sensului);
  - C14: validatorul de export pe arhive reale;
  - C15: repornirea distribuției și C1–C4 din nou, doar când nimic nu rulează în mediu;
  - C16: contul prin clientul din mediu, fără thread și fără turn;
  - C17: căutarea tokenurilor fictive.
- **Amprenta trebuie să rămână aceeași de la început până la sfârșit**, altfel rezultatul e FAIL.
- **Statusuri** (`attestationStatusOf`, comun cu driverul manual):

  | Status | Când |
  |---|---|
  | `PASS_LOCAL` | toate verificările trec, pe mediul real |
  | `PASS_SIMULATED` | distribuția e fixture-ul de test |
  | `INCOMPLETE` | o verificare nu a rulat, de exemplu C15 când mediul era ocupat |
  | `FAIL` | orice altceva |

  Nicio atestare nu e PASS_LIVE: nu rulează niciun model.
- **Etapele acoperite** se deduc din verificările trecute și se înregistrează:
  - `writer-profile`, `checks`, `qa`: C7–C13, sandbox-ul comenzilor modelului;
  - `export`: C14;
  - `account`: C16.

  Preview-ul, E2E-ul, review-ul și vocea nu sunt acoperite.

**Versiunea canary-ului** (`m05-canary-1+<hash>`) include un hash al `canary.sh` și al `c14.mjs`. Dacă se schimbă verificările, atestările vechi nu mai sunt valabile.

**O atestare e validă doar dacă:**
- statusul e `PASS_LOCAL` (`PASS_SIMULATED` doar în modul de test);
- versiunea canary-ului e cea curentă;
- are cel mult 14 zile;
- amprenta inspecției curente e cea atestată;
- inspecția curentă nu raportează probleme blocante.

**Verificarea contului (C16):**
- e valabilă 24 h și doar pentru amprenta pe care a fost făcută;
- un catalog de modele nu e dovadă de eligibilitate;
- o sesiune autentificată nu e o probă de inferență.

## Rezultatul real (2026-10-02, fără model)

Comandă: `node v2/tests/manual/r2-wsl-canary.mjs`. Folosește același cod ca atestarea Hub-ului și o bază de date temporară.

- **Prima rulare** (înainte de review): PASS_LOCAL, 66 de verificări, hash `43d3279a72be9129`.
- **Rularea finală, după fixurile din review:**
  - PASS_LOCAL, **71 de verificări, 0 eșuate**, 60 s;
  - canary `m05-canary-1+dd76e97d`;
  - amprenta identică înainte și după: hash **`7b3afa6ae2a7d1f3`** (formula include acum bwrap, tar și restul intrărilor clientului Codex);
  - linia comparabilă cu cea istorică a rămas aceeași;
  - etape deduse: `writer-profile, checks, qa, export, account`.
- **C14:** 26/26, inclusiv cazurile găsite la review: `GIT~1`, `sub/.git`, `src/CLAUDE.md`, `.github/`, `.scf`. `.GIT/` și `Node_Modules/` nu ajung în schimbări (vezi `M05_WORKSPACE_TRANSFER_AND_EXPORT.md`).
- **C16:** cont `chatgpt`, plan `prolite`, 8 modele în catalog, profilurile `ifrim_runner_ro` și `ifrim_runner_rw` permise, limite citite.
- **C13:** în sandbox sunt 7 variabile neutre (`CODEX_SANDBOX_NETWORK_DISABLED HOME LANG LOGNAME PATH USER PWD`).

**Înregistrată în Hub-ul live:** după repornirea pe `2.6.0-m05`, ai apăsat Inspectează, C16 și „Rulează atestarea C1–C17” (2026-10-02 ~02:13 UTC). Rezultat: PASS_LOCAL, 71 de verificări, amprenta `7b3afa6ae2a7d1f3`; contul chatgpt `prolite`, 8 modele.

## Poarta pe ruta `wsl-runner`

Proiectul trebuie pus pe ruta `wsl-runner` de tine. Verificările:

1. **`environment_route`:** mediul există în Hub. Altfel execuția e refuzată, nu trimisă pe Windows.
2. **`billing_route`:** contul și planul vin din verificarea **prin mediu** (`codex@wsl-runner`), nu din clientul Windows (M05-RT-02).
3. **`isolation`:** o verificare a contului proaspătă, pentru amprenta curentă, cu profilul cerut raportat permis. Ce refuză profilul e dovedit de atestare, nu de această verificare.
4. **`host_isolation`:**
   - inspecție fără probleme;
   - atestare validă;
   - pentru un proiect hub-test: atât;
   - pentru un proiect real: **aprobarea (b)**, pentru amprenta curentă.
5. **La dispatch:** adaptorul **inspectează din nou**. O amprentă schimbată între poartă și pornire oprește execuția înainte de model și restituie încercarea (M05-RT-04).

## Aprobarea (b)

Comanda `environment.policy.approve`:
- merge doar pe canalul `ui`; din `test` doar în teste; din `cli`, `voice` sau `companion` e refuzată;
- cere textul exact `ENV_POLICY_TEXT` și amprenta afișată (o pagină veche nu poate aproba altă amprentă);
- cere o atestare validă.

Retragerea e fail-safe, permisă și din `voice` sau `companion`.

**Textul spune explicit:**
- ce acoperă: writer, verificări, QA;
- valabilitatea atestării: 14 zile, local, fără model;
- că aprobarea e globală pentru proiectele puse pe rută, până la retragere sau la schimbarea amprentei;
- că fișierele sunt copiate în mediu și trimise modelului printr-un client cu rețea nefiltrată;
- că nucleul WSL e comun și administratorul Windows are acces;
- că preview-ul, E2E-ul, review-ul și vocea rămân pe Windows, cu R2 deschis.

**Stare:** (b) **nu este acordată** și nimic din M05 nu o acordă.

## Versiunea nouă a canary-ului (2026-10-02, după verificarea dinaintea probei live)

- **C15r/C15s** verifică real curățarea proceselor pe un workspace fictiv, cu două procese-martor: unul în workspace, unul în afara lui.
  - C15r, modul marker: îl oprește doar pe primul.
  - C15s, modul „all”: îl oprește și pe al doilea.
  - În ambele, curățarea nu se poate număra pe ea însăși (`remaining=0`).
- Verificările rulează doar când mediul e liber, la fel ca repornirea C15.
- `reap.sh` și `canary.mjs` intră acum în hash-ul versiunii.
- **Driverul manual, real, fără model:** PASS_LOCAL, **73 de verificări, 0 eșuate**, 75 s, canary `m05-canary-1+a2669128`, amprenta `7b3afa6ae2a7d1f3` aceeași înainte și după.
- **Atestarea din Hub de la 02:13 UTC** (versiunea veche a canary-ului) **nu mai e validă**. O nouă atestare din UI trebuie să dea același rezultat.
