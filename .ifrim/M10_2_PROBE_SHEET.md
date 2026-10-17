# Proba ghidată M10.2 (A–G): fișa 2.12.2

**Stare:** pregătită pe 2026-10-06, 17:55 UTC. **Neaprobată.** Proba se aprobă doar cu fraza exactă **„Aprob proba M10.2.”** După ea nu mai cer aprobări administrative pentru subpașii de aici.

Fișa 2.12.1 (aprobată pe 2026-10-05) e înlocuită de aceasta. Istoricul ei e în §9.

## PROIECT

- **Nume:** Factory Demo M10.2, id `prj_muw3gnxo_52bfc7470f`.
- **Folder:** `C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\ifrim-factory-demo-m10-2`.
- **Tip:** proiect de test (fixture bug-demo), pe ruta Windows.
- **Problema de rezolvat:** un singur test de acceptanță, care pică.

## SCOP

Dovada live că:
- proprietarul ajunge de la o cerere la un rezultat cu o singură confirmare pe plan;
- nu completează niciun formular, nu schimbă modul manual și nu are nevoie de vreo intervenție de dezvoltator;
- Pauza, Stop All și redeschiderea porții merg pe codul `2.12.2-m10.2`.

Codul `2.12.2-m10.2` aduce:
- R1: spațiile de lucru rămase rezervate se reconciliază;
- R2: „Oprește tot” oprește doar ca poruncă;
- R3: limita pe tură;
- R4: contoarele cu numele cerute de tine;
- L1–L11: reparațiile din sesiunea Lega de azi.

**Rezultat:** `M10.2_CLOSED_LIVE` se declară doar pe dovezi (§7).

## Pregătirea inclusă (o fac eu după aprobare, fără alte întrebări)

1. **Backup verificat al Hub-ului**, cu mecanismul existent (`backup.run`, cu verificare prin restaurare), imediat înainte de upgrade.
   - Backup-ul acoperă codul. Baza de date nu se schimbă la acest upgrade (nu are migrare).
2. **Upgrade-ul:** `node v2/scripts/upgrade.mjs --plan` (doar citire), apoi `--apply`. Ținta: `2.12.2-m10.2`, contract API 12, schema 11, fără migrare.
   - **Verific după upgrade:** versiunea, contractul, BUILD_SAFE, poarta deschisă, 0 granturi active, 0 execuții, 0 spații de lucru rezervate.
   - **Ce trebuie să faci tu:** un tab deschis dinainte arată „Interfață veche” și trebuie reîncărcat.
   - **Rollback:** schema rămâne aceeași, deci revenirea la 2.12.1 (commitul `e1a2d0d`) înseamnă doar cod.
3. **Notepad:** verific că e închis, ca pasul B să dovedească o fereastră nouă. Dacă e deschis, îți cer să-l închizi.
4. **Marcajul S1:** `node v2/scripts/probe-m10-2.mjs --mark`, după upgrade. Pregătirea nu intră în contoare.

## AI

- **Lega:** o sesiune, cel mult 3 porniri, în total cel mult 20 de minute.
  - Vocea merge prin GPT realtime, pe abonamentul Codex.
  - Agentul din spatele Legăi rulează cu efort mic, fixat de Hub din 2.12.2.
  - Estimare: aproximativ 1 USD la 20 de minute. E doar o estimare; consumul real nu e raportat.
- **Writer:** Codex `gpt-6.1-sol` · `medium`. Scrie doar în proiectul de test (sandbox Windows, rețea oprită).
- **Reviewer:** Claude `sonnet` · `medium`, doar citire.
- **Remedieri și încercări:** cel mult 2 cicluri de remediere și 2 încercări pe etapă. Contează doar încercările care au ajuns la model.
- **Limita pe tură** (alta decât termenul misiunii): writer 25 min, reviewer 15 min.
  - Peste limită, rezultatul e TIMEOUT, nu FAIL.
  - Hub-ul reia automat o singură dată, după cel puțin 60 s, doar dacă mai sunt încercări; apoi decizia e a ta.
  - Pauza și Stop opresc ceasul.
- **Termenul misiunii:** 120 min de la start. Autoritatea planului ține 150 min de la confirmare.
- **Estimarea turelor:** 2 ture (1 Codex, 1 Claude) dacă totul merge din prima; cel mult 6 ture pe rol.
- **Fără** API billing, credite cumpărate sau servicii noi plătite (garda de facturare a Hub-ului rămâne neschimbată).

## MEDIA

- **Importul** proiectului M09 din `C:\Users\mihai\Videos\Ifrim Studio\M09 - Un plan, o confirmare\`. Se importă proiectul întreg, nu doar MP4-ul, și se lucrează pe o copie; originalele rămân neatinse.
- **„Arată-mi clipul”** și **„La secunda 12 mută textul mai sus”** dau o versiune nouă, randare locală cu ffmpeg (versiune fixată) și QA.
- **Nimic** nu se publică sau se încarcă. Aprobarea creativă rămâne a ta.

## EXCLUS

ProDelivery (și F-001), Agent Hub ca țintă de scriere, V1, OpenClaw, pachetele istorice (ProDelivery, D6, Demo B), deploy, commit, push, social media, costuri noi sau API billing, alte proiecte, pilotul M11, re-atestarea WSL.

## INTERVENȚII UMANE (doar ale tale)

- Aprobarea acestei fișe, cu fraza de la final.
- Pașii A–G, cu vocea și comenzile tale reale, plus Windows Hello când ți-l cere Hub-ul (sesiunea, redeschiderea porții).
- **Filtrul vocal: oprit**, decizia ta de azi („mă aude greu”).
  - „Da, execută planul” și „Continuă” le dai din cockpit (click, Enter sau text).
  - De aceea VOICE_CONFIRMATIONS și VOICE_CONTINUE ies NOT_RUN, iar VOICE_FLOW_VERIFIED nu se poate declara.
  - Pauza spusă către Lega merge și fără filtru. Restul probei rămâne valabil.

## Pașii (te ghidez câte unul și aștept acțiunea ta reală)

- **A.** Pornești Lega dintr-un click. Fără formular și fără grant.
- **B.** „Deschide Notepad”. Verific fereastra nouă și aducerea ei în față.
- **C.** „Hai să lucrăm la Factory Demo M10.2”. Se deschide cockpitul și nu pornește nimic.
- **D.** „Repară testul de acceptanță din Factory Demo M10.2”. Cardul planului arată:
  - proiectul și problema;
  - modelele;
  - testul protejat;
  - încercările;
  - limita pe tură;
  - termenul;
  - ce nu face.

  Confirmi o dată, cu click sau Enter.
- **E.** Hub-ul lucrează singur, în BUILD_SAFE. Etapele: baseline → writer → teste → review → remedieri incluse → QA → pachet DELIVERY_READY. Îți spun progresul pe înțeles. Acceptarea pachetului rămâne decizia ta separată.
- **F.**
  - În timpul lucrului: „Lega, pune totul pe pauză”, apoi „Continuă” scris în cockpit.
  - După DELIVERY_READY: „Ce urmează după Stop All?” (nu trebuie să oprească nimic).
  - Apoi „Oprește tot”, iar după el redeschiderea din cardul din cockpit, cu Windows Hello. Nimic vechi nu repornește.
- **G.** Studio:
  1. importul folderului M09;
  2. „Arată-mi clipul”;
  3. „La secunda 12 mută textul mai sus”.

## 7. Ce raportez

Rulez `node v2/scripts/probe-m10-2.mjs --since S1`.

| Contor | Așteptat |
|---|---|
| GRANT_FORMS_OPENED | 0 |
| MANUAL_MODE_CHANGES | 0 |
| NAVIGATION_TO_APPROVALS | 0 |
| NAVIGATION_TO_ADVANCED | 0 |
| PLAN_CONFIRMATIONS | 3 (planul D, importul și editarea de la G) |
| EXTRA_SCOPE_CONFIRMATIONS | 0 |
| MANUAL_DEV_DB_API_INTERVENTIONS | 0 |
| VOICE_CONFIRMATIONS | 0, NOT_RUN (filtrul e oprit) |
| VOICE_PAUSE | 1 |
| VOICE_CONTINUE | 0, NOT_RUN („Continuă” se dă scris) |
| STOP_ALL | 1 |
| CONTEXTUAL_REARM | 1 |
| UNKNOWN_INTENTS | 0 ca țintă; raportez exact ce a ieșit |

Separat raportez:
- timpii fiecărei etape;
- versiunea servită;
- consumul acestei sesiuni Claude Code, despărțit de execuțiile AI pornite prin Hub.

**`M10.2_CLOSED_LIVE` se declară doar dacă toate condițiile de mai jos sunt îndeplinite:**
- toate contoarele de mai sus sunt la valoarea așteptată;
- „Ce urmează după Stop All?” nu a oprit nimic;
- Stop All și redeschiderea au mers;
- nimic vechi nu a repornit;
- nu a existat nicio intervenție a mea în locul tău.

Pentru orice abatere: PAS → AȘTEPTAT → REAL → CAUZĂ → FIX.

## 8. Manifestul versiunii probei (înainte de upgrade)

| Ce | Valoare |
|---|---|
| Ramura / HEAD / origin | `v2-milestone-01` / `e1a2d0d` (2.12.1, comis local, neîmpins) / `e8a55ce` |
| Codul probei | `2.12.2-m10.2`, contract 12, schema 11 (fără migrare), **necomis** |
| Delta P0 peste `e1a2d0d` | 56 de fișiere de cod: 42 modificate și 14 noi. Hash combinat `c4be2b1961e94b10…` (lista completă cu sha256 per fișier o păstrez lângă raport) |
| Fișiere M11 | 46 necomise, neconectate la server, excluse din probă |
| Regresie pe acest arbore | V2: 1364 teste, 1363 trec, 0 eșuează, 1 omis (T25, symlink). V1: 552 teste, 551 trec, 1 omis. M11: 104 teste, 102 trec, 2 omise |
| Hub-ul live acum | `2.12.1-m10.2`, contract 12, BUILD_SAFE, poarta deschisă, 0 granturi active (41 istorice), 0 execuții, 0 spații de lucru rezervate |
| Vocea | Profil `vpr_murjpbeq_3ab0dd4e54` v1, 7 mostre. Motorul local e gata (whisper.cpp large-v3-turbo, CAM++). **Filtrul e oprit** |
| Atestarea WSL | Validă (2026-10-06, 09:22 UTC, amprenta `8f9e9eeb934b6c01`, canary `0491ff30`). Codul 2.12.2 nu schimbă versiunea canary, deci atestarea rămâne validă. Proba nu o folosește (ruta Windows) |
| Marcajul vechi | S0 = 4522. Fereastra S0–S1 conține sesiunile Lega de azi (pregătire); proba se numără de la S1 |

## 9. Istoric

Fișa 2.12.1 a fost aprobată pe 2026-10-05, cu „ok continua ai toate aprobaRILE MELE”. Din ea s-au făcut:
- commitul local `e1a2d0d`;
- upgrade-ul la 2.12.1 (`upg_muw3g5tp`, 2026-10-06, 03:03 UTC);
- proiectul de test;
- marcajul S0 = 4522.

Pașii A–G nu au rulat. Textul ei complet e în commitul `e1a2d0d`.

Pe 2026-10-06, între 09:20 și 09:40 UTC, proprietarul a folosit Lega live (două sesiuni, 8,3 și 8,7 min, pe ProDelivery). Defectele găsite atunci (L1–L11) sunt reparate în 2.12.2. Tot atunci, proprietarul a oprit filtrul vocal.

---

**Spune: Aprob proba M10.2.**
