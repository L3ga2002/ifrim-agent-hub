# M10 — Raportul de teste

Data: 2026-10-04 · cod `2.11.0-m10` · fără model, fără Hub live, fără acțiuni GUI pe desktopul proprietarului.

## 1. Testele noi M10 (53)

| Fișier | Teste | Ce acoperă |
|---|---|---|
| `m10-upgrade.test.mjs` (UP) | 8 | backupul obligatoriu înainte de migrare (`VACUUM INTO` + integritate + manifest care nu se suprascrie), refuzul fără backup (`PRE_MIGRATION_BACKUP_FAILED`, baza neatinsă), migrarea defectă cu rollback, dry run pe copie 9 → 10, starea runner-ului (reluare de la pasul eșuat), boot-ul pe o bază schema 9 |
| `m10-desktop.test.mjs` (DO) | 15 | D1 (deschide/prim-plan, sesiune închisă, fără model), canale (ui/voce/agent refuzate), aplicație neautorizată → card cu decizia → autorizare + deschidere, ținte protejate și fereastra Hub-ului, butoane sensibile (politică + helper), D2 Notepad complet (precondiție → tastare diacritice → verificare → Save As → disc → mutare + reidentificare; textul nu apare în niciun jurnal), fără suprascriere, inputul utilizatorului → suspendare + „Continuă”, identitate schimbată, desktop securizat, helper mort/blocat → UNCERTAIN, Stop / Preiau eu / Stop All, D6 CapCut prin plan, D8 Studio fără model + folderul exporturilor, D9 fără endpoint universal (fără click/type/eval/script, fără canal agent/cli, fără autoritate → refuz), recuperarea la boot, binar schimbat → autorizare retrasă, semnătură neîncredere → neautorizabil |
| `m10-operator-real.test.mjs` (OR) | 3 | **helperul C# real**: build din sursă (UTF-8), manifestul leagă binarul de sursă, un binar străin e refuzat; protocol real (hello și răspunsuri semnate, BAD_MAC, REPLAY, STALE, NO_AUTHORITY, AUTHORITY_EXPIRED, PAUSED cu text românesc intact); tablouri JSON citite corect (candidați, `knownPaths`, `processNames`), scop fail-closed (`OUT_OF_SCOPE` fără listă de aplicații) |
| `m10-ops-plans.test.mjs` (OP) | 13 | cardul (aplicații, foldere, date, operații, limite, „niciodată”, o confirmare, nimic pornit, niciun grant), confirmarea (doar sesiunea, nonce + hash exacte, referințe între pași, a doua confirmare refuzată), plan înlocuit / schimbat după afișare, folder nou = decizie cu reautentificare, autoritate la fiecare operație (operație nedeclarată, termen, sesiune închisă, buget), pauză/anulare fail-safe, reluare doar în aceeași sesiune, reconcilierea pașilor incerți, boot fără reluare, „Da” prin Lega (doar pentru cardul afișat; citat / voce provider refuzate), confirmare vocală (vocea + transcrierea locală pentru ACEST plan), secrete tranzitorii (parola OBS nicăieri stocată), Stop All / Pauză, rute HTTP + fail-safe |
| `m10-studio.test.mjs` (ST) | 13 | D3 pachet (export → previzualizare → import; id-uri remapate, etichete păstrate, aprobări neimportate, idempotent, fișier modificat → problemă), reconstruire din livrare veche, foldere de import (o dată consumat, permanent cu reautentificare, refuzuri: disc, date Hub, UNC, folder schimbat), ținta corecturii (selecție, etichetă niciodată ghicită, selecție învechită), lizibilitate în variante (mărime minimă + plăcuță), QA de lizibilitate pe cadru real (fundal agitat fără plăcuță semnalat), export local fără suprascriere, „Importă din folderul acesta” prin desktop + un card (acces o dată consumat), corectura ca plan (aplicare + randare + QA; originalul neschimbat), aprobarea scopului capturii, D5 + D7 cu OBS simulat (înregistrare → import → montaj → randare → variantă verticală + QA; parola niciodată stocată; fără MB1 nu există plan), configurarea OBS (doar local, reautentificare, fără parolă), plăcuța opacă prin construcție (filtrul ffmpeg) |
| `m10-ui-e2e.test.mjs` | 1 | browser real (Chromium headless, autentificator virtual): „Deschide CapCut” → card cu decizia → un click → autorizat + deschis; „Adu CapCut în față” direct; pagina Operator fără erori de consolă și fără scroll orizontal la 360 px |

Rezultat: **53/53 PASS**.

## 2. Defecte reale găsite în M10 (toate reparate, fiecare cu test)

1. **Helperul C# citea tablourile JSON doar ca `ArrayList`.** `DeserializeObject` produce `object[]`, așa că:
   - descoperirea reală întorcea zero aplicații;
   - `listWindows` și `waitWindow` nu găseau niciodată ferestre;
   - **verificarea scopului `auth.apps` era sărită (fail-open)**.

   Găsit la prima descoperire reală (`--discover` → `[]`). Reparat cu un singur cititor de tablouri și scop fail-closed. Test: M10-OR-03.
2. **Sursa C# fără BOM era compilată fără UTF-8**, deci textul românesc și regex-ul cu diacritice ar fi fost greșite. Reparat cu `/codepage:65001`. Test: M10-OR-02 (mesaj PAUSED intact).
3. **Politica: `\b` în JavaScript e ASCII.** „Postează”, „Șterge” scăpau de verificarea butoanelor sensibile. Reparat prin normalizarea diacriticelor. Test: M10-DO-05.
4. **Procesele protejate erau comparate cu „.exe”**, deși helperul raportează numele fără extensie. Test: M10-DO-04.
5. **Sesiunea desktop a unui plan rămânea ACTIVE după final.** Test: M10-DO-06.
6. **Folderele descrise de un pas erau tratate ca aprobate**, deci accesul nou nu cerea decizia cu reautentificare. Teste: M10-OP-04, M10-ST-08.
7. **Exportul pachetului refuza un folder care nu exista încă.** Teste: M10-ST-01, M10-ST-08.
8. **Plăcuța translucidă a stilului (0,75) lăsa textul UI să se vadă**: defectul văzut în M09 pe LinkedIn la ~21 s. Am văzut-o la randarea reală a clipului, după prima încercare M10. Reparat: plăcuța e întărită la ≥ 0,9 prin construcție. Test: M10-ST-13 + verificare vizuală.
   - O verificare QA bazată pe cadru („plăcuță prea transparentă”) a dat alarme false pe clipul real, din cauza marginilor anti-aliasate ale literelor. Am scos-o și am documentat de ce.

Și helperul, și fixture-ul refuză acum „Export to TikTok/YouTube/…”.

## 3. Verificări manuale (unelte, nu suită)

- **`tests/manual/m10-desktop-real.mjs --discover`** (helperul real, doar citire): Notepad 11.2607.14.0, Explorer, OBS 32.2.2, CapCut 9.3.0.3970 sunt toate DISCOVERED, cu semnături de încredere. Desktopul de intrare e „Default”, 2 monitoare, ecran virtual 5760×2160.
- **`tests/manual/m09-clip-produce.mjs`** (producția reală a clipului M09 cu codul M10): variantele randate din nou, cu plăcuțe opace și mărimi minime; pachetul `proiect-studio.json` exportat (2 surse refolosite din `surse/`, 8 versiuni).
- **`tests/manual/m10-bundle-check.mjs`**: pachetul real al clipului, importat într-un Hub de test:
  - previzualizarea: 2 surse cu hash OK, 8 versiuni, SIMULATION, 0 probleme, aprobările neimportate;
  - importul OK;
  - varianta LinkedIn randată din nou.

## 4. Regresii M01–M09

Vezi §5 (suita completă). Testele de browser M06 / M09 rulează pe UI-ul M10 construit separat (`.ifrim/tmp/m10-web-dist`), fiindcă Hub-ul live servește încă `v2/web/dist` (M09):

```bash
HUB_V2_WEB_DIST=.ifrim/tmp/m10-web-dist HUB_V2_STUDIO_DIST=.ifrim/tmp/m10-web-dist node --test --test-concurrency=1 v2/tests/*.test.mjs
```

## 5. Suita completă (2026-10-04, după toate reparațiile)

| Suită | Comandă | Rezultat |
|---|---|---|
| **V2** | `node --test --test-concurrency=1 v2/tests/*.test.mjs`, cu UI-ul M10 din `.ifrim/tmp/m10-web-dist` | **912 teste · 911 PASS · 0 FAIL · 0 cancelled · 1 SKIP** (40 min 23 s) |
| **V1** | `node --test tests/*.test.mjs` | **552 teste · 551 PASS · 0 FAIL · 1 SKIP** |

- **SKIP-uri:**
  - V2: T25 (crearea unui symlink de fișier e refuzată pe Windows, EPERM; ramura e acoperită de testul cu junction);
  - V1: testul de symlink al bazei de date, din același motiv.

  Ambele sunt neschimbate față de M09.
- **Creștere:** M09 avea 859 de teste V2; M10 adaugă exact cele 53 de teste noi. Toate testele M01–M09 trec, inclusiv:
  - E2E-ul M06 în browser;
  - testul Studio M09 în browser (rulat pe UI-ul M10).

## 6. M10.1 — Lega dintr-un click (`2.11.1-m10`, 2026-10-04)

**Teste noi (17):**
- `v2/tests/m10-lega-owner-start.test.mjs`: 16 teste (ZF-01…13, ZF-06b, ZF-08b, UI-01);
- `v2/tests/m10-lega-stage-e2e.test.mjs`: 1 test în Chromium real, cu autentificator virtual (PASS_SIMULATED, niciodată Windows Hello).

**Ce acoperă:**
- pornirea din BUILD_SAFE fără scrierea modului;
- grantul născut epuizat, revocarea la final, auditul;
- refuzul pentru canalele `ui` fără sesiune, `voice`, `companion`, `agent` și `cli` și pentru o sesiune falsificată;
- politica `legacy` (calea veche neschimbată);
- poarta după Stop All, acordul și declarația de facturare, care decid în continuare;
- oprirea la: logout, „revocă toate”, inactivitate (tick), revocarea autentificatorului, dezactivarea politicii, retragerea facturării (pe ambele căi), schimbarea explicită de mod;
- eliberarea modului de către un plan, care nu oprește vocea derivată (dar o oprește pe cea veche);
- fără restituire înainte de GPT-Live;
- limita de 6 porniri / 15 min, vizibilă în previzualizare;
- limitele de timp, inclusiv rotirea sesiunii aproape de sfârșit;
- HTTP 201 / 403, `LEGA_TERMS_CHANGED`, setarea salvată de căutare pe internet;
- intenția „Pornește Lega” (verificare fără scriere, refuz din transcriere de provider, „deja pornită”);
- `recover()` la repornire;
- pornirea de pe ecranul complet (scena se închide, motivul e vizibil, căutarea „live” nu pornește nevăzută).

**Verificare:** două runde multi-agent, doar citire.

| Rundă | Constatări | Confirmate și reparate | Infirmate |
|---|---|---|---|
| 1 | 21 | 19 | 2 |
| 2 (19 agenți) | — | 7 noi | 3 |

**Mutații:** 9 (8 pe server și în logica UI, 1 în browser). Fiecare readuce un defect reparat și **toate sunt prinse**.

**Suita completă (după toate reparațiile):**

| Suită | Rezultat |
|---|---|
| **V2**, cu UI-ul din `.ifrim/tmp/m10-web-dist` | **929 teste · 928 PASS · 0 FAIL · 0 cancelled · 1 SKIP** (39 min 52 s) |

- Singurul SKIP e T25 (symlink, EPERM), neschimbat.
- Creștere: 912 → 929, adică exact cele 17 teste noi.
- V1 nu a fost rulat din nou: niciun fișier V1 nu s-a schimbat de la rularea M10 (552 · 551 PASS · 1 SKIP).


## 7. M10.2 — fluxul fără formulare (`2.12.0-m10.2`, 2026-10-05)

- **Teste noi:** 25 de fișiere m10-2-* (intents, voice-grammar, envelope-authority, probe-counters, media-tools, skills-reconcile, blockers, intake, lega-intake, engineering-planner, content-planner, lifecycle, armed-voice, web-search-guard, run-envelope, ui-e2e, probe-e2e, integration, review-g1…g5 etc.).
- **Hartă și review:**
  - 9 agenți au construit harta, 16 au implementat;
  - review adversarial cu 60 de agenți: **42 de constatări confirmate (5 grave), toate reparate**, fiecare cu test de regresie;
  - 10 constatări infirmate;
  - fiecare mutație verificată a fost prinsă.
- **Suita completă V2** (UI din `.ifrim/tmp/m10-web-dist`): **1110 teste · 1109 PASS · 0 FAIL · 0 cancelled · 1 SKIP** (T25, symlink, neschimbat; 46 min).
- **V1:** **552 teste · 551 PASS · 0 FAIL · 1 SKIP**.
- **Creștere:** 929 → 1110 teste V2.
- **Testele M10.2 nu pornesc modele:** furnizorii, desktopul, ffmpeg și vocea sunt simulate. Proba live are fișa ei în raportul de închidere.

## 8. M10.2 — închiderea P0 (`2.12.1-m10.2`)

Data: 2026-10-05 → 2026-10-06 · cod `2.12.1-m10.2` · contract API 12 · schema 11 (fără migrare) · fără model, fără Hub live, fără Windows Hello real.

Etichete: suitele sunt PASS_SIMULATED. Partea live (upgrade, Windows Hello real, voce reală, proba A–G) e NOT_RUN. Deciziile D14–D23 sunt descrise în `M10_2_REPORT.md` §11.

### 8.1 Testele noi (10 fișiere, 119 teste)

| Fișier | Teste | Ce dovedește |
|---|---|---|
| `m10-2-p0-rearm.test.mjs` (RA) | 11 | **Rearmarea porții, D14–D17.** Fiecare oprire își înregistrează originea pe canal, cu precedență. Un singur clasificator („Pauză” din paletă nu e Stop All). Cardul cere sesiunea; fără verificare proaspătă nimic nu se schimbă. Rearmarea deschide toată poarta și readuce BUILD_SAFE în aceeași tranzacție (contor: `gateRearms` 1, `manualModeChanges` 0). Nimic vechi nu repornește; doar cererea cardului e propusă din nou. Un al doilea Stop All între card și rearmare e refuzat. Evenimentele de securitate cer confirmarea legată de ele. Refuz cât timp există un lease reținut, o execuție activă, o anulare în curs sau Lega deschisă. Voce, telefon, `ui`, agent și `cli` sunt refuzate; nonce-ul e de unică folosință. Niciun tick nu redeschide poarta, nici după ore. |
| `m10-2-p0-intake-rearm.test.mjs` (IR) | 9 | **Cererile care întâlnesc o poartă oprită.** Cererea e păstrată și cardul o poartă; rearmarea propune din nou doar cererea aceea. „Continuă” după Stop All nu reia nimic și arată cardul; după rearmare reia. Pauza ta se redeschide cu „Continuă”, pauza altui autentificator nu. Pe canalul vocal: fraza cinstită, niciodată card. „Pornește Lega” și „Redeschide poarta” arată cardul. După un plan expirat, „Continuă” indică Reia misiunea „X” (D20). |
| `m10-2-p0-continue-voice.test.mjs` (CV) | 8 | **„Continuă” rostit, D18–D19.** Doar propoziția întreagă contează. Într-o sesiune Lega derivată, cu filtru, „Lega, continuă” verificat local dă același rezultat ca textul scris, o singură dată. „Continuă” din transcrierea providerului nu reia. Dovezile refuzate: vocea Lega în microfon, transcriere parțială, segment de probă, altă sesiune, frază deja folosită. „Da. Continuă.” nu reia. Un plan care își așteaptă răspunsul rostit are prioritate. O pauză adresată lui Lega e a ta; una neadresată nu. |
| `m10-2-p0-probe-fixes.test.mjs` (P0) | 14 | **Corecturile pentru probă, D20–D21.** Numele cu punct sunt recunoscute, iar numele exact câștigă în fața unuia mai scurt. „Continuă?” e o singură clarificare. Frazele de rearmare doar arată cardul. Singurul test de acceptanță e legat fără întrebare; nu și când e numit alt test sau când ceri scrierea unui test. Cardul promite preview / E2E doar când specificația le are (hash neschimbat pentru o specificație cu amândouă). Configurarea re-atestă doar aceeași amprentă, pe o inspecție proaspătă; o amprentă nouă sau lipsa unei atestări trecute rămân decizia proprietarului. |
| `m10-2-p0-ui.test.mjs` (P0UI) | 13 | **Interfața rearmării (12 fără browser + 1 în browser).** Opțiunile unui blocaj de poartă nu mai sunt niciodată un link de administrare. Un singur loc pentru card în cockpit. Pagina trimite nonce-ul și hash-ul Hub-ului, doar click / Enter / tastat. Un refuz se reia cel mult o dată, fără temporizator. Contracte pe cardurile și refuzurile reale ale unui Hub de test. **P0UI-E2E-01** (Chromium): Stop All → bannerul arată cardul → butonul cardului și UN Windows Hello redeschid poarta; o cerere scrisă → card → Enter → planul revine neselectat și neconfirmat. |
| `m10-2-p0-followups.test.mjs` (FU) | 6 | **Golurile găsite la integrare.** `OPEN GATE` tastat refuză o oprire de lângă un eveniment de securitate; fără eveniment, calea de diagnostic încă redeschide. Închiderea amânată a lui Stop All atinge doar planurile propuse înaintea opririi. O suspendare nu repornește cererile păstrate. `environment.attest` transmite amprenta așteptată de pe orice canal: una diferită e refuzată înaintea canary-ului, fără rând de atestare. Nonce-ul cardului nu ajunge în jurnalul comenzii `owner.intent`. |
| `m10-2-p0-round2-runtime.test.mjs` (R1) | 16 | **Runtime și poartă, runda 2.** O execuție aflată în admitere la Stop All nu ajunge la model, nici dacă poarta e redeschisă între timp: lease eliberat, încercare restituită, grant rămas revocat (AS-01). O misiune blocată la poartă se reia cu „Continuă” după rearmare (SM-01). O trecere de pregătire nu reia nimic după o rearmare (SM-02, mediu WSL simulat). Oprirea Hub-ului cu o execuție activă închide cardurile de plan în așteptare, cu o apărare la pornire (SM-05). Lista de securitate: cele mai noi primele, numărul real, pe 505 evenimente (SM-08 / REG-05). Contract 12: o pagină pentru contractul 11 primește 409 `UI_STALE` (REG-04). Ce a oprit Stop All e ținut până la rearmare; ce a fost oprit din alt motiv nu (D22). |
| `m10-2-p0-round2-voice.test.mjs` (R2V) | 12 | **Intake și voce, runda 2.** „Continuă” ține pe loc doar ce a oprit chiar oprirea curentă, la fel scris, rostit și printr-o alegere (REG-01 / D22, AS-06). Pauza altui autentificator primește drumul spre card, nu „spune Continuă” (SM-07). Veto-ul providerului: local „Continuă.” + provider „Continuă?” → nimic nu se reia, un singur răspuns (VOICE-01). Un refuz e spus o dată, niciodată tăcere totală (VOICE-02). Vocea nu promite nicio redeschidere automată (VOICE-04). Răspunsul citează ce s-a auzit (VOICE-05). O pauză negată sau condiționată nu e a proprietarului (VOICE-06). |
| `m10-2-p0-round2-intents.test.mjs` (R2B) | 12 | **Intenții, planificator, configurare, runda 2.** Frazele firești cu „după Stop All” arată cardul și nu adaugă un al doilea Stop All (PF-01, PF-05). O parte de nume cu cifră sau punct nu e aruncată ca să se ajungă la alt proiect; rămâne o singură întrebare (PF-02). Testul de acceptanță nu e legat când e numit alt test sau când ceri scrierea unuia (PF-03, PF-04). O verificare a reviewer-ului care eșuează e arătată cu cauza ei și nu e repetată la fiecare click (PF-06 / REG-03). Un „?” din altă parte a frazei tot oprește reluarea, cu o formulare neutră (PF-08). |
| `m10-2-p0-round2-ui.test.mjs` (R3) | 18 | **Reluările de plan / desktop și interfața, runda 2 (16 fără browser + 2 în browser).** `ops.plan.resume`, reconfirmarea într-o sesiune nouă și `desktop.resume` sunt refuzate cu `GATE_REARM_REQUIRED` până la rearmare; un Stop All sosit în timpul reluării câștigă; o oprire care nu poate fi citită refuză (fail-closed) (D22). Logica paginii pentru UI-01…UI-10. **R3-E2E-01** (Chromium): o eroare de reîncărcare a cockpitului și schimbarea proiectului nu repetă niciun click; butonul cardului redeschide o singură dată. **R3-E2E-02**: „Continuă” de pe cardul planului după Stop All arată cardul de rearmare, în cockpit și pe pagina Operator. |

**D23** (verificarea automată a contului la pornirea Lega): `m10-2-p0-lega-autoprobe.test.mjs`. 17 teste (LA-01…LA-12): pornire derivată cu verificare expirată (o singură verificare, canalul `automation`, actorul `readiness:lega-start`), verificare proaspătă (nicio verificare în plus), eșec și timeout (refuz cinstit, nicio sesiune, niciun grant), două porniri simultane (o singură verificare), limita de verificări automate, preview doar citire (niciun rând de comandă, niciun eveniment), căile legacy/grant neschimbate, canalele agent/cli/voce refuzate, anularea cu „Oprește” în timpul verificării. Rulări țintite: 115 + 154 PASS. Nu e numărat în §8.4, dar intră în regresia completă din §8.5.

### 8.2 Aserțiuni existente schimbate intenționat

- `m10-2-probe-counters` (PROBE-01): contorul nou `gateRearms: 0`.
- `m10-2-review-g2b` (G2b-01), `m06-cockpit` (M06-CK-03), `m10-2-ui-e2e` (U15-02): după Stop All, textele nu mai trimit la `OPEN GATE` / Integrări → Avansat (D14).
- `m07-activation` (M07-AC-05): pasul de atestare poate fi „decizie separată (Sistem → Medii)” (D21).
- `m10-2-engineering-planner` (EP-03): o descriere de bug leagă testul de acceptanță fără întrebare; fluxul cu o întrebare continuă pe o cerere de funcționalitate (D21).
- Runda 2 a ajustat și teste din runda 1: RA-08 (VOICE-04: textul nu mai promite o redeschidere automată), CV-02 (VOICE-05: răspunsul citează ce s-a auzit), CV-05, IR-03 și IR-04 (REG-01 / D22), P0UI-03 (UI-03: cardul e legat doar de cererea lui), P0UI-05 / 10 și P0UI-E2E-01 (UI-01: cardul se arată întâi), P0UI-12 (UI-02, UI-05 / 06: un singur loc pentru card).

Rapoartele unităților leagă fiecare schimbare de o decizie numită (D14, D21, D22) sau de o constatare din review (UI-01, UI-02, UI-03, UI-05, VOICE-04, VOICE-05).

### 8.3 Mutații

**126 de mutații** raportate de cele 8 unități. Fiecare readuce un defect reparat; după fiecare, originalul a fost restaurat exact.

| Rundă | Unitate | Mutații |
|---|---|---|
| 1 | poarta și rearmarea | 15 |
| 1 | intake și „Continuă” rostit | 15 |
| 1 | corecturile de probă | 11 |
| 1 | interfața | 11 |
| 2 | runtime și poartă | 22 |
| 2 | intake și voce | 20 |
| 2 | intenții, planificator, configurare | 13 |
| 2 | interfață și reluări | 19 |

- **Prinse:** toate, cu două precizări, ambele în unitatea „runtime și poartă”:
  - una dintre cele două gărzi ale SM-02 („starea de la începutul trecerii”), scoasă singură, nu e prinsă: o maschează garda „poarta s-a schimbat în timpul trecerii”. Cu amândouă scoase, testul pică. Rămâne ca apărare în adâncime;
  - adăugarea clasei „suspendare” la clasele care țin munca pe loc e prinsă doar de aserțiunea pe constantă; comportamentul e apărat de două ori.
- **8 mutații** au cerut reconstruirea UI-ului și browserul real.
- **Fără mutație proprie:** ramura fail-closed din `desktop/operator.mjs` (cea geamănă din `ops/plans.mjs` e verificată); testele din `m10-2-p0-followups` (rapoartele nu menționează mutații pentru ele).

### 8.4 Rulările de integrare

**Runda 1:** `node --check` pe 103 fișiere, UI construit separat, apoi setul țintit de două ori: **424/424** de fiecare dată (122 + 112 + 190), 0 sărite. Integrarea a găsit un gol real: comanda `environment.attest` arunca amprenta așteptată. Golul a fost închis, cu testul FU-05.

**Runda 2:** `node --check` pe 132 de fișiere `.mjs`; UI construit într-un folder temporar (`v2/web/dist`, servit de Hub-ul live, a rămas neatins); trei loturi, cu `--test-concurrency=1`:

| Lot | Conținut | Rularea 1 | Rularea finală |
|---|---|---|---|
| A | primele 17 fișiere `m10-2-*` | 142/142 | 142/142 |
| B | celelalte 17 fișiere `m10-2-*`, cu toate testele de browser | 158/158 | 158/158 |
| C | 17 suite mai vechi | 206/206 | 206/206 |
| **Total** | | **506/506** | **506/506** |

- 0 sărite în fiecare lot. Niciun defect de îmbinare găsit.
- Suplimentar: **132/132** pe 20 de suite conexe. `m10-operator-real` a fost exclus (helperul desktop real), iar suitele `m11-*` țin de alt flux de lucru.
- Testele de browser au rulat real (Chromium headless prin Playwright, autentificator virtual, Hub de test pe port aleator): R3-E2E-01/02, P0UI-E2E-01, M10.2-E2E-A…F, G4-27d, G5-E2E, U15-E2E-01.
- G4-27d și G5-E2E picaseră în rulările a două unități doar pe build-ul vechi al UI-ului (contract 11). Pe build-ul nou trec, în ambele rulări.

### 8.5 Suita completă (după toate reparațiile)

| Suită | Comandă | Rezultat |
|---|---|---|
| **V2** | `node --test --test-concurrency=1` pe `v2/tests/*.test.mjs` fără `m11-*`, cu UI-ul construit separat | **1246 teste · 1245 PASS · 0 FAIL · 0 anulate · 1 SKIP** (T25, symlink, neschimbat); 128 de fișiere, fără `m11-*`, UI construit separat; 55 min (2026-10-06, 00:21–01:17 UTC) |
| **V1** | `node --test tests/*.test.mjs` | **552 teste · 551 PASS · 0 FAIL · 1 SKIP** (2026-10-06, 01:17 UTC) |

Cele 10 fișiere P0 adaugă 119 teste față de §7, iar `m10-2-p0-lega-autoprobe` încă 17.

### 8.6 Fără modele

- Niciun test P0 nu pornește un model. Sunt simulate: furnizorii (app-server de test), vocea (worker de test), mediul WSL (distro simulat), autentificatorul (software sau virtual, niciodată Windows Hello).
- Niciun test nu atinge Hub-ul live de pe 8011: fiecare pornește un Hub de test pe un port aleator.
- Pentru 2.12.1 nu s-a rulat nimic live.
