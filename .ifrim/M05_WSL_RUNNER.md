# M05 · Adaptorul `wsl-runner`

Data: 2026-10-02. Cod:
- `v2/server/environments/wsl.mjs` (invocare);
- `wsl-runner.mjs` (serviciu);
- `scripts/*.sh` (scripturi din distribuție, versionate);
- `v2/server/providers/codex-wsl.mjs` (adaptor);
- `providers/codex.mjs` (punctul de injecție `launcher`).

## Contract, mapat pe codul existent

Nu există un al doilea orchestrator. Rulările folosesc aceleași componente: run manager, poartă, granturi, lease-uri, timeline, evenimente.

| Operație din prompt | Implementare |
|---|---|
| inspectEnvironment / attestEnvironment | `inspect()` (`scripts/inspect.sh`, doar metadate), `attest()` (canary C1–C17) |
| inspectIdentity (C16) | `probeAccount()`: `codex app-server` din mediu → `initialize`, `account/read`, `account/rateLimits/read`, `permissionProfile/list`, `model/list`. Fără thread și fără turn |
| prepareWorkspace | `prepareWorkspace()`: `scripts/prepare.sh` + tar pe stdin + numărare în distribuție |
| startSession | `codex-wsl.mjs startTurn()` → `codex.mjs startTurn()` cu launcher-ul de mediu |
| executeVerification | `wsl-factory-runner.mjs run()` (`codex sandbox -P ifrim_runner_rw`) |
| interruptRun | `turn/interrupt` (ca pe Windows) → oprirea arborelui `wsl.exe` → `scripts/reap.sh` |
| collectArtifacts / validateExport | `collectExport()`: GNU tar `--format=pax` pe stdout → cititor strict → C14 |
| releaseRunResources | `reap()` + `release()` (`scripts/release.sh` refuză dacă mai e un proces în workspace) |

## Invocarea

```
wsl.exe -d ifrim-runner -u runner --cd <cale Linux validată> --exec /usr/bin/env -i HOME=/home/runner USER=runner LOGNAME=runner \
  LANG=C.UTF-8 PATH=/usr/local/bin:/usr/bin:/bin NO_UPDATE_NOTIFIER=1 [TMPDIR=… IFRIM_RUN=…] <executabil absolut> <argumente…>
```

- **Fără shell:** `--exec` transmite fiecare argument separat. Distribuția, utilizatorul și căile sunt validate prin regex; argumentele nu pot conține NUL. Numele și valorile variabilelor sunt validate.
- **Mediul Windows al `wsl.exe`:** e lista permisă a Hub-ului (`buildChildEnv`), fără `WSLENV`, chei sau proxy-uri. Testul M05-RT-01 setează `WSLENV`, `OPENAI_API_KEY` și `HTTPS_PROXY` în procesul Hub și verifică absența lor la `wsl.exe`.
- **Scripturile:** sunt citite de bash de pe stdin (`/bin/bash -s -- <argumente>`). Argumentele sunt tokeni simpli (`[A-Za-z0-9._/:=-]`, fără `..`).

## Codex app-server în mediu (0.159.2, schema generată în distribuție)

- **Lansarea:**
  - `/usr/local/bin/codex`, plus aceleași override-uri ca pe Windows: `fast_mode`, `image_generation`, `apps`, `computer_use`, `browser_use*`, `memories`, `multi_agent`, `plugins` și `remote_plugin` oprite, `web_search` dezactivat, fără `AGENTS.md`;
  - `effort` explicit;
  - fiecare server MCP din configurația mediului oprit după nume;
  - `-c default_permissions="ifrim_runner_rw|ro"`.

  Nu se folosesc `windows.sandbox` și lista de deny de pe Windows.
- **Lista albă de metode client:** neschimbată (`CODEX_ALLOWED_METHODS`). În 0.159.2, `thread/shellCommand` rulează „unsandboxed with full access”, iar `process/spawn` „without a Codex sandbox”. Nu sunt în lista albă și sunt refuzate pe client. La fel `command/exec`, `fs/*` și `environment/add`.
- **Gărzi neschimbate:**
  - contul trebuie să fie `chatgpt`;
  - limitele planului sunt citite;
  - modelul și efortul raportate trebuie să fie exact cele cerute;
  - sandbox-ul proiectat nu poate fi `dangerFullAccess` sau `externalSandbox`;
  - `mcpServerStatus/list` pe toate paginile, fail-closed;
  - aprobările de comenzi și fișiere ajung la Hub.
- **Thread-urile nu se reiau între medii.** Fiecare rulare primește un workspace nou, iar thread-ul WSL nu e oferit unei rulări Windows, nici invers.
- **Inspecția și MCP.** Inspecția citește din `~/.codex/config.toml` al mediului doar hash-ul, numele tabelelor `[permissions.*]` și `[mcp_servers.*]`, numele cheilor de nivel superior și metoda de login forțată, dacă e `chatgpt` sau `api`. Un `mcp_servers` inline sau un nume neadresabil oprește rularea înainte de pornire.

## Stop (§20)

1. `runs.interrupt` → `turn/interrupt` (5 s) → `supervisor.stop` (arborele `wsl.exe`).
2. `scripts/reap.sh <ws> <marker>` oprește doar procesele utilizatorului `runner` cu cwd în workspace sau cu `IFRIM_RUN=<marker>`, întâi cu TERM, apoi cu KILL.
3. Workspace-ul se șterge doar după ce `release.sh` confirmă că niciun proces nu mai lucrează în el.

Niciodată nu se folosesc `wsl --terminate` sau `--shutdown`, care opresc toată distribuția; `--terminate` apare doar la C15 în atestare, și numai când nu rulează nimic.

**Măsurat real (2026-10-02, fără model)** pe un arbore `codex sandbox → bwrap → sh → sleep ×2`:
- oprirea `wsl.exe` a durat 0,9–1,9 s (n=4), cu **0 procese rămase**;
- controlul de dinainte de Stop vede arborele complet, deci detectorul funcționează;
- reaper-ul a adăugat 0,2–0,9 s și n-a mai găsit nimic.

Un Stop în timpul unui **turn real de model** în mediu nu a fost măsurat (proba (c)). Baseline-ul Windows rămâne 11,2 s (proba 2.5), cu cronometrul pornit de la alt eveniment, deci timpii nu sunt comparabili direct.

## Inițializare și încălzire (§21)

- Comanda `environment.warmup` rulează pe Windows `node -e 0`, iar în `ifrim-runner` `/bin/true`, prin același sandbox, într-un folder gol. Nu rulează cod de proiect și nu pornește modele.
- Opțiunea „la pornirea Hub-ului” e **oprită implicit** (`environmentWarmup.onBoot = false`) și se schimbă doar din UI.
- **Măsurat în `ifrim-runner`** (2026-10-02, cu suita de teste rulând în paralel, deci timpi umflați):
  - pornirea la rece a distribuției: 8,2–38,7 s;
  - preflight sandbox: 1,6–2,7 s;
  - total cu pregătirea workspace-ului: 3,6–6,7 s.
- Preflight-ul Windows nu a rulat, pentru că folosește profilul real cu ACL-uri. Îl pornești tu din UI.

## Ce NU face adaptorul

- nu instalează nimic;
- nu schimbă `wsl.conf`, profilurile sau loginul;
- nu copiază `auth.json`;
- nu montează discuri;
- nu activează interop sau sudo;
- nu trece pe Windows când mediul refuză.

## Corecții înainte de proba live (2026-10-02)

- **`reap.sh` v2.** Curățarea nu se mai numără pe ea însăși.
  - v1 excludea doar `$$` și `$PPID`. În modul „all”, folosit după fiecare turn de writer singur în mediu, își găsea propriile subshell-uri și raporta `remaining>=1`. Real: `found=3 remaining=3` pe un workspace gol.
  - v2 exclude strămoșii și descendenții scriptului.
  - Verificat real cu procese-martor: C15r (marker) și C15s (all), ambele `remaining=0`. Verificarea face acum parte din atestare.
- **Aprobări.** Pe ruta de mediu, orice cerere de aprobare pentru o comandă sau o modificare de fișiere e refuzată automat. Cu `approvalPolicy on-request` și profilul workspace-write, Codex cere aprobare doar ca să iasă din profil, așa că o astfel de cerere nu mai ajunge la tine ca o comandă obișnuită.
- **Instrucțiunile turnului.** Writer-ul din mediu află că lucrează pe o copie Linux, fără `.git`, cu căi relative. Nu mai primește calea Windows a proiectului.
- **Verificări și QA.** Rulează cu `NODE_OPTIONS=--test-isolation=none`. Altfel sandbox-ul pierdea ieșirea proceselor copil ale `node --test`.
