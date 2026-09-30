# M02 — Implementation status

Milestone 02 „JARVIS experience + security readiness”, construit peste M01. Nu e o reconstrucție.

- Data: 2026-09-30, actualizat 2026-10-01.
- Branch: `v2-milestone-01`. M02 e comis (`0fb71d2`). După el au urmat commit-urile Lega: `30bfbef`, `dac2db4`, `ce819b9`, `bbe8757`. Branch-ul e împins până la `bbe8757`. `main` a rămas la `e9ab563`. Nimic nu e unit (merge) și nimic nu e publicat (deploy).
- În commit-ul de după `bbe8757` (local; push-ul îl face proprietarul): corecțiile din verificarea M02, izolarea MCP, aprobările dintr-un click, grant-urile expirate afișate ca expirate și aceste documente.
- Hub: `2.3.0-m03` (era `2.2.0-m02`).
- Verdict: **versiune locală validată live pe proiectul de test, nu pregătită pentru autonomie.** Validare live:
  - Claude read-only: PASS_LIVE;
  - Codex: FAIL la 14:41 (transport, înainte de inferență), corectat în `30bfbef`, apoi PASS_LIVE de două ori (workspace-write și read-only);
  - Lega (voce): PASS_LIVE.

## După M02 (2026-09-30 → 2026-10-01)

- **Lega**, asistentul vocal (detalii în [LEGA](LEGA.md)): voce GPT-Live prin Codex (`30bfbef`), Modul Lega pe tot ecranul (`dac2db4`), pluginurile oprite pentru procesul de voce și încercarea returnată la o pornire eșuată (`ce819b9`), acces complet sub controlul tău și căutare web doar pentru Lega (`bbe8757`).
- **Izolare MCP pentru fiecare proces Codex al Hub-ului** (găsită live: o execuție a apelat de 3 ori serverul `cua_repl/js` al pluginului Computer Use; serverele MCP rulează în afara sandbox-ului Codex):
  - `features.plugins=false` și `features.remote_plugin=false`; fiecare server din config-ul tău e dezactivat pe nume;
  - refuz înainte de pornirea procesului dacă un nume nu poate fi dezactivat sau dacă proiectul are `.codex/config.toml`;
  - `mcpServerStatus/list` e verificat pe toate paginile înainte de turn (fail-closed);
  - un apel MCP în timpul turnului oprește execuția;
  - în total, 16 setări per proces: cele 14 anterioare + cele 2 pentru pluginuri;
  - Claude: execuția se oprește înainte de model dacă `init` raportează vreun server MCP sau vreo unealtă `mcp__`.
  - Teste: M03-MCP-01..09.
- **Aprobări dintr-un click** (bug găsit live): „Aprobă și pornește” pentru comenzile propuse; secțiunea vizibilă „Aprobate, încă nepornite” (și pentru scripturi npm și verificări de browser), cu butonul „Pornește acum”; toast dacă pornirea eșuează; Lega spune ce e aprobat, dar nepornit.
- **Codex**: verificare exactă a modelului; `externalSandbox` refuzat; un Stop înainte de turn nu mai e urmat niciodată de un apel de model.
- **Grant-uri expirate**: afișate și judecate ca expirate (M03-RF-10).
- **Simulator**: „Eroare auth” produce acum o eroare reală de autentificare (M03-RF-03).
- **Teste întărite**: SEC-09 (listarea junction-urilor), RT-05 (redactarea), UI-09 (calea reală de cod).
- **Teste** (detalii în [M02_TEST_REPORT](M02_TEST_REPORT.md)): V2 249 de teste, 248 PASS, 0 FAIL, 1 SKIPPED_ENV. V1 552 de teste: 549 PASS, 1 omis, 2 FAIL prin timeout doar în suita completă (trec singure). Build OK, `npm audit` 0.
- **Starea Hub-ului la final**: 127.0.0.1:8011, `2.3.0-m03`, BUILD_SAFE, poarta de execuție deschisă (așa ai lăsat-o pentru Lega), 0 grant-uri active, nicio execuție și nicio sesiune Lega activă. Simulatorul (8012) e separat.

Vezi și: [M02_SECURITY_READINESS](M02_SECURITY_READINESS.md), [M02_TEST_REPORT](M02_TEST_REPORT.md), [M02_VISUAL_REVIEW](M02_VISUAL_REVIEW.md), [M02_LIVE_VALIDATION_PLAN](M02_LIVE_VALIDATION_PLAN.md), [M02_DESIGN_SYSTEM](M02_DESIGN_SYSTEM.md), [RUNBOOK](RUNBOOK.md).

## Concluzie pe categorii (§31)

### IMPLEMENTED_AND_TESTED_LOCAL
- **Izolare Codex prin OS**: profiluri per proces, negări absolute pentru Hub, `~/.codex` negat doar pe fișierele de autentificare și istoric, opriri înainte de turn, check `isolation` în poartă cu acord și amprentă. Canary: 46/46.
- **Izolare Claude la nivel de unealtă**: read-only cu negări absolute; shell/scriere blocat.
- **Rute de fișiere pe server**: căi protejate, junction-uri, paginare, căutare redactată, artefacte relativ la proiect. Listarea ascunde link-urile și junction-urile care duc în zone protejate sau în afara proiectului. Proiectele de test sanitizate sunt verificate recursiv (M02-SEC-14).
- **Shell nou**:
  - rail, top bar cu proiect, conexiune și ultima actualizare, căutare, Stop All peste tot;
  - paletă de comenzi (Ctrl+K), mini-asistent (Alt+M), bottom nav pe telefon;
  - scurtăturile Alt ignoră AltGr, IME și numpad: tastarea pe tastatura românească nu mai schimbă ecranele (M02-UI-11);
  - indicatorul de execuție are butoanele „Deschide” și „Întrerupe”;
  - error boundaries.
- **Control Room**: Ce se întâmplă, Ce trebuie să decid, Unde continui, Companie (structură, nu muncă), Sănătate.
- **Nucleu procedural WebGL2**:
  - 10 stări din semnale reale;
  - fallback SVG, pierdere de context, calitate adaptivă, suspendare.
- **Focus**:
  - layout redimensionabil și salvat; listă, conversație, inspector (Fișiere, Diff, Teste, Aprobări, Execuții, Handoff, Preview, Task), panou inferior (Output / Procese / Terminal etichetat „neimplementat”);
  - conversația are streaming, Stop, retry controlat, căutare, salt la rezultat, copiere, Markdown sigur și etapa erorii;
  - ciorna se păstrează.
- **Compozitor**: context eliminabil; drag-drop cu validare, progres și anulare; BUILD_SAFE → previzualizarea porții.
  - Modele și efort: doar pentru Codex vin din capabilități verificate (modelele și eforturile per model din `model/list`). Aliasurile Claude sunt statice și sunt etichetate „neverificat” în UI (M02-UI-12).
  - Atașamente: limită de 10 MB, ca serverul; nume de fișier de cel mult 200 de caractere; doar tipurile MIME acceptate de server (M02-UI-13/14).
- **Misiuni**: listă și graf, lanț owner → reviewer → QA, criterii, dovezi, timeline, progres numărat.
- **Catalog OpenAI/Anthropic**: 6 fapte separate per capabilitate.
- **Panou Izolare** (Integrări) și **Instrumente**: Browser Workspace cu stare reală, panou Calculator cu mecanisme reale, comenzi controlate, procese.
  - Browser Workspace: allowlist de cereri, verificarea redirecționărilor și un strat de rețea (proxy mort, cu excepția host:port aprobat; DNS doar pentru localhost; fără QUIC și fără UDP ne-proxiat). Doar cod, testat cu browser fals (M02-RT-06..09); Playwright nu e instalat.
- **Voce**: VoiceProvider separat de LLM, mod local strict, NEEDS_SETUP real, setări, eliberarea microfonului; comenzi locale deterministe, iar vocea nu aprobă.
- **Stare live**: SSE, „Reconectare” + ultima actualizare.
  - La reconectare, clientul deschide un `EventSource` nou cu `?after=<ultimul seq>`. Nu folosește antetul Last-Event-ID (un obiect nou nu îl trimite).
  - O singură poartă de evenimente, testată, folosită de aplicație: deduplicare, respingerea secvențelor vechi sau în dezordine, resincronizare după resetarea bazei de date (M02-UI-09/10/10b).
  - Pe server, un backlog mare se golește cu backpressure, în loc să închidă fluxul.
  - Limită cunoscută: o resetare a bazei de date nu e detectată dacă jurnalul nou a trecut deja de marcajul clientului (`hello` nu are o identitate stabilă a jurnalului).
- **Responsive**: 360–1920 px, zoom 200%, ținte touch.
- **Accesibilitate**: etichete, focus, contrast AA, alternativă listă la graf.

### IMPLEMENTED_TESTED_SIMULATED
- Simulator separat (8012), cu scenarii prin API-urile reale, declanșabile din banner:
  - execuție, aprobare, cotă, eroare de autentificare, handoff, întreruperea fluxului;
  - misiune cu taskuri în stări variate.
- Stările vizuale WAITING_APPROVAL, WAITING_PROVIDER, ERROR și PAUSED.

### VERIFIED_LIVE
- **Claude Code read-only** pe proiectul de test sanitizat: un turn, poarta + grant + backup automat, răspuns corect, fără modificări (run `run_muo6i9og_50c329673c`, 2026-09-30). Captura `m02-18`.
- **Codex** (toate pe proiectul de test „Ifrim Hub Test”, 2026-09-30, ore UTC):
  - 14:41, read-only (`run_muo7r9bp_d1b50893f7`): FAIL (transport, `thread/start` peste 120 s, înainte de inferență). Corectat în `30bfbef` (`project_doc_max_bytes=0`, `project_root_markers=[]`).
  - 20:14–20:27, workspace-write (`run_muojnivb_b113ce0591`), propus de Lega și aprobat de tine (formular de contact cu validatorul existent): PASS_LIVE. `npm test` 4/4. Claude a verificat pagina în browser: erori pe câmpuri în română și starea de succes „mesajul nu a fost trimis”. Constatare: execuția a apelat de 3 ori serverul MCP `cua_repl/js` → corectat (izolarea MCP de mai sus).
  - 21:39–21:48, read-only după corecția MCP (`run_muomogfu_f3b3dcccd7`, Hub `2.3.0-m03`): PASS_LIVE. Rezumat corect în română, verificarea MCP trecută, niciun apel MCP, nicio cerere de escaladare. Notă: au trecut ~8 min până la prima comandă din sandbox (costul primei comenzi în sandbox-ul Windows).
- **Lega (voce)**, 18:18–19:49: PASS_LIVE, română în ambele sensuri, inclusiv versiunea cu acces complet (sesiunea `lega_muoic63s_69b4539e26`, 11,4 min).

### NEEDS_INSTALL_APPROVAL
- Playwright (devDependency npm, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, reutilizează Chromium existent din `%LOCALAPPDATA%\ms-playwright`, Apache-2.0) → Browser Workspace E2E.
- Motor local de transcriere în română (sau pachet de limbă local) → voce în mod strict local.
- Actualizarea Claude Code CLI 2.1.175 → ≥2.1.284 pentru aliasurile Opus/Sonnet 5.5 (schimbare globală; decizia ta).

### NEEDS_LIVE_APPROVAL
- Acordul ACL Codex (Integrări → Izolare): **făcut**. ACE-urile DENY există pe toate căile protejate.
- Preflight-ul real (`codex-real-profile-preflight.mjs`, fără model): NOT_RUN. Stratul local de permisiuni a refuzat să-l ruleze pentru Claude. Rămâne o acțiune opțională a ta, în terminalul tău.
- „Verifică contul” Codex: **făcut** (poarta a admis execuțiile Codex, deci a văzut sandbox-ul „ready”).
- Turnurile live read-only per provider: **făcute** (vezi VERIFIED_LIVE).
- Încă neverificate live: handoff-ul Codex ↔ Claude; Stop/întreruperea live a unui turn de model în curs; Codex workspace-write prin profilul rw dincolo de această singură execuție; căutarea web și `propose_mission` ale Lega.

### BLOCKED_BY_PLATFORM_OR_INTEGRATION
- Overlay global always-on-top (fără componentă nativă).
- Control desktop / captură de ecran (bridge nativ neconstruit).
- Terminal interactiv real: nu există transport sigur, deci e etichetat corect ca „neimplementat”; output-ul și comenzile controlate funcționează.
- Acces remote de pe telefon (binding-ul rămâne 127.0.0.1).
- Emularea OS reduced-motion și FPS real în panoul de test.

### SECURITY_BLOCKER
- **Claude Code cu shell/scriere pe Windows nativ**: nu există sandbox OS (doar macOS/Linux/WSL2).
- **Codex fără acord ACL sau fără sandbox „ready”**: blocat de poartă. Pe acest PC, acordul e înregistrat și sandbox-ul a fost „ready” la execuțiile live; blocajul rămâne regula pentru orice amprentă nouă.

### NOT_IMPLEMENTED
- Wake word (opțional, oprit implicit, nu a fost cerut acum).
- PWA/service worker (intenționat: nu se cache-uiesc conversații sau aprobări).
- Sunete.
- Replay istoric etichetat (simulatorul acoperă design review; replay-ul nu a fost construit).
- Virtualizarea listelor foarte lungi de loguri: se folosesc limite și paginare, nu virtualizare.

## Inventar cerință → implementare → test → dovadă → status

| § | Cerință | Implementare | Test | Dovadă | Status |
|---|---|---|---|---|---|
| 02 | Checkpoint local fără commit | `.ifrim/CHECKPOINTS/2026-09-30-milestone-02-start.json` | — | fișier | PASS_LOCAL |
| 05 | Izolare Codex verificabilă | `policy/isolation.mjs`, `providers/codex.mjs`, `policy/gate.mjs` | M02-SEC-01/01b/03/04/05/06/12, M03-MCP-01..08, M03-RF-01/02, canary manual | canary 46/46; F1–F7; run-urile live din 2026-09-30 | PASS_LOCAL; PASS_LIVE după corecția MCP (`run_muomogfu_f3b3dcccd7`). `run_muojnivb_b113ce0591` a găsit o breșă: 3 apeluri MCP `cua_repl/js` în afara sandbox-ului, corectată (M03-MCP-01..08) |
| 05 | Izolare Claude | `claudeDeniedReads`, `providers/claude.mjs` | M02-SEC-02/07/08, M03-MCP-09 | argumente `-p` în log fixture; run live | PASS_LOCAL (unealtă); PASS_LIVE read-only (`run_muo6i9og_50c329673c`) |
| 05 | Fără schimbări OS neaprobate | acord + amprentă; canary pe arbore fictiv | M02-SEC-12 | la livrare: 0 ACE DENY pe căile reale; după acordul tău înregistrat, ACE-urile DENY aprobate există pe căile protejate (nicio schimbare fără acord) | PASS_LOCAL |
| 06 | Fără commit/push/branch în timpul construcției | — | — | M02 a fost construit necomis; ulterior a fost comis (`0fb71d2`) și împins pe `v2-milestone-01` (până la `bbe8757`); `main` a rămas `e9ab563`; fără merge și fără deploy | PASS_LOCAL |
| 09 | Tokeni + componente | `tokens.css`, `m02.css`, `components/*` | — | M02_DESIGN_SYSTEM | PASS_LOCAL |
| 10 | Control Room (3 întrebări; fără agenți inventați) | `screens/ControlRoom.jsx` | vizual | 06, 01 | PASS_LOCAL / PASS_SIMULATED |
| 11 | Nucleu 3D original, 10 stări reale, SVG, context loss, reduced motion | `components/core/Core3D.jsx`, `lib/coreState.js` | M02-UI-01; context loss ×3; eroare injectată | 13, 14 | PASS_LOCAL; oprirea animației la reduced motion NOT_RUN |
| 12 | Focus: layout, conversație, inspector, panou inferior, erori pe etape | `screens/focus/*`, `lib/uiLogic.js` | M02-UI-04/05 | 03, 12, 16 | PASS_SIMULATED |
| 12 | BUILD_SAFE: redactare, trimiterea arată autorizarea | Composer → previzualizarea porții | vizual | — | PASS_LOCAL |
| 13 | Compozitor: context, modele (Codex din `model/list`; aliasuri Claude statice, etichetate neverificat), drag-drop, paletă, anti-dublu-click | `Composer.jsx`, `Shell.jsx`, `api.js` (`uploadWithProgress`) | M02-UI-03/12/13/14 | — | PASS_LOCAL |
| 14 | Misiuni listă + graf, owner/reviewer/QA, progres numărat | `screens/Missions.jsx` | M02-UI-06 | 02 | PASS_SIMULATED |
| 15 | Fișiere/diff/teste/terminal distincte; protecție server | `tools/registry.mjs`, `security/paths.mjs`, Inspector | M02-RT-01/02/05, M02-SEC-09/10 | — | PASS_LOCAL |
| 16 | Browser Workspace, Playwright după aprobare | `tools/browser.mjs`, `screens/Tools.jsx` | M02-RT-03/06..09, M02-SEC-11 | 05 | PASS_LOCAL; E2E BLOCKED (NEEDS_INSTALL_APPROVAL) |
| 17 | Panou Calculator | `screens/Tools.jsx` (deep link `claude-cli://open?cwd=`) | vizual | 05 | PASS_LOCAL; control desktop BLOCKED |
| 18 | Voce RO, VoiceProvider separat, local strict, NEEDS_SETUP | `shell/Voice.jsx`, `screens/Settings.jsx` | M02-UI-08 | 15 | PASS_LOCAL (NEEDS_SETUP); transcriere locală BLOCKED |
| 19 | Comenzi locale deterministe; vocea nu aprobă | `parseLocalCommand`, `command-catalog` (canale) | M02-UI-08, M02-SEC-12 (canal voce refuzat) | — | PASS_LOCAL |
| 20 | Mini-asistent, telefon, fără acces remote | `Shell.jsx`, `m02.css` | vizual 390 | 09, 11, 16 | PASS_LOCAL |
| 21 | Catalog filtrabil cu fapte separate | `screens/ecosystem/Catalog.jsx` | M02-UI-07 | 07 | PASS_LOCAL |
| 22 | Snapshot + reconectare (`?after=<ultimul seq>`, nu Last-Event-ID), deduplicare, ultima actualizare | `store.js`, `api.js` (`openStream`), `lib/uiLogic.js` (poarta de evenimente), `routes.mjs` (`dropStreams`, backpressure) | M02-UI-09/10/10b/14, M02-RT-04, scenariul „drop-stream” | — | PASS_LOCAL / PASS_SIMULATED; limită: resetarea DB cu jurnal nou deja peste marcaj nu e detectată |
| 23 | Simulator etichetat, fără provideri reali, fără poartă reală | `server/sim/*`, `scripts/sim*.mjs` | M02-RT-04 (404 în afara simulatorului), M01-NG1 | 01–04 | PASS_SIMULATED |
| 24 | Securitatea suprafețelor UI | Markdown, aprobări, canale, origini. O acțiune aprobată se execută doar prin rute backend care verifică aprobarea: `/api/approvals/:id/execute`, `/api/commands/:id/execute` (aprobări legate de o comandă) și `/api/browser/:approvalId/execute` | M02-UI-02, M02-SEC-* | — | PASS_LOCAL |
| 25 | Performanță + accesibilitate | nucleu adaptiv, lazy load, boundaries | măsurători | M02_VISUAL_REVIEW | PASS_LOCAL (parțial: fps, sesiune lungă, screen reader NOT_RUN) |
| 27 | Plan de testare cu statusuri separate | `v2/tests/m02-*.test.mjs`, `v2/tests/m03-*.test.mjs` | 39 teste M02 (28 la livrare) + 13 teste M03 noi (MCP 9, RF 4) | M02_TEST_REPORT | vezi raport |
| 28 | Verificare vizuală reală | `.ifrim/M02_EVIDENCE/` (18 capturi; a 18-a e testul live Claude) | — | M02_VISUAL_REVIEW | PASS_LOCAL |
| 29 | Plan live | `M02_LIVE_VALIDATION_PLAN.md`, preflight | — | M02_TEST_REPORT | PASS_LIVE: Claude read-only; Codex read-only și workspace-write (după un FAIL corectat); Lega. Handoff și Stop live: NOT_RUN |

## Noi dependențe

Niciuna. Playwright este propus, nu instalat.
