# M10 — Operatorul PC-ului, autorizare fără formulare, Studio utilizabil

Data: 2026-10-04 · cod `2.11.0-m10` · contract API 10 · migrarea 10 · **comis în `72d6964`** (împreună cu M09 și M10.1; push-ul îl rulezi tu: `git push origin v2-milestone-01`) · **Hub-ul live rulează M10 din 2026-10-04 13:53 UTC** (upgrade la aprobarea ta, backup verificat; vezi `M10_ACTIVATION_SHEET.md`, de la pasul 2).

> **M10.1 (2026-10-04, cod `2.11.1-m10`, comis în `72d6964`, Hub-ul live pe `2.11.1-m10` din 18:12 UTC):** vocea Lega pornește dintr-un click, din sesiunea ta de proprietar. Nu mai cere mod, LIVE_VALIDATION sau grant de mână: Hub-ul derivă o autorizare pentru o singură sesiune vocală și o revocă la final. Detalii, reguli de securitate, teste și repornirea care o activează: `M10_LEGA_ZERO_FORM.md`.

## Pe scurt

### Ce poți spune (text sau voce, aceeași cale)

- „Deschide CapCut” / „Deschide OBS” / „Deschide Notepad” / „Deschide Explorer”
- „Adu OBS în față”, „Treci pe CapCut”
- „Arată folderul exporturilor”, „Unde e exportul?”
- „Importă din folderul acesta” (cu folderul deschis în Explorer)
- „Arată-mi clipul M09”, „Deschide Studio”
- „La secunda 12 mută textul mai sus”
- „Pregătește varianta verticală”
- „Înregistrează demonstrația cu OBS și pregătește varianta verticală, fără să publici”
- „Da” / „Da, execută planul” (doar pentru cardul afișat), „Nu acum”
- „Continuă”, „Pauză”, „Preiau eu”, „Oprește tot”

### Ce face cu adevărat

| Spui | Ce se întâmplă |
|---|---|
| **„Deschide X”** | Helperul local pornește aplicația (sau îi reutilizează fereastra), o aduce în față și verifică dacă e chiar în prim-plan. Dacă Windows refuză prim-planul, îți spune asta; nu raportează un succes fals. |
| **„Arată folderul exporturilor”** | Deschide Explorer exact pe folderul aprobat și verifică locația ferestrei. |
| **„Importă din folderul acesta”** | Citește folderul ferestrei Explorer din față și îți arată un card: ce se importă (surse cu hash verificat, versiuni, etichete, ce lipsește). Dacă folderul nu e aprobat, cardul cere acces o singură dată. După confirmare, proiectul (nu doar MP4-ul) intră în Studio. |
| **„La secunda N …”** | Propunerea pe versiunea curentă + un card. „Da” aplică (versiune nouă, originalul rămâne), randează ciorna și rulează QA. |
| **„Înregistrează demonstrația cu OBS…”** | Un singur plan: înregistrare prin OBS WebSocket → oprire → import → montaj → randare → variantă verticală + QA. Fără publicare. Fără MB1, îți spune exact ce lipsește și nu face niciun plan. |
| **Stop / „Preiau eu” / „Oprește tot”** | Operatorul se oprește imediat, iar planurile trec pe pauză. Nicio aplicație nu se închide forțat. Tastatura sau mouse-ul tău opresc helperul singure. |

### Câte confirmări

- **0** pentru acțiunile locale directe (deschide, adu în față, arată folderul), după ce aplicația e autorizată.
- **1** pentru orice plan cu mai mulți pași (import, corectură, captură + variantă, editare în Notepad), indiferent câte aplicații atinge.
- **Windows Hello** doar când cardul conține o decizie de acces nou (aplicație sau folder) și la autorizarea unei aplicații.
- Nimic nu-ți cere granturi, porți sau moduri.

### Ce aplicații controlează

Notepad, File Explorer, OBS Studio și CapCut. Toate patru sunt găsite și semnate pe PC-ul tău (verificat real, doar citire); **niciuna nu e încă autorizată**.

- **OBS:** se controlează prin API-ul său (start / stop / stare / scenă), nu prin clickuri.
- **CapCut:**
  - verificat cu helperul de test;
  - câte controale expune CapCut real afli la prima inspecție (`--capcut-inspect`);
  - exportul și publicarea nu se fac.

### Unde e clipul în Studio

- **Acum** e în `C:\Users\mihai\Videos\Ifrim Studio\M09 - Un plan, o confirmare\`, cu `proiect-studio.json` (pachetul complet al proiectului) și variantele randate din nou cu plăcuțe opace.
- **După upgrade:** Studio → Centrul de comandă → **Importă un proiect** → folderul de mai sus → **Importă** (o confirmare). Sau spune „Importă din folderul acesta” cu folderul deschis.
- **Pe Hub-ul live nu e încă:** Hub-ul live rulează M09, care nu are importul.

### Ce pași cer prezența ta

1. **Upgrade-ul:** `node v2/scripts/upgrade.mjs --apply`, sau o aprobare exactă către mine.
2. **Sesiunea:** Windows Hello.
3. **Autorizarea aplicațiilor:** o dată, cu Windows Hello.
4. **Demonstrațiile GUI reale:** ești la calculator.
5. **OBS:** activezi WebSocket-ul în OBS și setezi parola tu, apoi iei decizia MB1.
6. **Deciziile care rămân ale tale:** aprobarea creativă, MEDIA_C, pilotul ProDelivery / D6 / Demo B.

---

## Matricea aplicație × operație

| Aplicație | Operație | Clasa | Stare |
|---|---|---|---|
| Notepad | deschide / prim-plan | LOCAL_DIRECT | test fixture ✔ · live: la tine |
| Notepad | editare + Save As + verificare + reidentificare | PLAN_STEP | test fixture ✔ · live: `--notepad --watching` |
| Explorer | arată folderul aprobat | LOCAL_DIRECT | test fixture ✔ · live: la tine |
| Explorer | „folderul acesta” (citește locația) | LOCAL_DIRECT → plan | test fixture ✔ |
| Explorer | selectarea fișierelor | — | nesuportat (intenționat) |
| OBS | deschide / prim-plan | LOCAL_DIRECT | test fixture ✔ |
| OBS | înregistrare / stop / stare / scenă + import | PLAN_STEP (API) | OBS simulat ✔ · live: MB1 + WebSocket |
| CapCut | deschide / prim-plan | LOCAL_DIRECT | test fixture ✔ |
| CapCut | inspecție structurală | PLAN_STEP | test fixture ✔ · live: `--capcut-inspect` |
| CapCut | proiect nou + import | PLAN_STEP | test fixture ✔ · live: neverificat |
| CapCut | export / publicare | REFUSED | refuzat (politică + helper) |
| Toate | descoperire + semnătură | — | **real, doar citire ✔** |
| Toate | protocol / autoritate / scop | — | **helper real ✔** (M10-OR-01..03) |
| Studio | import proiect / reconstruire | PLAN_STEP | ✔ (ffmpeg real; pachetul real al clipului importat într-un Hub de test) |
| Studio | corectură = plan | PLAN_STEP | ✔ |
| Studio | variantă cu lizibilitate | PLAN_STEP | ✔ + randarea reală a clipului |
| Studio | export local | LOCAL_DIRECT | ✔ |

## Ce am construit

- **Operatorul desktop** (`M10_DESKTOP_OPERATOR.md`):
  - un helper C# compilat local, cu protocol semnat (HMAC, nonce, timp, autoritate cu termen, listă de aplicații fail-closed);
  - refuză aplicațiile protejate, fereastra Hub-ului, butoanele de publicare / plată / ștergere și desktopul securizat;
  - Stop pe firul de citire; se oprește la inputul tău; observă → acționează → verifică;
  - registru de aplicații cu stări separate (găsită → semnată → autorizată);
  - profiluri Notepad și CapCut;
  - bara permanentă de activitate și pagina „Operator”.
- **Autorizarea fără formulare** (`M10_AUTHORIZATION_UX.md`):
  - patru clase decise după efect: LOCAL_DIRECT / PLAN_STEP / SENSITIVE / REFUSED;
  - planuri cu o singură confirmare, reconstruite la confirmare și verificate prin hash;
  - autoritate derivată verificată la fiecare operație;
  - reluare doar în aceeași sesiune, cu reconcilierea pașilor incerți;
  - repornirea nu reia nimic;
  - aceeași semantică pentru voce și text.
- **Studio terminat** (`M10_STUDIO_COMPLETION.md`):
  - pachetul proiectului (export / previzualizare / import / reconstruire);
  - foldere de import contextuale;
  - `preferredTextTarget`, implementat de mine (selecția câștigă, eticheta nu e ghicită niciodată), plus selectorul „Textul vizat” și butoanele pentru clarificare;
  - lizibilitate: mărime minimă + plăcuță opacă ≥ 0,9 în variantele înguste, QA pe cadrul real;
  - aprobarea scopului capturii; OBS cu stare și reconciliere; configurarea OBS fără parolă;
  - export local fără suprascriere.
- **Backup obligatoriu înainte de migrare + runner de upgrade** (`RUNBOOK.md` → M10). Serverul refuză să migreze fără un backup verificat.

## Clipul M09 (LinkedIn ~21 s, suprapunerile pe vertical)

Am randat din nou toate variantele cu codul M10:

- textele de conținut au mărimea minimă lizibilă;
- textele au plăcuță opacă (≥ 0,9).

Prima randare M10 a arătat că plăcuța proprie a stilului (0,75) încă lăsa să se vadă rândurile UI de sub „Nimic nu se acceptă în locul tău.”. Am întărit-o și am randat din nou. Acum textul se citește clar.

Versiunile M09 anterioare sunt păstrate în subfolderul `anterior-M09\`.

## Teste

- **M10:** 53 de teste noi, toate PASS. Detalii în `M10_TEST_REPORT.md`.
- **Suita completă V2:** 912 teste · 911 PASS · 0 FAIL · 1 SKIP (40 min).
- **Suita V1:** 552 · 551 PASS · 0 FAIL · 1 SKIP. Cele două SKIP-uri sunt symlink-uri refuzate de Windows, ca în M09.
- **Defecte:** 8 defecte reale găsite și reparate, fiecare cu test. Cel mai important: helperul citea greșit tablourile JSON, ceea ce făcea verificarea aplicațiilor permise **fail-open**. L-am prins la prima rulare reală și l-am reparat fail-closed.

## Ce NU am făcut (intenționat)

- Nu am făcut upgrade-ul Hub-ului live și nu am autorizat aplicații.
- Nu am rulat acțiuni GUI pe desktopul tău: doar descoperirea, care e doar citire.
- Nu am pornit niciun model.
- Nu am făcut commit / push.
- Nu am acceptat sau respins pilotul / D6 / Demo B.
- Nu am atins proiectele tale CapCut.
- Nu am publicat nimic.
- Nu am instalat nimic nou: helperul se compilează cu compilatorul din Windows.
