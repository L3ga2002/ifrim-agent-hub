# M09 · Status de implementare și matricea de acoperire

Data: 2026-10-04. Cod `2.10.0-m09`, contract API 9, migrația 9 `m09-media-growth` (27 de tabele noi și coloane noi pe `agent_runs`, `factory_missions`, `live_grants`). **Necomis** pe `v2-milestone-01` peste `ae3aa48`.

**Statusuri:**
- **PASS_LOCAL:** verificat cu unelte reale pe acest PC (ffmpeg, Chromium);
- **PASS_SIMULATED:** verificat cu provideri și fixture-uri;
- **PARȚIAL:** există, dar cu o simplificare explicită;
- **NEIMPLEMENTAT:** lipsește, cu motivul;
- **BLOCKED:** așteaptă o decizie sau un acces;
- **NOT_RUN:** nu a rulat.

## 1. Ce s-a construit, pe fișiere

**Fluxul A (corecturi de bază, `M09_CORE_FIXES.md`):**
- `policy/model-binding.mjs`, `policy/billing-evidence.mjs`, `domain/skill-composer.mjs`, `owner/voice-worker-lib.mjs`;
- modificări în fabrică, plicuri, granturi, gate, runs, providers, pachete, autopilot, Lega și UI (modele, facturare).

**Fluxul B (Content Studio)**, în `v2/server/media/`:

| Modul | Rol |
|---|---|
| `paths`, `tools`, `probe` | rădăcina media, ffmpeg/ffprobe fixate (versiune și sha256), argumente fixe, `-protocol_whitelist file,pipe` |
| `assets`, `rights` | biblioteca (originale imuabile, derivate, deduplicare, cotă), drepturi, revocare cu inventar |
| `ir`, `captions`, `visual-bible` | EditProjectIR v1 (cadre, fps rațional), validare, subtitrări RO (SRT/VTT/ASS), 5 preseturi versionate |
| `compile`, `render`, `editors` | compilatorul pur → ffmpeg, coada durabilă (cache pe segmente, anulare, recuperare), exporturi OTIO/EDL/pachet CapCut, explicarea montajului |
| `qa`, `variants`, `review` | QA tehnic/layout/editorial/factual/drepturi, variante native, corecturi la timecode → patch |
| `content`, `distribution`, `analytics`, `campaigns` | idei, proiecte, brief/script/storyboard/afirmații; manifeste, pachete manuale, reconciliere, programare; metrici, experimente, insights; campanii și legătura cu Sales |
| `capture`, `transcribe` | Public Demo Mode (Chromium), client OBS v5 (blocat de politică), transcriere locală whisper |
| `index`, `media-commands`, `media-routes` | integrarea: ~55 de comenzi `media.*`/`content.*`, rutele `/api/media/*` și `/api/content/*`, streaming cu Range, încărcare în flux |

**UI:**
- ecranele `screens/Studio.jsx` și `screens/studio/*`: Overview (Command Center), Board, Project cu 13 file, Library, Renders, Variants, Distribution, Analytics, Player, Timeline;
- `lib/studioLogic.js` și `styles/m09.css`;
- intențiile Lega: `studio_open`, `studio_show_clip`, `studio_edit`, refuzul `studio_publish`, `capture_off`;
- pachetele MEDIA_A/B/C în Pilot → Decizii.

**Skill-uri și roluri:** 6 skill-uri media noi și roluri media în `config/roles.json` (READ_ONLY).

**Unelte manuale:** `tests/manual/m09-clip-capture.mjs` și `tests/manual/m09-clip-produce.mjs` (primul clip).

## 2. Matricea: cele 40 de secțiuni ale promptului

| § | Cerință | Status | Unde / ce lipsește |
|---|---|---|---|
| 01 | Baseline și ordinea de citire | FĂCUT | Raportul M08 citit; Git verificat; Hub-ul live doar interogat (GET), nemodificat |
| 02 | Protejarea pilotului și a pachetelor | FĂCUT | ProDelivery, D6, Demo B și ciornele neatinse; pilotul nu apare în clip |
| 03 | A1 model = autorizat = trimis | PASS_SIMULATED | `model-binding`; MB-01..15, RF-04, RF-05 |
| 04 | A2 facturarea Claude din dovezi | PASS_SIMULATED | `billing-evidence`; BE-01..12, RF-01, RF-06. Live: declarația ta după trecere (plan §2) |
| 05 | A3 skill-uri în prompt + audio | PASS_SIMULATED | composer SK-01..12; audio MT/VS. `--inference-path` NOT_RUN pe binarul real |
| 06 | Autorizare și protecții | FĂCUT | Fără model, fără gate deschis, fără granturi, commit sau push; MEDIA_A/B/C în ordine |
| 07 | Obiectiv editorial fără „AI slop” | FĂCUT pentru clip | Material real (UI-ul Hub-ului), fără voce robotică, muzică nelicențiată sau avatar; etichete oneste |
| 08 | Departament și rutare | PARȚIAL | Roluri media + skill-uri; `CONTENT_ROLES` cu model explicit. Nu există rulări AI media: MB2 nedecis |
| 09 | Arhitectură și model de date | FĂCUT | Migrația 9 (27 de tabele); metadate în DB, fișiere pe disc; stările de producție separate de publicare |
| 10 | Afirmație → dovadă → secvență | PASS_LOCAL | Afirmații cu dovezi (run/test/document/commit); QA factual; `evidenceRegions`; etichete de captură |
| 11 | Brief, script, storyboard, două audiențe | PASS_LOCAL | Versionate; `angles {technical, business}`; readiness READY/NO_GO/NEEDS_CAPTURE |
| 12 | Capture Director și Public Demo Mode | PARȚIAL | Captura demo Chromium: PASS_LOCAL (clipul). Markeri: da. OBS: client PASS_SIMULATED, blocat de politică. **Buffer circular: NEIMPLEMENTAT** (opțional, oprit implicit). Mini-interviu: doar tipul de sesiune `interview`; înregistrarea cere MEDIA_B |
| 13 | Biblioteca media și stocarea | PASS_LOCAL | În hub-data; nume din hash; derivate; deduplicare; cotă; căutare pe transcriere/markeri/metadate. Fără embeddings (intenționat) |
| 14 | Drepturi și protecția clientului | PASS_SIMULATED | Origine ≠ drept; UNKNOWN blocat; revocare propagată, cu reverificare imediată (RF-07); acord de marketing pentru CLIENT_PROVIDED |
| 15 | IFRIM Visual Bible | FĂCUT | 5 preseturi versionate cu fonturi și licențe; proiectul fixează versiunea. Exemplele acceptate/respinse sunt text, nu clipuri |
| 16 | EditProjectIR | PASS_LOCAL | Cadre, fps rațional, keyframes, crop, viteză constantă, tranziții, text, subtitrări, audio; validare strictă; OTIO/EDL; `explainEdit` |
| 17 | Adaptoare editor | PARȚIAL | ffmpeg: real. CapCut: ASSISTED (pachet + pași). Premiere: detectare (NOT_INSTALLED). **Remotion, Blender, Computer Use: NEIMPLEMENTATE** (opționale; nu erau necesare primului clip) |
| 18 | Editor Agent și granularitate | PARȚIAL | Trim, crop/reframe, zoom/keyframes, tranziții, overlay-uri, subtitrări, audio (gain/fade/envelope), culoare. **Speed ramp: nesuportat, refuzat explicit.** **Curățarea zgomotului: NEIMPLEMENTATĂ.** Draft → final; divergența manuală se înregistrează |
| 19 | Voce, sunet, subtitrări | PARȚIAL | Transcriere locală separată de comenzi; SRT/VTT/ASS; diacritice. **TTS: NEIMPLEMENTAT** (intenționat). Clipul nu are voce |
| 20 | Generare imagine/video/audio | NEIMPLEMENTAT | Nicio rută inclusă și accesibilă; nimic plătit. Cardul final al clipului e o grafică ffmpeg proprie, etichetată |
| 21 | Randare, checkpoint, resurse | PASS_LOCAL | Cache pe segmente, cu cheie din intrări; anulare/crash/disc plin; promovare doar după validare; prioritate pentru lucrul interactiv; verificarea amprentei IR (R24) |
| 22 | QA tehnic, editorial, factual, drepturi | PASS_LOCAL | 5 verificări; justificare pe cadru; QA legat de fișierul exact (R19). Fără garanție de viralitate sau juridică |
| 23 | Review la timecode și Lega | PASS_SIMULATED | Patch inspectabil; before/after; corectura pe variantă mută varianta (R20); Lega: `studio_edit`. Vocea rămâne neverificată (filtru oprit) |
| 24 | Variante native și aprobarea finală | PASS_LOCAL | 8 profiluri (estimări); clipul are 3 variante reale. Aprobarea manifestului doar cu Hello |
| 25 | Adaptoare sociale | PARȚIAL | Registru pe operație; fixture adapter; pachet manual pentru toate. **Niciun conector live** (MEDIA_C) |
| 26 | Scheduler fără duplicate | PASS_SIMULATED | Idempotency; OUTCOME_UNKNOWN reconciliat; MISSED_NEEDS_DECISION; DST; fără backlog la repornire |
| 27 | Metrici neinventate | PASS_SIMULATED | Registru de definiții; lipsă ≠ 0; import manual. ANALYTICS_CONNECTED: NU |
| 28 | Learning Engine, experimente | PASS_SIMULATED | Experimente preînregistrate; INCONCLUSIVE sub eșantion; insights cu reguli; diagnostic pe scene = ipoteze |
| 29 | Campanii și Sales | PASS_SIMULATED | Legătura prin `sales.getOpportunity`/`addEvidence`; atribuire UNATTRIBUTED implicit; fără DM sau outreach |
| 30 | Cele 12 îmbunătățiri | vezi §3 | — |
| 31 | Content Studio și Command Center | PASS_LOCAL (browser) | Board cu stări reale; Project cu 13 file; progres doar măsurabil; testul STU-browser. Timeline: inspector, nu Premiere |
| 32 | Backend, API, recuperare | PARȚIAL | Coada de randare: claim atomic, idempotency, anulare, recuperare → INTERRUPTED (nu se reia singură). **Lease/heartbeat pe job: simplificat** (un singur worker în proces, cu timeout) |
| 33 | Medii, securitate | FĂCUT | Media tratată ca neîncrezătoare (protocoale restrânse, limite); fără tokenuri sociale; captura Hub-ului live refuzată (inclusiv portul 3011, R8) |
| 34 | Primul clip | LOCAL_PRODUCTION_VERIFIED | Vezi `M09_REPORT.md` §2 |
| 35 | Fazele A–E | A–C local; D–E simulat | Distribuția și analytics fără conturi reale |
| 36 | Teste T01–T17 | vezi `M09_TEST_REPORT.md` | — |
| 37 | Niveluri | vezi `M09_REPORT.md` §5 | — |
| 38 | Documentație, migrare, Git | FĂCUT local | Documentele M09; dry-run pe copie de rulat de tine; nimic comis |
| 39 | Ritm și decizii | FĂCUT | Pachete grupate MEDIA_A/B/C; nicio aprobare duplicată |
| 40 | Surse | Notat | Statusurile din registru citează documentația publică; nimic verificat live |

## 3. Cele 12 îmbunătățiri

| # | Îmbunătățire | Status | Unde |
|---|---|---|---|
| 1 | Afirmație → dovadă → cadru/timecode | PASS_LOCAL | `content.saveClaim`, `clip.claimIds`, `evidenceRegions`, QA factual; clipul are 6 afirmații cu dovezi |
| 2 | Capture Director cu markeri; buffer doar autorizat | PARȚIAL | Markeri: da (capitol/dovadă în clip). Buffer: NEIMPLEMENTAT (oprit implicit oricum) |
| 3 | Public Demo Mode, sanitizare înainte de captură | PASS_LOCAL | CSS de redactare injectat înainte de primul cadru; date sintetice; portul live refuzat |
| 4 | Mini-interviu cu proprietarul | BLOCKED | Tipul de sesiune există; înregistrarea cere MEDIA_B și microfonul tău, niciodată sinteză din profilul vocal |
| 5 | Două unghiuri din aceeași dovadă | PARȚIAL | `brief.angles {technical, business}`; clipul livrat are unghiul business |
| 6 | Corecturi în limbaj natural la timecode | PASS_LOCAL | Proba de editare a clipului; QA-09..14, QA-16 |
| 7 | Propagarea drepturilor | PASS_SIMULATED | `revocationImpact`, reverificarea manifestelor (RF-07), DS-05 |
| 8 | Diagnostic pe scene cu limite | PASS_SIMULATED | `analytics.sceneDiagnostics`: ipoteze, fără date reale |
| 9 | Content → oportunitate Sales | PASS_SIMULATED | `campaigns.linkOpportunity`; venit doar manual, cu atribuire explicită |
| 10 | NO_GO / NEEDS_CAPTURE | PASS_SIMULATED | `content.evaluateReadiness`, cu sarcini concrete de captură |
| 11 | Reconcilierea rezultatului incert | PASS_SIMULATED | DS-09/10 |
| 12 | Priorități CPU/GPU, Lega protejată | PASS_SIMULATED | `interactivePriority` amână randările cât rulează un model sau vocea; GPU partajat la transcriere |

## 4. Simplificări materiale (explicite)

1. **Buffer circular de captură:** neimplementat.
2. **Generare AI** (imagine/video/audio) și **TTS:** neimplementate.
3. **Remotion, Blender, Computer Use, Premiere UXP:** neimplementate. Premiere doar detectat.
4. **Speed ramps și curățarea zgomotului:** nesuportate.
5. **Niciun conector social live:** doar pachete manuale.
6. **Aprobarea scopului unei sesiuni de captură live** nu are încă un ecran care s-o scrie, deci chiar cu MB1 captura live rămâne refuzată.
7. **Folderele de import:** doar ruta API, fără formular. Implicit e permis `%USERPROFILE%\Videos`.
8. **Coada de randare:** worker în proces, fără heartbeat separat.
9. **Rulările AI media** (Creative Director, Scriptwriter): nicio rulare; brief-ul, scriptul și storyboardul clipului sunt scrise de sesiunea de dezvoltare și etichetate `dev_session`.
