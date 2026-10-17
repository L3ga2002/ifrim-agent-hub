# M09 · Content / Media / Growth — raport

Data: 2026-10-04. Cod `2.10.0-m09`, contract API 9, migrația 9 `m09-media-growth`. Codul și documentele sunt **necomise** pe `v2-milestone-01` peste `ae3aa48`.

**Hub-ul live rulează M09 din 2026-10-04, 07:23 UTC** (trecere făcută de Claude la cererea ta, fără model): BUILD_SAFE, 0 granturi, Claude blocat până la declarația nouă. Detaliile și backup-ul de revenire sunt în `M09_LIVE_VALIDATION_PLAN.md` §0.

**Detalii:**
- `M09_IMPLEMENTATION_STATUS.md`: matricea celor 40 de secțiuni și a celor 12 îmbunătățiri, plus simplificările spuse explicit;
- `M09_CORE_FIXES.md`: modelul exact (A1), dovada de facturare Claude (A2), skill-urile în prompt (A3), audio;
- `M09_MEDIA_RIGHTS_AND_PLATFORMS.md`: biblioteca, drepturile, variantele, platformele, metricile;
- `M09_TEST_REPORT.md`: suitele, review-ul adversarial, T01–T17;
- `M09_LIVE_VALIDATION_PLAN.md`: trecerea pe M09, re-declararea facturării și pachetele MEDIA_A/B/C;
- `M09_ARCHITECTURE.md`: contractul tehnic.

## 1. Experiența: ce poți face

Hub-ul live e pe M09, deci toate acestea sunt disponibile acum la `http://localhost:8011`. Au fost verificate pe Hub-uri de test; pe Hub-ul live nu am rulat nicio comandă media.

**Ce îi spui lui Lega:**
- **„Deschide studio-ul”**, spus în cockpit-ul Lega (Zero-Menu), deschide Content Studio (`#/studio`). Studio-ul are și o intrare proprie în meniul principal.
- **„Arată-mi clipul”** (sau „arată-mi clipul cu planul”) deschide proiectul. Dacă sunt mai multe, te întreabă care.
- **„La secunda 12 mută textul mai sus și ține demonstrația mai mult”** creează o **propunere** de corectură pe versiunea curentă:
  - se vede patch-ul (mută textul, prelungește cadrul cu 1,5 s) și impactul asupra duratei;
  - nu se aplică nimic. O aplici tu în Studio: rezultă o versiune nouă, iar originalul rămâne;
  - fără un moment spus, Lega întreabă „la ce secundă?” și nu ghicește.
- **„Publică clipul”** e refuzat explicit. Publicarea e pachetul MEDIA_C, iar fiecare încărcare cere confirmarea manifestului exact. Până atunci, Studio-ul pregătește pachete manuale.
- **„Oprește captura”** e fail-safe și oprește imediat politica de captură live.

**Ce clip există:** „Un plan. O singură confirmare.”, în `C:\Users\mihai\Videos\Ifrim Studio\M09 - Un plan, o confirmare\`. Citește întâi `CITESTE-MA.md`.

| Fișier | Pentru | Format |
|---|---|---|
| `01_master_16x9_youtube.mp4` | YouTube / X | 1920×1080, 30 fps, 25,6 s |
| `02_reels_9x16.mp4` | Instagram Reels | 1080×1920, 25,6 s |
| `03_linkedin_4x5.mp4` | LinkedIn | 1080×1350, 25,6 s |
| `04_x_1x1.mp4` | X | 1080×1080, 25,6 s |
| `05_master_dupa_corectura.mp4` | proba de editare | 1920×1080, 27,1 s |

Mai sunt acolo: coperțile, textul de pe ecran ca SRT, planul de montaj (EditProjectIR v1 și v2), OTIO, EDL, pachetul CapCut, montajul explicat, raportul QA și de producție, plus capturi before/after.

**Despre filmare:** e UI-ul real al Hub-ului, filmat de Public Demo Mode pe un **Hub de test cu date sintetice și provideri simulați**, etichetat pe ecran „SIMULARE · Hub de test cu date sintetice”. Nu a rulat niciun model. Timpul comprimat e marcat („Accelerat ×1,5”, „×4”). Clipul nu are voce și nici muzică (nu există o voce autorizată sau o piesă licențiată); povestea o poartă textul. Pilotul ProDelivery nu apare.

**Cum îl modifici:**
1. Spui o instrucțiune la timecode: lui Lega, mie, sau în Studio → proiect → Review.
2. Hub-ul creează o propunere cu patch și previzualizare.
3. „Aplică” creează o versiune nouă.
4. Randarea refolosește segmentele neschimbate (la proba de editare: 7,7 s în loc de 21,9 s).
5. QA rulează din nou.

O corectură pe o variantă mută varianta pe versiunea corectată. Modificările făcute în CapCut se înregistrează ca divergență manuală.

**Ce poți programa și publica, pe ce cale:**
- **Azi, doar pachete manuale.** Pașii:
  1. Construiești un manifest: variantele, conturile, textul, coperta, programul (Europe/Bucharest).
  2. Îl aprobi cu Windows Hello.
  3. Hub-ul pregătește pachetul: video, text, copertă, `checklist.md`, hash-uri.
  4. Postezi tu.
  5. Hub-ul înregistrează URL-ul validat.
- **Nimic nu se publică automat.** O programare scadentă devine „necesită decizie”, nu o postare. API-urile platformelor nu sunt conectate (§7).

## 2. Primul clip: dovezi

| Cerință (§34) | Rezultat | Status |
|---|---|---|
| 25–45 s despre o funcție confirmată, UI sanitizat | 25,6 s: cerere → plan exact (inclusiv modelele) → o confirmare → execuție în limite → gata pentru verificare. Date sintetice, etichetă SIMULARE | PASS_LOCAL |
| Master redabil | H.264, yuv420p, 1920×1080, 30 fps, faststart, verificat cu ffprobe | PASS_LOCAL |
| EditProjectIR | `plan-de-montaj_v1.json` (9 clipuri, 5 piste de text, regenerabil) | PASS_LOCAL |
| Manifest de materiale și drepturi | Captura și cardul final: OWNED, CLEARED_FOR_SCOPE pentru uz organic. Fonturi de sistem / OFL | PASS_LOCAL |
| Script și storyboard | Versionate în proiect, cu două unghiuri. Scrise de sesiunea de dezvoltare și etichetate `dev_session` (nu de un model din Hub) | FĂCUT |
| Afirmații cu dovezi | 6 afirmații SUPPORTED: teste ale Hub-ului, cod, momentul din captură | PASS_LOCAL |
| Captions | Textul de pe ecran ca SRT. Nu există audio vorbit de subtitrat | PASS_LOCAL |
| Copertă | 16:9 și 9:16 | FĂCUT |
| Raport QA | Masterul și cele 3 variante: PASS pe tehnic, layout, editorial, factual și drepturi. Avertismentele rămase sunt justificate pe cadru (liniște, așteptarea UI-ului, cardul final) | PASS_LOCAL |
| ≥ 3 variante native, nu copii | Reels 9:16, LinkedIn 4:5, X 1:1, fiecare cu încadrarea, hook-ul și zona sigură proprii (20–32 de schimbări fiecare) | PASS_LOCAL |
| Test de editare | Corectura la timecode: mută textul și prelungește cu 1,5 s. Patch inspectabil, versiune nouă, originalul neschimbat, before/after, randare din cache (8/9 segmente) | PASS_LOCAL |
| Test de recuperare | O randare oprită la mijloc ajunge CANCELLED; reîncercarea ajunge DONE; materialul brut rămâne READY; nimic publicat | PASS_LOCAL |
| Acceptarea creativă | Nu am fabricat OWNER_ACCEPTED. Manifestul e DRAFT | **în așteptarea ta** |

**Refacere pe codul final (2026-10-04, dimineața).** După corecturile din review, clipul a fost produs din nou cap-coadă. Masterul a ieșit cu aceeași dimensiune la byte.

Producția reală a scos la iveală un defect pe care testele nu îl prinseseră: în vertical, zoom-ul masterului tăia notificările-dovadă. Cauza și repararea sunt descrise în `M09_TEST_REPORT.md` §3, cu testul QA-18.

Am văzut cu ochii mei două puncte editoriale, notate în `CITESTE-MA.md`: textul mic de pe la 21 s din LinkedIn 4:5 se citește greu, iar câteva texte de pași stau peste UI în vertical. QA-ul automat nu verifică contrastul pe fundal aglomerat.

## 3. Ce s-a construit, pe scurt

**Fluxul A, corecturile de bază:**
- modelul și efortul exact, fixate de la propunere până la proces, verificate înainte de inferență și la raportul providerului;
- facturarea Claude din dovezi cu cont și expirare: **după trecere, Claude e blocat până declari din nou**;
- skill-urile aprobate ajung efectiv în prompt și sunt înregistrate pe rulare;
- whisper-server e restrâns verificabil, iar transcrierea media e separată de comenzi.

**Fluxul B, Content Studio** (`v2/server/media/`, ~11.800 de linii, 24 de fișiere):
- biblioteca imuabilă cu drepturi și revocare propagată;
- EditProjectIR și randarea locală ffmpeg, cu cache și recuperare;
- QA în 5 verificări, variante native, corecturi la timecode;
- manifeste și pachete manuale, reconciliere și programare fără backlog;
- metrici fără zerouri inventate, experimente preînregistrate, campanii legate de Sales;
- Public Demo Mode și OBS (blocat de politică), transcriere locală.

**UI:** Command Center, Board, proiectul cu 13 file, bibliotecă, randări, variante, distribuție, analytics, player, timeline (inspector).

**Decizii:** pachetele MEDIA_A/B/C în Pilot → Decizii.

## 4. Teste

| Suită | Rezultat |
|---|---|
| V2 completă, prima rulare (2026-10-04) | 858 · 856 PASS · 1 FAIL (AS-09: un cod de eroare, reparat) · 1 SKIP (T25 symlink) |
| Fișierele M09, după ultima modificare de cod | **209 · 209 PASS · 0 SKIP** (ffmpeg și Chromium reale) |
| V2 completă, rularea finală pe codul final | **859 · 858 PASS · 0 FAIL · 1 SKIP** (T25 symlink; 29 min 48 s) |
| V1 | 552 · 551 PASS · 1 SKIP (ca baseline-ul) |

Baseline M08: V2 650 · 649 PASS · 1 SKIP. M09 adaugă 209 teste.

**Review-ul adversarial (39 de constatări):**
- toate cele 19 confirmate sunt reparate;
- încă 8 neverificate sunt reparate;
- 11 minore sunt documentate (OPEN_ISSUES M09 §12);
- 1 a fost respinsă.

Testele de regresie au prins ele însele două corecturi greșite: R6 nu rula niciodată, iar R5 accepta un „acum” implicit.

## 5. Niveluri de livrare (§37)

| Nivel | Stare |
|---|---|
| BUILD_READY | **DA:** cod, migrație, UI, teste; rulează live din 2026-10-04, 07:23 UTC |
| LOCAL_PRODUCTION_VERIFIED | **DA:** clip real, timeline, editare și recuperare demonstrate pe acest PC |
| CREATIVE_OWNER_ACCEPTED | **NU:** așteaptă vizionarea și decizia ta |
| PLATFORM_PACKS_READY | **NU:** pachetele se pot construi (DS-06, PASS_SIMULATED), dar niciun manifest al clipului nu e aprobat |
| LIVE_PLATFORM_VERIFIED | **NU:** niciun cont conectat |
| ANALYTICS_CONNECTED | **NU:** nicio sursă reală |
| LEARNING_EVIDENCE_AVAILABLE | **NU:** nicio publicare măsurată |
| AUTO_PUBLISH_ENABLED | **NU** (nu e un obiectiv M09) |

## 6. Costuri și necunoscute

**Costuri:**
- **0 inferențe și 0 servicii plătite** în tot M09;
- ffmpeg era deja instalat, fonturile sunt de sistem sau OFL;
- clipul a consumat doar CPU local (randarea finală: aproximativ 58 s).

**Necunoscute:**
- **Creditele Claude:** Hub-ul nu le poate verifica automat și nu încearcă. Declarația ta spune ce e setat, nu ce credite există deja în cont.
- **Regulile platformelor:** profilurile de variante (zone sigure, durate) sunt estimări interne, marcate așa. Statusurile API se bazează pe documentația publică (S10–S17), neverificate pe conturile tale.
- **whisper-server:** portul rămâne apelabil local cât serverul rulează. Calea aleatoare pentru `/inference` nu a fost verificată pe binarul real.

## 7. Drepturi și integrări blocate

**Drepturi:**
- clipul folosește doar material propriu: UI-ul Hub-ului filmat de Hub și o grafică generată local cu ffmpeg;
- nu are muzică, voce, stock sau generare AI;
- QA-ul de drepturi nu e o garanție juridică.

**Integrări blocate:**

| Integrare | De ce e blocată |
|---|---|
| Instagram | NEEDS_AUTH (cont profesional, aplicație Meta aprobată) |
| TikTok | POLICY_UNSUPPORTED pentru Direct Post fără audit |
| YouTube | documentat, neconectat (proiectele neverificate încarcă privat) |
| X | COST_BLOCKED |
| LinkedIn | NEEDS_REVIEW |
| OBS și captura Hub-ului live | politică + aprobarea scopului sesiunii, care nu are încă ecran (OPEN_ISSUES M09 §6) |
| Premiere | neinstalat |
| CapCut | doar ASSISTED |

## 8. Deciziile tale (în ordine)

1. **Vizionează clipul** și spune ce schimb (timecode-uri).
2. ~~Trecerea Hub-ului pe M09~~: **făcută** pe 2026-10-04, la 07:23 UTC.
3. **Declară din nou facturarea Claude** în sesiunea ta (plan §2). Până atunci, Claude rămâne blocat.
4. **Aprobarea creativă** în Studio (Windows Hello). Proiectul de montaj trebuie întâi refăcut pe Hub-ul live din `surse/` și din planul v1; ajutorul de import care remapează id-urile lipsește încă (OPEN_ISSUES M09 §5).
5. **MEDIA_A** (ffmpeg fixat, OBS dacă îl vrei), apoi eventual **MEDIA_B** (captură live, buget AI de maximum 4 rulări Claude `sonnet · medium`), apoi **MEDIA_C** pe platformă. Fiecare e o decizie separată.
6. **Commit și push pentru M09:** cer aprobarea ta exactă. Nu se stage-uiesc `.ifrim/data-location.json`, hub-data, media brută, profile vocale, backupuri sau ProDelivery. `M08_SESSION_REPORT.md` e încă necomis și rămâne păstrat.

## 9. Ce nu am atins

- Pilotul ProDelivery `bnd_musqo7xj_1a204a2e55`, decizia F-001 și fișierele ProDelivery.
- D6 `bnd_murl82o1_00afe726c3`, Demo B `bnd_mupwze7b_e03f70f2d7` și ciornele.
- V1, OpenClaw, taskurile globale, copiile A3, profilurile WSL, binarele din ifrim-runner.
- `main` și originea.
- Pe Hub-ul live am făcut doar trecerea pe M09: oprire, backup, build, pornire și verificări prin citire. Nu am pornit niciun model, n-am creat granturi, n-am schimbat setări și n-am rulat comenzi media.
