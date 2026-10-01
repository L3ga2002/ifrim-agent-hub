# M03 · Rezultatele probelor de închidere 2.3, 2.5, 2.6 și mediul R2

Data: 2026-10-01, seara (UTC). Hub `2.5.0-m04` pe 127.0.0.1:8011. Probele au fost aprobate de proprietar în conversație, cu valorile implicite din `M03_CLOSURE_PACKAGES.md`:
- 2.3: 120 min, 90 min pe execuție, granturi valabile 180 min;
- 2.5: traseul R;
- 2.6: pe Demo B.

Toate clicurile de pornire, oprire și aprobare au fost ale proprietarului. La final: granturi revocate sau epuizate, Hub în **BUILD_SAFE**.

## Proba 2.3 · Demo B (funcționalitate + remediere + E2E): **PASS_LIVE**

- **Misiune:** `mis_mupj3zl4_9970bdd58b`, proiectul Factory Demo B (`prj_mup6nqd7_57f7ba5b4b`, hub-test).
- **Granturi:** Codex workspace-write `grant_mupv13xw_bfab295a4d` (2/3 folosite) și Claude read-only `grant_mupv13y2_99c96bce50` (1/3), ambele revocate după probă.
- **Previzualizarea porții:** 12/12 verificări trec pentru fiecare execuție. Codex: `gpt-6.1-sol` · medium. Claude: `sonnet` · medium.
- **Traseul real:**
  1. **18:22:59, writer-ul Codex** `run_mupv3pi2_125f81229e` s-a terminat fără nicio modificare.
     - Comenzile lui de shell (`Get-Location`, `git status`, `rg --files`) au rămas fără ieșire și au fost oprite.
     - **Cauza** (diagnostic fără model, cu `codex-sandbox-timing.mjs --fictive`): sandbox-ul Windows avea nevoie de **144,6 s la prima comandă după repornirea PC-ului**. Următoarele comenzi durau ~2,7 s, iar o a doua rulare a dat 2,7 s și pe un workspace nou. Costul e unic, la nivelul sistemului.
     - Misiunea a trecut în NEEDS_OWNER_DECISION („Writer-ul nu a modificat niciun fișier”).
  2. **„Reia” al proprietarului** → verificări pe change set-ul gol → FAIL → **REPAIRING ciclul 1**: Codex `run_mupwm7ha_45a395c362` a modificat `public/index.html` și `src/server-app.js` și a adăugat `test/requests.test.mjs`.
  3. **CHECKING PASS** → review Claude `run_mupwvw6e_9fee4aee7d` **PASS** (VALID; 1 constatare low și 1 info, neblocante; constatarea QA a fost rezolvată) → **QA PASS** → **PREVIEW PASS** → **E2E în Chromium PASS** → pachetul `bnd_mupwze7b_e03f70f2d7` **READY_FOR_OWNER_ACCEPTANCE** (19:15:34).
- **Remedierea a fost exersată real** (D3 nu s-a mai pus).
- **Defect găsit și reparat după probă:** „Reia” după un writer fără modificări trimitea change set-ul gol la verificări, în loc să relanseze implementarea. Acum relansează IMPLEMENTING.
  - Testul `M03-FAC-28` acoperă cazul și prinde mutantul.
  - Corectura intră în Hub la următoarea repornire.
- **Recomandare (nefăcută):** Hub-ul ar putea „încălzi” sandbox-ul cu o comandă fără model la pornire sau înaintea primului writer, ca să nu mai depindă de răbdarea modelului.

## Proba 2.5 · Stop în timpul unui turn real (traseul R): **PASS_LIVE**

- **Conversație și grant:** conversația `conv_mupx9upf_64f449cdf3` pe Factory Demo A; grantul Codex read-only `grant_mupx9up8_ff91f8c793` (1 încercare, 10 min, valabil 30 min), epuizat 1/1.
- **Execuția:** `run_mupxmjba_f07c154597`, `gpt-6.1-sol` · medium, read-only. Cererea a fost o analiză lungă doar-citire a proiectului.
- **Cronologie (UTC):**
  - cerere 19:33:33,38;
  - proces pornit 19:33:35,34;
  - turn trimis 19:33:37,45;
  - **turn_acknowledged 19:33:37,48**;
  - prima ieșire 19:33:43,13;
  - **„Întrerupe” al proprietarului 19:33:57,62** (canal ui, comanda `cmd_mupxn20f_515af54bcc`), la ~20 s după confirmarea turnului, nu la 30 s;
  - **oprire 19:34:08,86** (`run.interrupted`).
- **Latența opririi:** **11,2 s** de la cerere până la terminarea execuției. Codex își închide turnul activ înainte de a raporta.
- **Starea finală:**
  - `interrupted`, 0 execuții active, 0 procese Codex ale Hub-ului;
  - nicio etapă următoare;
  - Demo A neschimbat (`src/requests.js` cu același hash `5d357bd5…`, aceeași stare git).

## Proba 2.6 · Lega propune o misiune de engineering: **PASS_LIVE**

- **Prima sesiune:** `lega_mupxxc76_fc90714b79` s-a închis cu **„closed: error”** la 5 s după conectare, pe grantul `grant_mupxocxc_09da3e4f19`, care s-a consumat.
  - Cauza probabilă: sesiunea a pornit din panoul de browser al aplicației Claude (microfon). API-ul nu dă mai mult detaliu.
  - S-a reluat cu un grant nou cu aceiași parametri, `grant_mupxz47i_b944ce8288`, din Chrome.
- **Sesiunea a doua:** `lega_mupxz7vs_8cf23b8d0d` (1,51 min, estimat ~0,08 USD; consumul real din plan nu e raportat).
- **Lanțul de evenimente (UTC):**
  1. 19:43:48: cererea vocală, transcrisă cu „Factory D-Mobi” în loc de „Demo B”.
  2. Lega a folosit `list_projects` și `project_brief` și a ales corect Factory Demo B.
  3. 19:44:23: `lega.propose_mission` pe canalul **voice**, cu politica ALWAYS_ASK. A apărut aprobarea `apr_mupy0h8v_1e6bb13f8c` (`lega.mission_request`, ținta `prj_mup6nqd7_57f7ba5b4b:eng_feature`).
  4. 19:44:32: **clicul proprietarului** (`approval.decide`, canal ui, `decidedBy: user`), apoi aprobarea s-a consumat.
  5. Misiunea `mis_mupy0no5_922d2614b0` („Validarea numărului de telefon în formularul de solicitare”) a fost creată cu spec v1 (5 probleme de completat), în **SPEC_DRAFT**, cu **0 execuții**.
  6. 19:45:00: sesiunea a fost oprită de proprietar. O cerere vocală ulterioară („update pe criterii…”) nu a apucat să aibă efect.

## R2 · Mediul izolat `ifrim-runner`: instalat, **canary PASS_LOCAL**; R2 rămâne DESCHIS

- **Instalare:**
  - Ubuntu 24.04.5 LTS, WSL2, în `C:\Users\mihai\AppData\Local\IfrimRunner\wsl`, VHD max 40 GB;
  - `wsl.conf`: fără automount, fără fstab, interop oprit, fără PATH Windows, GPU oprit, utilizator implicit `runner`;
  - `runner` fără sudo și fără parolă.
- **Software:**
  - pachete Ubuntu: bubblewrap 0.9.0 și git 2.43;
  - Node v24.21.0, de pe nodejs.org cu SHA-256 verificat, în `/usr/local/lib/nodejs` (aparține lui root);
  - Codex CLI **0.159.2**, prin instalatorul oficial, fixat și copiat în `/usr/local/lib/codex` (aparține lui root).
- **Configurație** `~runner/.codex/config.toml`:
  - fără MCP, fără pluginuri, credențiale în fișier, fără verificare de update;
  - profiluri `ifrim_runner_rw` și `ifrim_runner_ro` cu `":root"="deny"` și `":minimal"="read"`;
  - `~/.codex`, `/tmp` și `.env*` negate, rețeaua oprită.
- **Login:** „Logged in using ChatGPT” (abonament, fără cheie API). Autorizarea cu cod de dispozitiv a dat **503**, așa că s-a folosit loginul prin browser: redirecționarea localhost Windows → WSL. `auth.json` are permisiuni 600 și nu a fost citit.
- **Canary-ul** (`node v2/tests/manual/r2-wsl-canary.mjs`): **PASS_LOCAL, 40/40** (C1–C13, C15, C17), cu tokenul real prezent.
  - Amprenta mediului: `wslconf=b8890b2f40e0327e codex=0.159.2 config=4a7c12306a171922 kernel=6.6.114.1-microsoft-standard-WSL2`.
- **Probleme găsite și rezolvate la instalare:**
  - binarul Codex din `~/.codex/packages` era blocat de propria regulă de negare a `~/.codex`, deci sandbox-ul nu putea rula nimic. Mutat în `/usr/local/lib/codex`;
  - Node din `/opt` nu era în setul `:minimal`. Mutat în `/usr/local/lib/nodejs`;
  - `/tmp` al distribuției era comun cu sandbox-ul și scrierile persistau între rulări. Acum e negat; fiecare rulare primește TMPDIR în workspace;
  - mediul cu care e lansat sandbox-ul conținea variabile WSL/GUI. `wsl-runner` va lansa cu `env -i`, iar în sandbox rămân 7 variabile neutre;
  - intrarea binfmt `WSLInterop` e globală pe kernelul WSL comun și nu se poate scoate fără să strice celelalte distribuții. Lansarea unui executabil Windows din `ifrim-runner` e refuzată (C4d).
- **Ce lipsește pentru a închide R2:**
  - codul `wsl-runner` din Hub: pornire cu mediu curat, copierea workspace-ului, patch verificat, C14, C16;
  - schimbarea porții `host_isolation`, cu acordul tău, legată de amprenta de mai sus;
  - o probă live pe un proiect hub-test prin `wsl-runner`.
- **Revenire:** `wsl -d ifrim-runner -- codex logout`, apoi `wsl --unregister ifrim-runner`, care șterge definitiv distribuția.

## Demo A

Pachetul `bnd_mupj3diq_d386324921` a fost **acceptat de proprietar** (OWNER_ACCEPTED). Înainte, o verificare independentă cu 3 recenzori read-only a recomandat ACCEPT:
- testele trec 6/6, iar acceptanța 2/2;
- integritatea se verifică: ce s-a acceptat e octet cu octet ce a fost testat.

Modificarea rămâne necomisă în proiectul Demo A. Commit-ul e o decizie separată.
