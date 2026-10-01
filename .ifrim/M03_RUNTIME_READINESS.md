# M03 · Pregătirea runtime-ului (M03-A): izolare, MCP, model și efort

Data: 2026-10-01. Versiune: `2.4.0-m03`. Statusuri: PASS_LOCAL, PASS_SIMULATED, PASS_LIVE, FAIL, BLOCKED, NOT_RUN, SKIPPED_ENV, NEVERIFICAT, NEEDS_INSTALL_APPROVAL.

## 1. Harta accesului (cine poate citi și scrie ce)

| Proces | Rulează ca | Citește | Scrie | Rețea | Graniță |
|---|---|---|---|---|---|
| Backend Hub (`node v2/server/main.mjs`) | utilizatorul tău | tot ce poți citi tu: baza Hub din `.ifrim/private`, proiectele, **numele** cheilor din `~/.codex/config.toml` | baza Hub, backup-uri, `.ifrim/tmp/v2` (snapshot-uri, pachete) | doar 127.0.0.1 | niciuna față de tine (e Hub-ul) |
| Client oficial Codex (`codex app-server`) | utilizatorul tău | `~/.codex` (autentificare, config) | `~/.codex` | OpenAI | clientul oficial, neatins de Hub |
| Comenzile modelului Codex (+ subprocesele lor) | utilizatori `CodexSandbox*` (sandbox Windows elevated) | **tot calculatorul**, minus căile negate (lista de mai jos) | doar workspace-ul (profil `ifrim_hub_rw`); nimic la `ifrim_hub_ro` | oprită | OS (ACL DENY persistente) |
| Client oficial Claude Code | utilizatorul tău | `~/.claude` | `~/.claude` | Anthropic | clientul oficial |
| Uneltele modelului Claude (doar citire) | în procesul Claude Code | `Read/Glob/Grep` în directorul de lucru; citirea în afara lui cere o confirmare, refuzată automat în `dontAsk` | nimic (fără Edit/Write/Bash) | — | unealtă (nu OS) |
| Runner-ul Software Factory (teste, verificări) | `codex sandbox`, profil `ifrim_hub_rw` | ca și comenzile Codex | workspace-ul | oprită | OS; în teste: fixture fără sandbox real (SIMULAT); `codex sandbox` real pe arbore fictiv: ~4–6 s pe comandă (PASS_LOCAL) |
| Browserul E2E al fabricii (Playwright 1.61.0, Chromium 1228) | utilizatorul tău, Chromium cu sandbox-ul OS activ | context nou, fără profil | doar capturile de dovezi | doar originea preview-ului (proxy mort pentru rest, DNS doar pentru localhost, fără QUIC) | sandbox Chromium + filtrul de cereri; testat cu browserul real (M03-BR-01…03) |
| Preview-ul Software Factory | `codex sandbox`, profil `ifrim_hub_rw` | ca și comenzile Codex | workspace-ul (`workspace.ignore` pentru date de rulare) | oprită; ascultarea pe 127.0.0.1 sub sandbox: NEVERIFICAT | OS |
| `process.run` (scripturile npm aprobate de tine din Unelte) | utilizatorul tău | tot | tot | da | **niciuna**: nu e folosit de Software Factory; rămâne pentru scripturile tale, cu aprobare pe comanda exactă |
| Lega (al doilea `codex app-server`) | utilizatorul tău | — (thread fără medii: fără shell, fără fișiere) | — | OpenAI (voce, căutare `cached`) | thread fără environments |

Exporturi spre modele:
- promptul Hub-ului, cu text redactat;
- pachetul de review: diff redactat, limitat la 40 000 de caractere;
- pachetul de handoff, redactat.

Pachetele de livrare și snapshot-urile stau în `.ifrim/tmp/v2/factory/<misiune>`, cale negată modelelor.

## 2. R3: `~/.codex/config.toml*` (cod gata, ACL în așteptarea acordului tău)

**Ce s-a schimbat (`v2/server/policy/isolation.mjs`):**
- `.codex/config.toml`, copiile lui (`config.toml.*`, prin glob) și `.codex/history.jsonl` intră în lista de căi negate pentru comenzile modelului.
- Directorul `~/.codex` rămâne citibil: runner-ul sandbox-ului pornește din `.sandbox-bin`, iar un DENY moștenit nu poate fi re-permis pe un copil.
- Hub-ul citește în continuare doar numele cheilor din `config.toml`, din backend, nu prin sandbox. Clientul oficial rulează ca tine, deci autentificarea și configul lui nu sunt afectate.

**De ce contează:**
- `config.toml` poate conține comenzile serverelor MCP, valorile `env` ale acestora (token-uri) și endpoint-uri de provider.
- `history.jsonl` conține prompturile tale din toate proiectele.

**Dovadă live că `~/.codex` era citibil:** execuția `run_muojnivb_b113ce0591` (2026-09-30) a citit de 5 ori fișiere din `C:\Users\mihai\.codex\plugins\cache\...`. Pluginurile sunt oprite de atunci, dar folderul `plugins` rămâne citibil. E un candidat de negare, decizia ta. Impactul posibil: skill-uri de plugin în Codex desktop care citesc din sandbox.

**Efecte și pași necesari:**
- Lista s-a schimbat, deci amprenta acordului s-a schimbat. Poarta va arăta `NEEDS_LIVE_APPROVAL` pentru Codex până confirmi lista nouă în Integrări → Izolare. Rezultatul: nicio execuție Codex nu pornește pe lista veche.
- **Acordul nou a fost dat de tine din UI pe 2026-10-01 la 06:46 UTC** (amprenta `0f5b7efee0143fa8`). DENY-urile reale pe cele trei intrări noi se scriu la prima comandă Codex reală din sandbox.
- **Impact asupra Codex desktop:** comenzile sandbox din Codex desktop nu vor mai putea citi aceste trei intrări. Nu au nevoie de ele: aplicația le citește ca tine, nu prin sandbox.
- **Revenire:** `icacls "<cale>" /remove:d CodexSandboxUsers` pe fiecare intrare.
- **Verificare: PASS_LOCAL (2026-10-01, rulat la cererea ta).** Canary-ul pe arbore fictiv (`node v2/tests/manual/codex-sandbox-canary.mjs`, Codex CLI 0.159.2): 50 de verificări trecute. `config.toml`, `config.toml.bak` și `history.jsonl` sunt DENIED pentru comenzile din sandbox, iar comenzile normale în workspace merg în continuare. ACL-urile au fost scrise doar în `%TEMP%`, iar arborele a fost șters. Pe calculatorul tău real, lista nouă se aplică abia după acordul tău din Integrări → Izolare.
- **Teste:** M03-ISO-01 (profilul TOML conține intrările; `~/.codex` nu e negat întreg; amprenta M02 ≠ M03) → PASS_LOCAL.

## 3. R2: citirea altor proiecte (DESCHIS, blocat în poartă)

**Fapte:**
- Sandbox-ul Windows elevated cere citire pe `:root` (constatat în M02).
- Pagina oficială (learn.chatgpt.com/docs/windows/windows-sandbox, consultată 2026-10-01) descrie granițe ACL pentru scriere și `/sandbox-add-read-dir` pentru a **adăuga** citire.
- Nu am găsit acolo o opțiune care să restrângă citirea la rădăcini aprobate.
- Rezultat: orice cale nenegată e citibilă prin cale absolută, inclusiv proiectele altor clienți și `.env`-urile lor.

**De ce nu se repară cu mai multe DENY:**
- ACE-urile DENY sunt persistente și se aplică și Codex desktop. Negarea folderelor celorlalte proiecte ar strica lucrul tău în Codex desktop pe acele proiecte.
- O listă de foldere interzise rămâne incompletă prin natura ei, iar spec-ul cere rădăcini aprobate, nu liste.

**Ce face Hub-ul acum** (verificarea `host_isolation` în poartă, `evaluateHostIsolation`):
- Codex: admis fără condiții doar pe proiecte de test sanitizate (`source = hub-test`). Pe orice alt proiect, inclusiv Hub-ul, e blocat cu `R2_OPEN`.
- Excepție: acceptarea ta explicită, doar din UI, cu text exact, legată de calea proiectului, valabilă cel mult 7 zile și revocabilă și din voce.
- Acceptarea e afișată ca „risc acceptat (nu este o izolare)”. REAL_PROJECT_READY rămâne neatins.
- Claude doar-citire: admis, cu eticheta „limită unealtă” (`dontAsk` refuză citirile în afara directorului de lucru).
- Lega nu poate accepta R2: comanda nu e disponibilă pe canalul voce.

**Remedierea propusă** (îți cere aprobarea; nimic instalat):

| Opțiune | Ce înseamnă | Efecte | Recomandare |
|---|---|---|---|
| A. Mediu separat (WSL2 / VM / Windows Sandbox) cu doar workspace-ul montat | Codex și runner-ul rulează acolo; restul discului nu există pentru ele | instalare, config, alt sandbox (Linux), drum nou de validat | **recomandat** pentru REAL_PROJECT_READY |
| B. Utilizator Windows separat pentru execuțiile Hub, proiectele tale fiind ACL-ate doar pentru tine | izolare prin cont | schimbări ACL masive pe proiectele tale | nerecomandat (risc mare, reversibil greu) |
| C. DENY pe folderele celorlalte proiecte | listă de interdicții | strică Codex desktop pe acele proiecte; lista rămâne incompletă | respins |

**Teste:**
- M03-ISO-02 (logica): PASS_LOCAL.
- M03-HUB-01 (poarta refuză Codex fără acceptare; acceptarea doar din UI, cu textul exact; retragerea merge din voce): PASS_SIMULATED.
- Canary-ul (2026-10-01): 4 citiri ale proiectului fictiv „alt client” (`.env` și `src/client.txt`, în ambele profiluri) au fost ALLOWED. Sunt raportate `KNOWN_GAP_R2`, nu ca trecute: confirmă empiric că R2 e deschis.

## 4. MCP și pluginuri: regulile din `6432c5e`, păstrate pe toate traseele noi

Pentru orice proces Codex al Hub-ului:
- pluginurile sunt oprite;
- serverele MCP din config sunt oprite pe nume;
- pornirea e refuzată dacă un nume nu poate fi adresat sau dacă proiectul are `.codex/config.toml`;
- toate paginile `mcpServerStatus/list` sunt verificate (fail-closed) după `thread/start` **și** după `thread/resume`;
- orice apel MCP oprește execuția.

Claude se oprește înainte de model dacă `init` raportează vreun server MCP.

Traseele noi M03 trec toate prin `runs.start` → `startTurn`, deci prin aceleași verificări:
- dispatch-ul Software Factory (implementare, review, remediere, reluare);
- pornirea țintei unui handoff;
- reluarea unui thread.

Lega păstrează propriul preflight.

Fișierele de control (`.codex/`, `.claude/`, `.mcp.json`, `AGENTS.md`, `CLAUDE.md`) create sau modificate de un writer devin findings **critice**, iar misiunea se oprește înainte de verificări. O execuție următoare ar refuza oricum un `.codex/config.toml` de proiect.

Teste: M03-MCP-01 (MCP activ la reluarea unui thread → oprit înainte de turn): PASS_SIMULATED. M01/M02/M03 MCP-01…09 rămân: PASS_SIMULATED.

## 5. Model și efort explicite

Fișier: `v2/server/policy/run-plan.mjs`. Fiecare execuție are un plan înregistrat (`agent_runs.plan_json`). Planul conține:
- modelul cerut, modelul trimis și sursa lui: tu sau `model/list`, implicitul contului;
- efortul cerut, efortul trimis și sursa lui: tu sau profilul;
- eforturile suportate;
- ce a raportat providerul (`reported`).

**Profiluri** (etichete ale Hub-ului, nu planuri sau valori ale providerilor):

| Profil | Codex | Claude |
|---|---|---|
| ECONOMIC | low | low |
| BALANCED (implicit) | medium | medium |
| DEEP | high | high |

`max` sau `xhigh` se trimit doar dacă îi alegi tu explicit.

**Codex:**
- `-c model_reasoning_effort="<efort>"` setează efortul pentru proces, modelul e trimis în `thread/start`, iar efortul și în `turn/start`.
- Dacă `thread/start` raportează alt efort sau alt model, execuția se oprește înainte de turn, iar încercarea din grant revine.
- Un thread vechi reluat cu alt efort nu continuă tăcut: se pornește un thread nou, cu pachetul de context al Hub-ului.

**Fără `model/list` salvat:** verificarea `run_plan` din poartă eșuează. „Verifică contul” cere acum lista de modele implicit (fără inferență).

**Claude:**
- se trimite `--effort`; dacă CLI-ul instalat nu listează flag-ul, execuția e refuzată;
- Claude Code nu raportează efortul efectiv în stream (limitare documentată);
- modelele Fable și `[1m]` rămân refuzate.

**Gărzile de facturare rămân neatinse:**
- credit peste zero blochează Codex;
- Fable este refuzat;
- `--setting-sources user`;
- fără chei API și fără moduri fast.

**Teste:**
- M03-RP-01…03 (rezolvare, refuzuri, validarea argumentului): PASS_LOCAL.
- M03-HUB-02 (un Codex care păstrează `max` din config e oprit înainte de turn; încercarea revine): PASS_SIMULATED.
- FAC-01 (writer cu `medium` trimis și raportat): PASS_SIMULATED.

## 6. Încercările din grant, Stop și restart

**Restituirea încercării:**
- Se face doar când cronologia arată că nu s-a trimis niciun turn (`turn_sent` absent) și rezultatul e pre-inferență.
- E plafonată la `maxAttempts` restituiri per grant (eveniment `grant.refund_refused` peste plafon). Nu există buclă infinită.
- Nu e un refund de usage de la provider, ci contorul intern al Hub-ului.

**Stop All:**
- suspendă poarta;
- marchează sincron fiecare misiune Software Factory activă (`CANCEL_REQUESTED`), înainte de orice întrerupere;
- întrerupe numai execuțiile și procesele misiunilor, nu alte procese Node, browser sau Codex de pe calculator.

**Pornirea Hub-ului:**
- recuperarea marchează dispatch-urile în curs `INTERRUPTED_UNKNOWN` și misiunile `BLOCKED`;
- nimic nu se reia singur;
- modul revine la BUILD_SAFE.
