# M08 · Stadiul implementării

Cod `2.9.0-m08`, contract API 8, migrația 8 „m08-intel”. Comis pe `v2-milestone-01` peste `17921ac` (vezi `git log`).

## 1. Server — module noi (`v2/server/intel/`)

| Fișier | Rol |
|---|---|
| `twin.mjs` | Digital Twin: `graph`, `blocked`, `changesSince`, `impact`, `why`, revendicări (`twin_claims`) cu tip OBSERVED/DECLARED/HYPOTHESIS și sursă; contradicții pe predicate funcționale; `versionRef` (citește `.git/HEAD`). |
| `warroom.mjs` | Incidente: PROPOSED → TRIAGE → REPRODUCING → REMEDIATION → MONITORING → RESOLVED / DISMISSED; intrări (semnal, ipoteză, acțiune, dovadă, notă); conținutul unui model = ipoteză neconfirmată; impact confirmat separat; RESOLVED cere dovadă confirmată; remediere = ciornă BUGFIX; „pauză” doar propusă. |
| `autopilot.mjs` | Obiective (`autopilot_objectives`): validare (chei, cicluri Kahn, dependențe orfane, buget 5 sarcini / 300 min), `draft` → `prepare` (misiuni-ciornă în ordinea dependențelor) → `propose` (un plan peste sarcini) → stare derivată; `amend` = versiune nouă. |
| `board.mjs` | Ședința: agendă deterministă pe 5 secțiuni, deschidere cu instantaneu, deplasare, decizii (decid/resping cu sesiunea ta), amânare reportată, minută la închidere, `today()` pentru „Ce avem azi?”. |
| `simulation.mjs` | `simulateCapacity` (model `capacity-1`, determinist, intervale optimist/pesimist, verdict, formulă, presupuneri); scenarii salvate; „propunere” = ciornă de decizie separată. |
| `league.mjs` | Observații din `agent_runs` × fabrică; grupare, dovezi suficiente ≥ 5, excluderi numărate, propuneri pe cohorte comparabile (niciodată aplicate). |
| `skill-evolution.mjs` | Candidați de skill: propunere cu dovezi, evaluare deterministă, aprobare (sesiunea ta), activare limitată sau generală, revenire, monitorizare; `overlayFor(projectId)`; `baseBody`. |
| `teach.mjs` | Lecții: parsare (declanșator + pași), proveniență doar de la proprietar, părțile de securitate separate, confirmare → `memory_items` USER_PREFERENCE cu scope, înlocuire pe același declanșator, „uită” exact cu istoric. |
| `devices.mjs` | Telefon: asociere (cod 6 cifre, 10 min, 5 încercări, `timingSafeEqual`, doar hash-ul tokenului salvat), autentificare, revocare, stare compactă, comenzi idempotente (`device_commands`), refuz pe imagine veche (> 2 min). |
| `pilot-acceptance.mjs` | Testul de acceptanță independent al pilotului B4 (Python, verifică livrabilul: suita există, trece, ≥ 12 teste, apelează efectiv fiecare funcție publică, urmărit la rulare) și misiunea pilotului (FEATURE) pentru `factory.prepare`. |
| `packages.mjs` | Pachete de decizie A/B: inventar real (dimensiuni, sincronizare OneDrive, ACL-ul profilului vocal citit cu `icacls`), opțiuni cu execuție/revenire/limite, stare derivată din realitate, B blocat până la A, decizie cu sesiune proaspătă. |
| `intel-commands.mjs` | Comenzile M08 pe magistrală, cu canale: OWNER (`owner`,`test`), OWNER_UI (+`ui`), ANY (+`voice`,`companion`). Nimic delegabil canalului `agent`. |
| `intel-routes.mjs` | Rutele HTTP M08; canalul `owner` din cookie-ul de sesiune, `ui` altfel; refuză `X-Hub-Channel: agent|cli`; cookie-ul separat al telefonului. |

## 2. Server — fișiere modificate

- `config.mjs`: `HUB_VERSION 2.9.0-m08`, `API_CONTRACT 8`; `resolveDataLocation` (override → `HUB_V2_DATA_DIR` → pointerul `.ifrim/data-location.json` → implicit); `MOVED_MARKER = V2_MOVED.json`; `isV2DataEntry`; `webDist` (`HUB_V2_WEB_DIST`).
- `storage/migrations.mjs`: migrația 8 (13 tabele).
- `hub.mjs`: creează serviciile M08, overlay-ul de skill-uri, comenzile extra ale fabricii (setare + listener), abonarea `voice.gate_final` → `envelopes.confirmFromArmed`.
- `owner/envelopes.mjs`: planuri peste un obiectiv (`objectiveRefFor`, din baza de date, la propunere și la confirmare); continuarea fără confirmare doar HIGH sau obiectiv la TRUSTED; fereastra armată (`armConfirmation`, `armedFor`, `confirmFromArmed`, 90 s, folosire unică la succes, închidere după 3 eșecuri).
- `owner/voice.mjs`: emite `voice.gate_final` când transcrierea locală a unei fraze din poartă e finală și fraza poartă un plan.
- `owner/intents.mjs`: intențiile M08 (incident, twin_changes/impact/why, board_open/next/defer, simulate cu numere în română, league, teach, forget, today, decisions, fullscreen, cockpit_view, details, objectives, objective_plan, start_view).
- `owner/owner-commands.mjs`: tratarea intențiilor M08 în `owner.intent`; armarea după ce un plan e arătat într-o sesiune Lega (`legaSessionId`); `why_blocked` primește lanțul din Digital Twin.
- `domain/settings.mjs`: `startView`, `factoryExtraCommands`, `simulationDefaults`.
- `domain/skills.mjs`, `runtime/runs.mjs`: overlay pe proiect pentru skill-urile candidate.
- `runtime/prompt.mjs`: `activeLessons` — lecțiile confirmate intră în prompt, sub regulile Hub-ului.
- `factory/spec.mjs`: `EXTRA_COMMAND_PATTERNS` (`python-unittest`), `setExtraCommands`; implicit nimic în plus.
- `environments/wsl-factory-runner.mjs`: argv pentru `python3 -m unittest`.
- `factory/runner.mjs`: citește rezultatul `unittest` (inclusiv de pe stderr; sumarul TAP are prioritate); refuz explicit pe Windows pentru o comandă fără echivalent.
- `factory/integrity.mjs`: oprește misiunea dacă writer-ul creează un modul Python cu nume de bibliotecă standard (`stdlib_shadowed`).
- `environments/environment-commands.mjs`: canalul `owner` (sesiunea ta autentificată) e acceptat de comenzile de mediu; `runtime/command-catalog.mjs`: `factory.prepare` acceptă canalul `owner`.
- `http/server.mjs`: căi fail-safe noi (`/api/m/command`, `/api/m/forget`, revenirea unui skill, revocarea unui dispozitiv).

## 3. Scripturi

- `v2/scripts/relocate-data.mjs` (nou): `--plan`, `--dry-run --to`, `--apply --to`, `--rollback [--copy-back|--discard-new]`.
- `v2/scripts/voice-acl.ps1` (nou): `-Plan`, `-Apply`, `-Verify`, `-Rollback`.
- `v2/scripts/common.mjs`: start/stop/status urmează pointerul de locație.
- `v2/scripts/migration-dry-run.mjs`: raportează tabelele M08.
- `v2/scripts/start-detached.ps1`: mesajul de eroare nu mai presupune `.ifrim/private`.

## 4. UI (`v2/web/src/`)

- **Ecrane noi:** `screens/Intel.jsx` + `screens/intel/{common,Company,Engineering,Owner}.jsx` — ecranul „Pilot automat” cu 11 tab-uri (Azi, Digital Twin, War Room, Autopilot, Ședința, Simulare, Liga agenților, Skilluri, Lecții, Decizii, Telefon).
- **Ecranul de telefon:** `screens/Mobile.jsx` (`#/m`, randat fără shell-ul desktop).
- **Card în cockpit:** `screens/lega/IntelCard.jsx` (răspunsul M08 ca un card).
- **Logică și stiluri:** `lib/intelLogic.js`, `styles/m08.css`.
- **Modificări:**
  - `main.jsx`: rutele `intel` și `m`, ecranul de pornire;
  - `nav.js`: „Pilot”;
  - `api.js`: căile fail-safe, aceleași ca pe server;
  - `screens/Lega.jsx`: butonul „Ecran complet”, preferința „La pornire”, „Pilot”, cardul M08, `legaSessionId`, frazele vocale noi;
  - `screens/lega/cards.jsx`: „Detalii” și fereastra armată pe DecisionCard;
  - `shell/Lega.jsx`: ID-ul sesiunii Lega în store; pentru un plan armat, confirmă serverul și pagina doar raportează;
  - `lib/voiceContext.js`, `lib/cockpitLogic.js`.

## 5. Teste

- **Noi:**
  - `m08-autopilot`, `m08-company`, `m08-lega`, `m08-mobile-packages`, `m08-adversarial`, `m08-ui-logic`, `m08-relocation`;
  - `manual/m08-screens.mjs` (capturi);
  - patch-ul fixture `factory-patches/objective-t2.json`.
- **Modificate:** `helpers.mjs` (`WEB_DIST`), `m04-browser`, `m06-ui-e2e` (urmează `HUB_V2_WEB_DIST`).

## 6. Ce s-a reparat pe parcurs

Vezi `M08_REPORT.md` §4: plan de obiectiv refuzat la confirmare; obiectiv blocat după un plan expirat; fereastra vocală consumată de o frază refuzată; setări lipsă; căi salvate rămase în OneDrive la mutare; V1 în `.ifrim/private`; moștenirea ACL `CodexSandboxUsers` în `~/IfrimHub`; revenirea ACL fără privilegii; eveniment, focus și diacritice.

## 7. Ce rămâne

- Trecerea Hub-ului live pe M08 (pașii din `M08_REPORT.md` §6).
- Pachetul A (decizie + execuție de către tine), apoi pachetul B.
- Verificarea vocii live (VOICE_UX_VERIFIED) după trecere.
- Telefonul real (CROSS_DEVICE): blocat până la o conexiune autorizată separat.
