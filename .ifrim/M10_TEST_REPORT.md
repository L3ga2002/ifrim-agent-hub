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
