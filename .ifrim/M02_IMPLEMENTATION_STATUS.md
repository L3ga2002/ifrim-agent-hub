# M02 — Implementation status

Milestone 02 „JARVIS experience + security readiness”, construit peste M01. Nu e o reconstrucție.

- Data: 2026-09-30. Branch: `v2-milestone-01`, necomis. Hub: `2.2.0-m02`.
- Verdict: **versiune locală gata de evaluare vizuală, nu pregătită pentru autonomie.** Validare live: Claude read-only PASS_LIVE; Codex în așteptare (pornit de utilizator).

Vezi și: [M02_SECURITY_READINESS](M02_SECURITY_READINESS.md), [M02_TEST_REPORT](M02_TEST_REPORT.md), [M02_VISUAL_REVIEW](M02_VISUAL_REVIEW.md), [M02_LIVE_VALIDATION_PLAN](M02_LIVE_VALIDATION_PLAN.md), [M02_DESIGN_SYSTEM](M02_DESIGN_SYSTEM.md), [RUNBOOK](RUNBOOK.md).

## Concluzie pe categorii (§31)

### IMPLEMENTED_AND_TESTED_LOCAL
- **Izolare Codex prin OS**: profiluri per proces, negări absolute pentru Hub, `~/.codex` negat doar pe fișierele de autentificare și istoric, opriri înainte de turn, check `isolation` în poartă cu acord și amprentă. Canary: 46/46.
- **Izolare Claude la nivel de unealtă**: read-only cu negări absolute; shell/scriere blocat.
- **Rute de fișiere pe server**: căi protejate, junction-uri, paginare, căutare redactată, artefacte relativ la proiect.
- **Shell nou**:
  - rail, top bar cu proiect, conexiune și ultima actualizare, căutare, Stop All peste tot;
  - paletă de comenzi (Ctrl+K), mini-asistent (Alt+M), bottom nav pe telefon;
  - error boundaries.
- **Control Room**: Ce se întâmplă, Ce trebuie să decid, Unde continui, Companie (structură, nu muncă), Sănătate.
- **Nucleu procedural WebGL2**:
  - 10 stări din semnale reale;
  - fallback SVG, pierdere de context, calitate adaptivă, suspendare.
- **Focus**:
  - layout redimensionabil și salvat; listă, conversație, inspector (Fișiere, Diff, Teste, Aprobări, Execuții, Handoff, Preview, Task), panou inferior (Output / Procese / Terminal etichetat „neimplementat”);
  - conversația are streaming, Stop, retry controlat, căutare, salt la rezultat, copiere, Markdown sigur și etapa erorii;
  - ciorna se păstrează.
- **Compozitor**: context eliminabil; rută, model și efort din capabilități verificate; drag-drop cu validare, progres și anulare; BUILD_SAFE → previzualizarea porții.
- **Misiuni**: listă și graf, lanț owner → reviewer → QA, criterii, dovezi, timeline, progres numărat.
- **Catalog OpenAI/Anthropic**: 6 fapte separate per capabilitate.
- **Panou Izolare** (Integrări) și **Instrumente**: Browser Workspace cu stare reală, panou Calculator cu mecanisme reale, comenzi controlate, procese.
- **Voce**: VoiceProvider separat de LLM, mod local strict, NEEDS_SETUP real, setări, eliberarea microfonului; comenzi locale deterministe, iar vocea nu aprobă.
- **Stare live**: SSE cu Last-Event-ID, deduplicare, „Reconectare” + ultima actualizare.
- **Responsive**: 360–1920 px, zoom 200%, ținte touch.
- **Accesibilitate**: etichete, focus, contrast AA, alternativă listă la graf.

### IMPLEMENTED_TESTED_SIMULATED
- Simulator separat (8012), cu scenarii prin API-urile reale, declanșabile din banner:
  - execuție, aprobare, cotă, eroare de autentificare, handoff, întreruperea fluxului;
  - misiune cu taskuri în stări variate.
- Stările vizuale WAITING_APPROVAL, WAITING_PROVIDER, ERROR și PAUSED.

### VERIFIED_LIVE
- **Claude Code read-only** pe proiectul de test sanitizat: un turn, poarta + grant + backup automat, răspuns corect, fără modificări (run `run_muo6i9og_50c329673c`, 2026-09-30). Captura `m02-18`.
- Codex: pregătit, încă nerulat (vezi M02_TEST_REPORT).

### NEEDS_INSTALL_APPROVAL
- Playwright (devDependency npm, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, reutilizează Chromium existent din `%LOCALAPPDATA%\ms-playwright`, Apache-2.0) → Browser Workspace E2E.
- Motor local de transcriere în română (sau pachet de limbă local) → voce în mod strict local.
- Actualizarea Claude Code CLI 2.1.175 → ≥2.1.284 pentru aliasurile Opus/Sonnet 5.5 (schimbare globală; decizia ta).

### NEEDS_LIVE_APPROVAL
- Acordul ACL Codex (Integrări → Izolare), apoi preflight-ul real, fără model.
- „Verifică contul” Codex (contactează OpenAI, fără inferență), ca poarta să vadă sandbox-ul „ready”.
- Turnurile live: un turn read-only per provider pe proiect sanitizat. Handoff-ul e test separat.

### BLOCKED_BY_PLATFORM_OR_INTEGRATION
- Overlay global always-on-top (fără componentă nativă).
- Control desktop / captură de ecran (bridge nativ neconstruit).
- Terminal interactiv real: nu există transport sigur, deci e etichetat corect ca „neimplementat”; output-ul și comenzile controlate funcționează.
- Acces remote de pe telefon (binding-ul rămâne 127.0.0.1).
- Emularea OS reduced-motion și FPS real în panoul de test.

### SECURITY_BLOCKER
- **Claude Code cu shell/scriere pe Windows nativ**: nu există sandbox OS (doar macOS/Linux/WSL2).
- **Codex fără acord ACL sau fără sandbox „ready”**: blocat de poartă până la pașii din planul live.

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
| 05 | Izolare Codex verificabilă | `policy/isolation.mjs`, `providers/codex.mjs`, `policy/gate.mjs` | M02-SEC-01/01b/03/04/05/06/12, canary manual | canary 46/46; F1–F7 | PASS_LOCAL; live NEEDS_LIVE_APPROVAL |
| 05 | Izolare Claude | `claudeDeniedReads`, `providers/claude.mjs` | M02-SEC-02/07/08 | argumente `-p` în log fixture | PASS_LOCAL (unealtă) |
| 05 | Fără schimbări OS neaprobate | acord + amprentă; canary pe arbore fictiv | M02-SEC-12 | 0 ACE DENY pe căile reale | PASS_LOCAL |
| 06 | Fără commit/push/branch | — | — | `git status` | PASS_LOCAL |
| 09 | Tokeni + componente | `tokens.css`, `m02.css`, `components/*` | — | M02_DESIGN_SYSTEM | PASS_LOCAL |
| 10 | Control Room (3 întrebări; fără agenți inventați) | `screens/ControlRoom.jsx` | vizual | 06, 01 | PASS_LOCAL / PASS_SIMULATED |
| 11 | Nucleu 3D original, 10 stări reale, SVG, context loss, reduced motion | `components/core/Core3D.jsx`, `lib/coreState.js` | M02-UI-01; context loss ×3; eroare injectată | 13, 14 | PASS_LOCAL; oprirea animației la reduced motion NOT_RUN |
| 12 | Focus: layout, conversație, inspector, panou inferior, erori pe etape | `screens/focus/*`, `lib/uiLogic.js` | M02-UI-04/05 | 03, 12, 16 | PASS_SIMULATED |
| 12 | BUILD_SAFE: redactare, trimiterea arată autorizarea | Composer → previzualizarea porții | vizual | — | PASS_LOCAL |
| 13 | Compozitor: context, model din capabilități, drag-drop, paletă, anti-dublu-click | `Composer.jsx`, `Shell.jsx`, `api.js` (`uploadWithProgress`) | M02-UI-03 | — | PASS_LOCAL |
| 14 | Misiuni listă + graf, owner/reviewer/QA, progres numărat | `screens/Missions.jsx` | M02-UI-06 | 02 | PASS_SIMULATED |
| 15 | Fișiere/diff/teste/terminal distincte; protecție server | `tools/registry.mjs`, `security/paths.mjs`, Inspector | M02-RT-01/02/05, M02-SEC-09/10 | — | PASS_LOCAL |
| 16 | Browser Workspace, Playwright după aprobare | `tools/browser.mjs`, `screens/Tools.jsx` | M02-RT-03, M02-SEC-11 | 05 | PASS_LOCAL; E2E BLOCKED (NEEDS_INSTALL_APPROVAL) |
| 17 | Panou Calculator | `screens/Tools.jsx` (deep link `claude-cli://open?cwd=`) | vizual | 05 | PASS_LOCAL; control desktop BLOCKED |
| 18 | Voce RO, VoiceProvider separat, local strict, NEEDS_SETUP | `shell/Voice.jsx`, `screens/Settings.jsx` | M02-UI-08 | 15 | PASS_LOCAL (NEEDS_SETUP); transcriere locală BLOCKED |
| 19 | Comenzi locale deterministe; vocea nu aprobă | `parseLocalCommand`, `command-catalog` (canale) | M02-UI-08, M02-SEC-12 (canal voce refuzat) | — | PASS_LOCAL |
| 20 | Mini-asistent, telefon, fără acces remote | `Shell.jsx`, `m02.css` | vizual 390 | 09, 11, 16 | PASS_LOCAL |
| 21 | Catalog filtrabil cu fapte separate | `screens/ecosystem/Catalog.jsx` | M02-UI-07 | 07 | PASS_LOCAL |
| 22 | Snapshot + reconectare, deduplicare, ultima actualizare | `store.js`, `lib/uiLogic.js` (`acceptEvent`), `routes.mjs` (`dropStreams`) | M02-UI-09, M02-RT-04, scenariul „drop-stream” | — | PASS_LOCAL / PASS_SIMULATED |
| 23 | Simulator etichetat, fără provideri reali, fără poartă reală | `server/sim/*`, `scripts/sim*.mjs` | M02-RT-04 (404 în afara simulatorului), M01-NG1 | 01–04 | PASS_SIMULATED |
| 24 | Securitatea suprafețelor UI | Markdown, aprobări, canale, origini | M02-UI-02, M02-SEC-* | — | PASS_LOCAL |
| 25 | Performanță + accesibilitate | nucleu adaptiv, lazy load, boundaries | măsurători | M02_VISUAL_REVIEW | PASS_LOCAL (parțial: fps, sesiune lungă, screen reader NOT_RUN) |
| 27 | Plan de testare cu statusuri separate | `v2/tests/m02-*.test.mjs` | 28 teste M02 | M02_TEST_REPORT | vezi raport |
| 28 | Verificare vizuală reală | `.ifrim/M02_EVIDENCE/` (17 capturi) | — | M02_VISUAL_REVIEW | PASS_LOCAL |
| 29 | Plan live | `M02_LIVE_VALIDATION_PLAN.md`, preflight | — | — | LIVE_VALIDATION_PENDING |

## Noi dependențe

Niciuna. Playwright este propus, nu instalat.
