# M06 · Raport de teste

Data: 2026-10-02. Cod `2.7.0-m06`, necomis. Rulat local, fără modele reale.

## 1. Suitele

| Suita | Total | PASS | FAIL | Omise | Notă |
|---|---|---|---|---|---|
| V2 (`npm run test:v2`), cod final, rularea completă | 546 | 544 | 1 | 1 | eșecul: fișierul `m06-intents` nu s-a încărcat (eroare de sintaxă introdusă de mine într-un patch al testului, după verificarea lui individuală); reparat |
| V2, rerulare pe codul final | 5 | 5 | 0 | 0 | `m06-intents` 4/4 și `m06-lega-voice` 1/1 (adăugat după pornirea suitei) |
| **V2 total pe codul final** | **550** | **549** | **0** | **1** | 550 de declarații `test()` (M05: 500, plus 50 în M06); omisul e cel din M05 |
| V1 (`npm test`) | 552 | 551 | 0 | 1 | identic cu M05; fișierele V1 nu au fost atinse |

**Rularea intermediară V2** (făcută în timp ce codul se schimba): 537/533/3/1. Cele 3 eșecuri erau contracte pe care M06 le schimbă intenționat; testele au fost actualizate explicit:
- **M01-CMD-01:** lista canalelor include acum `owner`. Testul verifică și că bus-ul refuză `owner` fără sesiune.
- **M01-NG1:** scanarea statică pentru git a găsit literalul `"git"` (tipul stării repository-ului), redenumit `"repository"`; garda rămâne neatinsă.
- **M05-RT-06:** verifică acum calea M05 (atestare fără C18, deci preview pe Windows). Calea nouă, cu C18, e verificată de M06-PL-02/04/05.

## 2. Testele noi M06 (50)

| Fișier | Teste | Ce dovedește | Status |
|---|---|---|---|
| `m06-trust.test.mjs` | 7 | CBOR/COSE; înregistrare bootstrap (text exact, doar localhost, UV obligatoriu, provocare de unică folosință, origin/RP greșit); ES256/RS256/EdDSA; sesiune (hash, origin, inactivitate/expirare, contor clonat, semnătură alterată); politica (legacy implicit, activare proaspătă, dezactivare fail-safe din voce); HTTP cu cookie HttpOnly/SameSite/Path și canalul `owner` jurnalizat | PASS_SIMULATED (autentificator software) |
| `m06-envelopes.test.mjs` | 13 | previzualizare fără efecte; o confirmare → granturi derivate → bucla → DELIVERY_READY → închidere și BUILD_SAFE; confirmare dublă; plan schimbat / repository schimbat / nonce greșit; vocea, ui, LLM, aprobări străine refuzate; grant mai larg refuzat (inclusiv 6 > 5); ASSISTED cu confirmare de diferență; Stop All revocă; proiect real BLOCKED_BY_ISOLATION; OBSERVE și autonomia; confirmarea vocală cere dovezi locale; garda de facturare; transcrierea providerului nu adaugă autoritate | PASS_SIMULATED |
| `m06-intents.test.mjs` | 4 | frazele din specificație; vocabularul întreruperilor; „da” doar pentru planul afișat, citat, provider, document, două planuri; diacritice, ambiguitate, departamente | PASS_SIMULATED |
| `m06-cockpit.test.mjs` | 10 | stările cockpitului fără invenții; replay fără nicio scriere; explicații; delta; layout sigur; hartă (roluri ≠ workeri); întreruperi (freeze în poartă, dezghețare refuzată din voce, preluare cu checkpoint); atenție agregată și „doar decizii”; recomandări neaplicate; shadow cu autorizare și fără efect | PASS_SIMULATED |
| `m06-voice.test.mjs` | 4 | caracteristici pe voci sintetice; înscriere (sesiune, acord, calitate) și verificare 1:1; semnale suspecte niciodată MATCH; ștergerea fișierului | PASS_SIMULATED (voci sintetice; nu performanță biometrică) |
| `m06-pipeline.test.mjs` | 5 | flag-urile bwrap = cele din C18; hartă cu/fără C18; preview în profil (fake-wsl), stop curăță; fabrica: preview PASS în mediu → E2E BLOCKED, fără finding | PASS_SIMULATED |
| `m06-ui-logic.test.mjs` | 5 | răspunsuri doar din date; doar planul afișat poate fi confirmat; ținte de morph cu același index, maxilar doar jos, trăsături; tranziții întreruptibile, gura închisă fără audio sau cu sunet oprit; graful arată mediul real | PASS_SIMULATED |
| `m06-lega-voice.test.mjs` | 1 | agentul vocal Lega (app-server fake) deschide cockpitul unui proiect de oriunde: navigare la `#/lega/<id>`, notițele citite, un proiect necunoscut nu e ghicit; nicio execuție și niciun plan creat | PASS_SIMULATED |
| `m06-ui-e2e.test.mjs` | 1 | **UI-ul real în Chromium**: înregistrare cu autentificator virtual → politică → „Arată-mi înainte să faci” → o confirmare → bucla → „Gata pentru verificare”; comenzile proprietarului = înregistrare, activare, confirmare | PASS_SIMULATED (autentificator virtual Chromium) |

## 3. Mutanți (13)

| Mutant | Testul | Rezultat |
|---|---|---|
| MU-01 bus-ul acceptă `owner` fără sesiune | TR-04 | prins |
| MU-02 înregistrare fără UV | TR-02 | prins |
| MU-03 contorul care scade e ignorat | TR-03 | prins |
| MU-04 aprobare prin plan fără verificarea hash-ului | EN-05 | prins |
| MU-05 preluarea confirmării din orice status | EN-03 | **echivalent**: între reverificarea statusului și preluare nu există `await`, deci un singur proces nu poate intercala; clauza rămâne apărare suplimentară |
| MU-06 încercările granturilor nelimitate | EN-06 | supraviețuise; test adăugat (6 > 5); **prins** |
| MU-07 schimbarea planului nedetectată | EN-04 | prins |
| MU-08 transcrierea providerului adaugă autoritate | EN-13 | prins |
| MU-09 confirmarea citată acceptată | IN-03 | supraviețuise; test adăugat („„Da, execută planul”” întreg citat). Prima reverificare „prins” a fost **nevalidă**: fișierul avea eroarea de sintaxă de mai sus, deci pica oricum. Am reparat fișierul, am confirmat că trece nemutat (4/4) și am rerulat mutantul: **prins** |
| MU-10 remedieri ASSISTED fără confirmare | EN-07 | prins |
| MU-11 proiectul înghețat nu e verificare a porții | CK-07 | prins |
| MU-12 MATCH în ciuda dispozitivului virtual | VO-03 | prins |
| MU-13 preview cu rețeaua partajată (`--share-net`) | PL-01 | prins |

Rezultat: **12 prinși, 1 echivalent documentat.** Pentru fiecare mutant prins, testul trece pe codul nemutat (verificat după incidentul MU-09). Fișierele au fost restaurate după fiecare mutant (verificat cu `git status`).

## 4. Real, fără model și fără instalări (PASS_LOCAL)

- Inventarul `ifrim-runner` (doar citire).
- **C18a–C18i** în distribuția reală, secțiunea exactă din `canary.sh`: 9/9.
- Gazda de preview reală cu `localOnlyArgs()` exacte: izolarea măsurată `ok`, HTTP 200 în 84 ms, 0 procese după oprire.
- Fața WebGL2 în Chromium: 0,16–0,17 ms CPU pe cadru; fallback-ul SVG verificat (o eroare reală de precizie a shaderului a fost găsită și reparată așa).

## 5. Dovezi vizuale (capturi din sesiune, în scratchpad-ul sesiunii)

- Simulatorul (port 8012, „SIMULARE — FĂRĂ MODELE REALE”): cockpitul cu nucleul, cu fața (după reparația preciziei), cardul „Arată-mi înainte să faci”, mobil 375×812 cu fața și forma HARTĂ în mijlocul morph-ului.
- Chromium (test E2E): `m06-setup.png` (configurare), `m06-plan.png` (planul, nimic pornit), `m06-ready.png` (Gata pentru verificare; sesiune deschisă · voice-first), `m06-face.png` (fața, aproape).

O captură nu dovedește vocea sau sincronizarea audio: acestea au doar teste unitare (UI-04) și rămân NOT_RUN pe audio real.

## 6. Ce nu a rulat

- **Windows Hello real**, înscrierea vocii tale și orice sesiune GPT-Live.
- **Orice model real** (Codex, Claude): D1–D10 doar simulate.
- **Preview-ul în mediu prin Hub-ul live:** cere repornirea pe M06 și reatestarea.
- **C3, E2E și review în mediu:** BLOCKED / NOT_RUN, conform `M06_PIPELINE_READINESS.md`.
