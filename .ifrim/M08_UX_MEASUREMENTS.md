# M08 · Măsurători UX și capturi

**Sursă:** `v2/tests/manual/m08-screens.mjs`, rulat pe 2026-10-03.
- Un Hub **de test** cu date sintetice: proiectul fixture `bug-demo`, un incident, un scenariu, lecții, un obiectiv, ședința, pachetele A/B, un telefon asociat, un candidat de skill.
- Build-ul M08 servit dintr-un `dist` separat (`.ifrim/tmp/m08-web-dist`, prin `HUB_V2_WEB_DIST`).
- Chromium headless (Playwright 1.61), `reducedMotion: reduce`.
- Sesiunea de proprietar: autentificator software (PASS_SIMULATED).

Capturile (24 PNG) și `report.json` sunt în `.ifrim/m08-screens/`. Hub-ul live nu a fost folosit.

## Rezultate

- **Erori în consolă / erori de pagină:** 0.
- **Scroll orizontal:** 0 px pe toate ecranele măsurate. Lățimi verificate:
  - 1440 px: cockpit, ecranul mare și toate cele 11 tab-uri;
  - 360 px: cockpit, War Room, Simulare, Decizii;
  - 390 px: telefonul asociat și previzualizarea;
  - 360 px: asocierea.
- **Tastatură:** săgeata dreapta pe tab-ul „Azi” mută pe „Digital Twin”, iar focusul rămâne pe tab-ul nou (după o reparație M08: ecranul se remontează la schimbarea rutei).
- **Țintele de pe telefon:** butoanele de pauză și oprire au cel puțin 44 × 44 px; „Stop tot” are 64 px înălțime.

## Timp până la conținut (ms, Hub local)

| Ecran | Lățime | ms | Observație |
|---|---|---|---|
| cockpit (prima încărcare a aplicației) | 1440 | 794 | include încărcarea aplicației |
| telefon asociat (pagină nouă) | 390 | 472 | context nou, cookie de dispozitiv |
| asociere telefon (pagină nouă) | 360 | 565 | context nou, fără cookie |
| tab-urile Pilot (navigare în aplicație) | 1440 | 22–112 | Azi 112, Simulare 71, Twin 57, War Room 47, Autopilot 50, Decizii 51 |
| răspuns la o frază în cockpit („Ce avem azi?”, „Checkout-ul a picat”, scenariu, „Ține minte…”) | 1440 | sub 1 s | cardul apare după răspunsul `owner.intent` (fără model) |

Timpii sunt pe un Hub de test local, fără încărcare reală. Pe Hub-ul live se remăsoară după trecerea pe M08.

## Pași pentru proprietar (măsurat în teste)

- **Obiectiv de 2 sarcini (D3):** o singură confirmare, zero formulare de grant, zero aprobări.
- **Confirmarea vocală armată (D9-03):** zero click-uri. Planul arătat în sesiunea Lega se confirmă cu „Da, execută planul”.
- **Telefon:** asocierea cere un cod (PC) și o introducere (telefon). Stop tot e un tap plus o confirmare a browserului.

## Ce rămâne de măsurat live

- Vocea reală (latența transcrierii locale, fereastra armată cu vocea ta) după trecerea pe M08.
- Telefonul real: blocat (Hub-ul ascultă doar pe 127.0.0.1).
