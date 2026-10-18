# Runbook — Ifrim Agent Hub V2

## Milestone 10 — Operatorul PC-ului, planuri fără formulare, Studio utilizabil (2026-10-04, versiunea `2.11.0-m10`, contract 10, migrarea 10; necomis)

Activarea completă e în `M10_ACTIVATION_SHEET.md`. Hub-ul live rulează M10 din 2026-10-04 13:53 UTC: `upgrade.mjs --apply`, rularea `upg_mutvrr79`. Backupul de dinainte de migrare e `pre-upgrade\hub-v2.pre-migration.v9-to-v10.2026-10-04T13-53-14-962Z.sqlite`.

### M10.2 — fluxul fără formulare (`2.12.0-m10.2`, migrarea 11)

Hub-ul live rulează M10.2 din 2026-10-05 la 04:57 UTC (rularea `upg_muus3hq2`). Backupul de dinainte de migrare e `pre-upgrade\hub-v2.pre-migration.v10-to-v11.2026-10-05T04-57-43-018Z.sqlite`.

**Proba (contoarele, doar citire):**

```bash
node v2/scripts/probe-m10-2.mjs --mark
node v2/scripts/probe-m10-2.mjs --since <seq>
```

**Dacă un plan spune „fac singur pregătirea după confirmare”:** după confirmarea ta, Hub-ul rulează verificarea contului sau re-atestarea pe aceeași amprentă (~2 min), apoi pornește. Dacă pregătirea eșuează, planul se închide cu explicația cinstită.

**Rollback** (doar cu decizia ta): fanionul `envelopeScopedLive=false` revine la comportamentul M10 al planurilor (modul global). Schema 11 rămâne; backupul de mai sus e restaurarea completă.

#### `2.12.1-m10.2` — închiderea P0 (contract 12, fără migrare)

Comis local ca `e1a2d0d` și activ pe Hub-ul live din 2026-10-06, 03:03 UTC (rularea `upg_muw3g5tp`). Comportamentele de mai jos nu au fost încă exersate live (NOT_RUN până la proba A–G). Detalii și deciziile D14–D23: `M10_2_REPORT.md` §11.

**După „Oprește tot”: cardul de rearmare**

- **Ce vezi.** Cât timp poarta e oprită de altceva decât pauza ta, cockpitul arată un banner (sub politica voice-first). Butonul „Arată cardul de redeschidere” doar îți arată cardul; nu confirmă nimic. „Redeschide poarta” scris aduce același card. O cerere de lucru nouă îl aduce legat de ea, ca să fie propusă din nou după redeschidere.
- **Ce scrie pe card:**
  - ce a oprit poarta: cine, când, de unde;
  - ce s-a oprit;
  - „Ce rămâne oprit”;
  - până când e valabil (5 minute);
  - evenimentele de securitate din jurul opririi, cele mai noi primele, dacă există.
- **Ce confirmi.** Butonul cardului, „Redeschide poarta (Windows Hello)”, sau Enter cu cardul selectat. Dacă ultima ta verificare e mai veche de 5 minute, apare Windows Hello o dată. Dacă sunt evenimente de securitate, bifezi întâi „Am verificat cauza”. Niciodată prin voce, de pe telefon sau printr-un agent.
- **Ce face.** Redeschide toată poarta și readuce Hub-ul în BUILD_SAFE, dacă nu era. Doar cererea care a afișat cardul revine, ca plan; planul cere confirmarea lui.
- **Ce rămâne oprit:**
  - misiunile anulate de Stop All rămân anulate;
  - autorizările revocate rămân revocate, iar planurile confirmate dinainte rămân închise („Stop All”);
  - cardurile de plan care așteptau confirmarea au fost închise de Stop All;
  - planurile de operare și sesiunea desktop oprite chiar de Stop All, plus misiunile rămase pe pauză sau oprite la poartă, pornesc abia când spui „Continuă” după redeschidere (misiunile anulate de Stop All rămân anulate);
  - cererile păstrate mai vechi nu sunt propuse din nou singure;
  - Lega nu pornește singură.
- **Când cardul refuză.** Nimic nu se redeschide singur. După ce cauza dispare, apeși „Verifică din nou”.

| Ce spune cardul | Ce faci |
|---|---|
| „Sesiunea vocală Lega e încă deschisă…” | Închizi Lega, apoi „Verifică din nou”. |
| „Încă se oprește o execuție…” sau „Misiunea … încă se oprește” | Aștepți confirmarea opririi, apoi „Verifică din nou”. |
| „…după o oprire neconfirmată (lease-uri reținute)…” | Cockpitul nu are încă eliberare pentru ele (limită cunoscută). E o operație de administrare separată, cu aprobarea ta: verificarea procesului rămas, apoi eliberarea lease-ului. Nici „Continuă”, nici `OPEN GATE` nu trec peste ele. |
| „Ai pus Hub-ul pe pauză din sesiunea ta…” | E pauza ta: spui sau scrii „Continuă”. Nu e nevoie de card. |
| „…înregistrează întâi autentificatorul…” | Lega → Configurare → Identitate, apoi revii la card. |
| „Între timp poarta a fost oprită din nou…” sau „…s-a schimbat ceva…” | Citești cardul nou și confirmi din nou. |

- **„Întâi redeschiderea porții”.** Apare când apeși „Continuă” pe cardul unui plan de operare, pe pagina Operator sau în bara desktop, pentru ceva oprit chiar de Stop All. Redeschizi poarta din cardul arătat, apoi „Continuă”. Planurile puse pe pauză din alt motiv se reiau ca înainte, chiar cu poarta oprită.
- **Calea de diagnostic.** `OPEN GATE` tastat în Integrări → Avansat există încă („Deschide poarta (diagnostic)”). Nu cere sesiunea ta și nu readuce BUILD_SAFE. Refuză o oprire aflată lângă un eveniment de securitate și lease-urile reținute. Pe traseul obișnuit nu o folosi: în proba M10.2 se numără ca schimbare manuală.

**„Continuă” rostit (condiții)**

Reia doar dacă sunt îndeplinite toate:

- sesiunea Lega a fost pornită din sesiunea ta de proprietar;
- filtrul vocal era pornit la începutul sesiunii și e pornit și acum;
- vocea e recunoscută local ca a ta (verificarea vorbitorului), iar transcrierea locală (whisper) e finală;
- ai spus propoziția întreagă și nimic altceva: „Continuă”, „Lega, continuă”, „Ok, continuă”, „Reia”;
- fraza nu a mai fost folosită: fiecare frază contează o singură dată.

Ce nu reia niciodată:

- „Continuă?” (o întrebare), „Da. Continuă.”, „Continuă. Mulțumesc.”;
- transcrierea providerului. Ea poate doar opri: dacă providerul a auzit „Continuă?”, nu se reia nimic.

De știut:

- Face exact ce face „Continuă” scris: redeschide pauza ta și reia ce era oprit.
- După „Oprește tot”, vocea nu redeschide poarta. Lega e închisă de Stop All, iar redeschiderea se face doar din card.
- Dacă un plan își așteaptă răspunsul rostit, el are prioritate: spui „Da, execută planul” sau „Nu acum”.
- După un plan expirat, „Continuă” îți arată fraza potrivită: Reia misiunea „X”.
- Cu filtrul vocal oprit, Lega spune cinstit că filtrul e oprit și că ia „Continuă” scris, în cockpit.

**Upgrade la `2.12.1-m10.2` (fără migrare)**

```bash
node v2/scripts/upgrade.mjs --plan      # doar citire: versiunea și contractul codului, dry run (nicio migrare în așteptare)
node v2/scripts/upgrade.mjs --apply     # preflight → dry run → stop → build (UI + helper) → start → verify
node v2/scripts/status.mjs              # version, apiContract, mode, gate
```

- **Nu se face backup automat.** Serverul face backupul de dinainte de migrare doar când baza are migrări în așteptare. Schema rămâne 11, deci ultimul backup automat e cel de la M10.2 (v10 → v11).
- **UI-ul se reconstruiește pentru contractul 12**, de către runner, după oprirea Hub-ului. Nu rula `npm run build:v2` de mână cât timp Hub-ul vechi rulează: o pagină pentru contractul 12 nu poate comanda un server cu contractul 11.
- **Verificarea versiunii.** Runner-ul verifică singur că Hub-ul servește `2.12.1-m10.2` cu contractul 12. BUILD_SAFE și starea porții le vezi cu `status.mjs` (`mode`, `gate`).
- **Un tab deschis dinainte** arată „Interfață veche”: reîncarci pagina. Până atunci comenzile sunt oprite; Stop și Pauză merg.
- **O poartă oprită înainte de upgrade** prin Stop All sau printr-o suspendare nu are înregistrat cine a oprit-o. Cardul o arată ca „suspendată (originea opririi nu a fost înregistrată)” și o poate redeschide la fel. O pauză a ta dinainte rămâne pauza ta: „Continuă”.
- **Un card de plan rămas neconfirmat peste upgrade** poate fi refuzat la confirmare, fiindcă planul afișat nu mai corespunde (cardul nu mai promite preview / E2E inexistente): îl ceri din nou.
- **Preflight-ul refuză** cât timp rulează ceva: o execuție, un grant activ, o misiune în lucru, o randare sau o sesiune desktop.
- **Rollback:** codul `2.12.0` nu există separat, nici pe disc, nici ca commit (M10.2 și închiderea P0 intră în același commit). Revenirea se face prin corectură înainte; fanionul `envelopeScopedLive=false` de mai sus rămâne disponibil. Baza de date nu se schimbă la acest upgrade.

**Pornirea Lega: verificarea automată a contului (D23)**

- Dacă verificarea contului Codex e învechită, pornirea Lega din sesiunea ta o reface singură, o dată per pornire. E aceeași verificare fără inferență ca butonul „Verifică contul”.
- Previzualizarea pornirii rămâne doar citire. Arată o astfel de verificare ca „verific singur la pornire”, nu ca blocaj.
- Dacă verificarea eșuează, cauza e arătată cinstit. „Verifică contul” (Integrări) rămâne calea manuală.
- D23 privește doar verificarea de cont învechită. Celelalte blocaje ale pornirii (poarta, acordul, declarația Codex, limita de porniri) sunt cele descrise la M10.1.
- Verificarea contului Claude nu ține de pornirea Lega. O reface pregătirea automată, fără inferență, când ceri un plan și doar pașii automați îl mai blochează.
- Testele D23: `v2/tests/m10-2-p0-lega-autoprobe.test.mjs` (17). „Oprește” în timpul verificării automate anulează pornirea înainte de orice grant sau apel GPT-Live.

**„Rulează pașii automați”: unde e și ce face**

- Butonul e pe **Lega → Configurare** (`#/lega/setup`, panoul „Pașii”), nu în Sistem → Medii. Unele note mai vechi îl plasau greșit acolo. Apare doar când există pași automați în așteptare.
- Rulează, în ordine și fără model: backupul Hub-ului (dacă nu există unul verificat din ultimele 24 h), inspecția mediului `ifrim-runner`, verificarea conturilor prin mediu (Codex C16 și reviewer-ul Claude), atestarea.
- Din 2.12.1, pasul de atestare **re-atestă doar aceeași amprentă** ca ultima atestare trecută, verificată pe o inspecție proaspătă. Pentru prima atestare sau pentru o amprentă nouă, pasul arată „decizie separată (Sistem → Medii)” și nu atestă nimic.
- **Sistem → Medii** are butoanele lui, separate: „Inspectează”, „Verifică contul prin mediu (C16)” și „Rulează atestarea C1–C17”.

### După un restart al PC-ului (pornire automată la logare)

Din 2026-10-04, Hub-ul V2 pornește singur la logarea în Windows, după boot sau restart. Îl pornește sarcina programată **„Ifrim Agent Hub V2”**:
- rulează ca utilizatorul tău, fără parolă stocată și fără drepturi de administrator, la 45 s după logare;
- pornește Hub-ul doar dacă nu răspunde nimic pe 8011, deci nu oprește și nu repornește niciodată un Hub care rulează;
- Hub-ul pornește în BUILD_SAFE, fără model și fără sesiune Lega.

Comenzi:

```bash
powershell -ExecutionPolicy Bypass -File "v2\scripts\autostart.ps1"
powershell -ExecutionPolicy Bypass -File "v2\scripts\autostart.ps1" -Install
powershell -ExecutionPolicy Bypass -File "v2\scripts\autostart.ps1" -Uninstall
```

(stare / instalare sau actualizare / ștergere)

- **Jurnal:** `%USERPROFILE%\IfrimHub\autostart.log`. Detaliile pornirii sunt în `v2-hub.log`, din folderul de date.
- **Sarcina V1 „Ifrim Agent Hub”** (tray, porturile 3004/8004) e separată și neatinsă.
- **Pornire manuală:** `powershell -ExecutionPolicy Bypass -File "v2\scripts\start-detached.ps1"`.
- **Verificat pe 2026-10-04:**
  - rulată cu Hub-ul pornit: „deja pornit”, rezultat 0, un singur Hub;
  - rulată după `stop.mjs`: Hub-ul a pornit în ~6 s (`2.11.1-m10`, BUILD_SAFE) și a rămas pornit după terminarea sarcinii.
  - Declanșatorul real de logare confirmat: după repornirea PC-ului din 2026-10-05 de la 06:34 UTC, Hub-ul a pornit singur la 06:36 UTC (`2.12.0-m10.2`, BUILD_SAFE).

### M10.1 — Lega dintr-un click (`2.11.1-m10`, fără migrare)

**Aplicat live pe 2026-10-04 la 18:12 UTC** (rularea `upg_muu51x09`). Pentru un upgrade viitor fără migrare, aceeași comandă:

```bash
node v2/scripts/upgrade.mjs --plan
node v2/scripts/upgrade.mjs --apply
```

Runner-ul oprește Hub-ul, reconstruiește UI-ul, pornește Hub-ul și verifică versiunea `2.11.1-m10`.

După repornire, „Pornește Lega” cere cel mult o confirmare Windows Hello, dacă sesiunea nu e deschisă. Nu mai trebuie mod sau grant. Dacă Lega refuză, panoul numește blocarea reală:
- poarta (după Stop All);
- acordul;
- declarația Codex;
- limita de 6 porniri / 15 min.

Detalii: `M10_LEGA_ZERO_FORM.md`.

### Upgrade (de acum înainte, pentru orice migrare)

```bash
node v2/scripts/upgrade.mjs --plan      # doar citire: versiuni + dry run pe o copie
node v2/scripts/upgrade.mjs --apply     # preflight → dry run → stop → build (UI + helper) → start (backup automat) → verify
node v2/scripts/upgrade.mjs --resume    # continuă de la pasul eșuat
```

- **Backupul de dinainte de migrare** e făcut de server, nu de script. La pornire, dacă baza are migrări în așteptare, se face `VACUUM INTO <dataDir>\pre-upgrade\hub-v2.pre-v<N>-<data>.sqlite` și copia e verificată (integritate, versiune, tabele, sha256). Manifestul `.manifest.json` nu se suprascrie niciodată. Fără backup, Hub-ul refuză să pornească (`PRE_MIGRATION_BACKUP_FAILED`) și baza rămâne neatinsă.
- **Starea runner-ului:** `<dataDir>\upgrade\state.json` + `runs.jsonl`.

### Rollback (manual, niciodată automat)

1. Oprește Hub-ul: `node v2/scripts/stop.mjs`.
2. Păstrează baza curentă: mut-o, nu o șterge.
3. Copiază backupul din `pre-upgrade\` peste `hub-v2.sqlite` și verifică sha256 cu manifestul.
4. Revino la codul M09 cu git (`git stash` sau checkout pe commitul M09) și pornește Hub-ul.

Backupul pre-M09 rămâne separat: nu e suprascris.

### Operatorul desktop

- **Helperul:** `<workDir>\desktop\IfrimOperator.exe` + `IfrimOperator.manifest.json`. Îl construiește upgrade-ul sau `node v2/scripts/build-operator.mjs`. Hub-ul refuză un binar care nu corespunde manifestului și sursei (`OPERATOR_NOT_READY`).
- **Stop:** bara de sus → Stop / Preiau eu, „Oprește tot”, Stop All sau `/api/desktop/stop` (fail-safe, fără sesiune). Aplicațiile rămân deschise.
- **Un helper blocat:** Stop și apoi repornirea Hub-ului. La pornire, sesiunea desktop se încheie și planurile care rulau trec în `NEEDS_OWNER`; nimic nu se reia singur.
- **Verificare fără desktop:** `node v2/tests/manual/m10-desktop-real.mjs --discover`.
- **Demonstrații GUI reale** (ești la calculator): `--open notepad --watching`, `--notepad --watching`, `--capcut-inspect --watching`.

### Comenzi de test

```bash
node --test v2/tests/m10-desktop.test.mjs v2/tests/m10-ops-plans.test.mjs v2/tests/m10-studio.test.mjs v2/tests/m10-upgrade.test.mjs v2/tests/m10-operator-real.test.mjs
```

Testele de browser M10 rulează pe UI-ul construit separat: `HUB_V2_WEB_DIST=.ifrim/tmp/m10-web-dist node --test v2/tests/m10-ui-e2e.test.mjs`.

### Incidente M10

- **Un plan oprit (`NEEDS_OWNER`):** cardul sau pagina Operator arată motivul. „Continuă” verifică întâi pașii incerți. Dacă rezultatul unui pas nu se poate stabili (`OUTCOME_UNKNOWN`), verifici tu în aplicație și apoi anulezi sau reiei.
- **O aplicație actualizată:** după o actualizare, aplicația își pierde autorizarea (binar nou). Pagina Operator → Caută aplicațiile → Autorizează.
- **Un folder de import greșit:** pagina Operator → Foldere de import → Retrage (fail-safe).

## Milestone 09 — Content Studio (2026-10-04, versiunea `2.10.0-m09`, contract 9, migrația 9; necomis)

Trecerea Hub-ului live pe M09 și pachetele de decizie sunt în `M09_LIVE_VALIDATION_PLAN.md`. Pe scurt: dry-run pe copie → stop → `npm run build:v2` → start → status. Fără model.

### Unde stau lucrurile

- **Biblioteca media:** `<dataDir>/v2-media`, adică `C:\Users\mihai\IfrimHub\hub-data\v2-media` pe Hub-ul live. Nu stă în repo și nici în OneDrive.
- **Lucrul temporar:** `<workDir>/media`. Încărcările trec prin `<workDir>/media-uploads` și se șterg după import.
- **Livrabilele exportate de mână** (primul clip): `C:\Users\mihai\Videos\Ifrim Studio\`.
- **Uneltele:** ffmpeg și ffprobe de pe PATH (8.1.x). Versiunea și sha256 se fixează la prima folosire verificată (`settings.mediaToolPins`). Un binar schimbat dă avertismentul `tool_changed`, niciodată o tăcere.
- **Politica media** (`settings.mediaPolicy`): `autoPublish`, `liveUpload` și `liveCapture` sunt `false`. `importRoots` nu e setat, deci se folosește implicit folderul `%USERPROFILE%\Videos` (`C:\Users\mihai\Videos`). Cât timp nu alegi altele, acesta e singurul folder din care se poate importa după cale.

### Comenzi

```bash
node --test v2/tests/m09-review-fixes.test.mjs     # regresiile review-ului M09 (fără model)
node --test v2/tests/m09-media-render.test.mjs     # randare reală prin proxy-ul ffmpeg (SKIPPED_ENV fără ffmpeg)
node v2/tests/manual/m09-clip-capture.mjs <dir>    # captura demo a unui Hub DE TEST (Chromium, date sintetice)
node v2/tests/manual/m09-clip-produce.mjs <dir> <livrare>   # producția completă a clipului pe un Hub de test
```

Testele care folosesc ffmpeg real rulează binarul prin `v2/tests/fixtures/ffmpeg-proxy.mjs`, pentru că supervizorul în modul test pornește doar node și fixture-uri.

### Incidente Studio

- **O randare blocată:**
  - Studio → Randări → „Anulează”. Ruta `/api/media/renders/:id/cancel` e fail-safe și merge și cu un UI vechi.
  - La repornire, joburile în lucru devin INTERRUPTED și nu se reiau singure. „Reîncearcă” refolosește segmentele din cache.
- **Disc plin:** randarea refuză sub rezerva liberă (`DISK_RESERVE`). Curățarea atinge doar derivatele regenerabile și pornește implicit ca simulare. Originalele și copiile A3 nu se șterg.
- **Un drept retras:** „Revocă” (fail-safe, inclusiv prin voce) arată inventarul și planul de corectare. Manifestele aprobate care folosesc materialul devin INVALIDATED pe loc, iar pachetele lor deschise sunt retrase. Postările deja făcute le retragi tu manual: Hub-ul nu șterge nimic de pe platforme.
- **Captura live pornită din greșeală:** „Oprește captura live” (`/api/media/policy/capture-off`), fail-safe de pe orice canal.

## Milestone 03 — Software Factory și pregătirea runtime-ului (2026-10-01, versiunea `2.4.0-m03`)

### Comenzi noi

```bash
npm run v2:factory-fixture -- bug-demo          # creează și înregistrează „Factory Demo A (bug)” (ifrim-factory-demo-a) — făcut 2026-10-01
npm run v2:factory-fixture -- service-request   # „Factory Demo B (feature)” (ifrim-factory-demo-b, preview pe 4610) — făcut 2026-10-01
node v2/tests/manual/codex-sandbox-timing.mjs --fictive        # durata sandbox-ului Codex fără model (arbore din %TEMP%)
node v2/tests/manual/codex-sandbox-timing.mjs --real-profile   # TU: profilul real (reaplică DENY-urile consimțite)
node v2/tests/manual/codex-sandbox-canary.mjs   # izolare pe arbore fictiv: R3 (DENIED) și R2 (KNOWN_GAP_R2) — PASS_LOCAL 2026-10-01
node --test v2/tests/m03-browser.test.mjs       # browserul real (Playwright 1.61.0): inspecție izolată + E2E
```

### Browser și E2E (Playwright 1.61.0, instalat 2026-10-01)

- Instalat ca devDependency, fără descărcare de browser: folosește Chromium 1228 din `%LOCALAPPDATA%ms-playwright`. Dezinstalare: `npm uninstall playwright`.
- Chromium pornește cu sandbox-ul OS activ, într-un context nou, fără profil. Ajunge doar la originea aprobată (proxy mort pentru rest).
- **Browser Workspace (Unelte):** fiecare inspecție cere în continuare aprobare pe URL-ul exact.
- **Software Factory:** un criteriu `verify: "e2e"` cu `steps` rulează după preview, pe versiunea verificată. Pașii permiși: `viewport`, `goto` (cale relativă), `fill`, `select`, `click`, `expectText`, `expectSelector`, `noHorizontalOverflow`. Un pas care pică devine finding și intră în remediere. Captura rămâne ca dovadă în `.ifrim/tmp/v2/factory/<misiune>/e2e/`.

### Software Factory

- **Misiuni → „Lucrare de engineering”:** proiect, tip (bug / feature / refactor), cerință, criterii, comenzi. Rezultatul e o misiune cu specificația v1 (ciornă). Nimic nu rulează.
- **Pe pagina misiunii:**
  - completezi specificația: criteriile cu fișierul testului de acceptanță, care trebuie să existe deja, și comenzile;
  - apeși „Cere aprobarea scope-ului”, apoi „Aprobă și pornește”.
- **Ce face Hub-ul apoi:**
  - baseline (testele de acceptanță trebuie să pice la bug / feature și să treacă la refactor);
  - implementare (Codex);
  - verificări (runner prin sandbox);
  - review (Claude doar-citire);
  - cel mult 2 remedieri;
  - QA, preview, pachet.
- **Fiecare execuție trece prin poartă, cu grantul ei.** Granturile necesare sunt afișate pe misiune: Codex scriere și Claude citire, fiecare cu încercări = 1 + numărul de cicluri de remediere.
- **Butoane:** Pauză / Stop / Reia; „încă un ciclu” și „QA după review neconcludent” sunt doar decizii ale tale.
- **„Accept local”** reverifică workspace-ul față de versiunea testată. Nu face commit, push sau deploy.
- **Simulator (8012):** butoanele „Fabrica A/B/C” pregătesc o misiune pe un fixture. Aprobi tu scope-ul.

### Izolare R2/R3 (vezi `M03_RUNTIME_READINESS.md`)

- **R3:** lista Codex neagă acum și `~/.codex/config.toml`, `config.toml.*` și `history.jsonl`. Acordul ACL pe lista nouă a fost dat din UI pe 2026-10-01 (amprenta `0f5b7efee0143fa8`). Dacă lista se schimbă din nou, poarta refuză Codex până la un acord nou.
- **R2 rămâne deschis:**
  - Codex rulează fără condiții doar pe proiecte de test;
  - pe un proiect real, numai cu acceptarea ta din Integrări → Izolare → R2 (text exact, cel mult 7 zile, retragere și din voce).

### Model și efort

- Fiecare execuție trimite explicit modelul (din `model/list`) și efortul (profil BALANCED = `medium`, sau alegerea ta).
- Un efort sau un model raportat diferit oprește execuția înainte de turn.
- „Verifică contul” trebuie să fi salvat lista de modele: acum o cere implicit, fără inferență.
- Inspectorul arată planul și timpul pe faze pentru fiecare execuție.

## Milestone 02 + Lega (2026-09-30, actualizat 2026-10-01, versiunea `2.3.0-m03`)

### Comenzi

```bash
npm run build:v2       # după orice modificare de UI
npm run v2             # Hub real: http://127.0.0.1:8011/ (pornește mereu în BUILD_SAFE)
npm run v2:status
npm run v2:stop
npm run v2:sim         # SIMULATOR: http://127.0.0.1:8012/ — „SIMULARE — FĂRĂ MODELE REALE”
npm run v2:sim:stop
npm run test:v2        # teste V2, fără modele (249 de teste la 2026-10-01)
npm run v2:test-project # creează și înregistrează proiectul de TEST sanitizat (Ifrim Digital Proiecte/ifrim-hub-live-test)
node v2/tests/manual/codex-sandbox-canary.mjs   # izolarea Codex pe fișiere fictive din %TEMP% (fără model)
node v2/tests/manual/lega-mcp-preflight.mjs     # verifică, fără model, că niciun server MCP nu rămâne activ pentru Lega
```

Opțional, doar în terminalul tău (schimbă ACL-uri reale, fără model): `node v2/tests/manual/codex-real-profile-preflight.mjs`. Stratul local de permisiuni nu îl lasă pe Claude să-l ruleze.

### Simulatorul

- Proces separat, cu date recreate la fiecare pornire în `.ifrim/tmp/v2-sim/data`.
- Rulează pe un proiect demo git sintetic, creat de `v2/scripts/sim-demo.mjs`.
- Folosește doar fixture-uri Codex/Claude: nu poate porni un model real și nu atinge DB-ul, poarta sau grant-urile Hub-ului real.
- Scenarii: butoanele din bannerul simulatorului (Execuție, Aprobare, Cotă, Eroare auth, Handoff, Deconectare; pe desktop). Echivalent în API: `POST /api/sim/{execute|approval|quota|error|handoff|drop-stream}`, cu token-ul sesiunii.
- „Eroare auth” produce o eroare reală de autentificare. **Trei click-uri** pe „Eroare auth” deschid circuit breaker-ul Codex pentru **10 minute**: în acest timp poarta simulatorului refuză execuțiile Codex. Repornirea simulatorului (`npm run v2:sim:stop`, apoi `npm run v2:sim`) îl resetează.

### Izolare

- Integrări → „Izolare workspace” arată ce nu pot citi uneltele modelului și starea fiecărui traseu.
- Codex pe Windows cere acordul pentru ACL-urile persistente scrise de sandbox. Detalii în `M02_SECURITY_READINESS.md`. Pe acest PC acordul e înregistrat, iar ACE-urile DENY există pe căile protejate.
- Revenire pentru o cale: `icacls "<cale>" /remove:d CodexSandboxUsers`.
- Validarea live din `M02_LIVE_VALIDATION_PLAN.md` a fost făcută pe 2026-09-30, pe proiectul de test: Claude read-only PASS_LIVE; Codex FAIL la 14:41 (corectat), apoi PASS_LIVE de două ori. Preflight-ul real nu a rulat (opțional, vezi mai sus).
- Fiecare proces Codex al Hub-ului rulează cu pluginurile oprite și cu fiecare server MCP din config-ul tău dezactivat pe nume. Execuția e refuzată înainte de pornire dacă proiectul are `.codex/config.toml` sau dacă un server nu poate fi dezactivat. Un apel MCP în timpul turnului oprește execuția.
- Prima comandă dintr-o execuție Codex poate întârzia ~8 minute (pregătirea ACL a sandbox-ului Windows). Nu e o blocare.

### Scurtături UI

| Scurtătură | Acțiune |
|---|---|
| Ctrl+K | paletă |
| Alt+M | mini-asistent |
| Alt+L | panoul Lega |
| Alt+J | Modul Lega (ecran complet); Esc îl închide |
| Alt+1…9 | navigare (cifra apare în tooltip și în paletă) |
| Ctrl+Enter | trimite din compozitor |
| Esc | închide dialogul sau paleta |

Scurtăturile nu sunt interceptate cât scrii într-un câmp. Merg doar cu Alt simplu: AltGr, IME și numpad sunt ignorate, deci tastarea pe tastatura românească nu schimbă ecranele.

### Lega (asistentul vocal)

Detalii complete în `LEGA.md`.

- **Pornire** (de fiecare dată după un restart, pentru că Hub-ul revine în BUILD_SAFE):
  1. Integrări → Validare live: tastează `LIVE_VALIDATION` → Activează;
  2. tastează `OPEN GATE` → Deschide poarta;
  3. Grant nou → Tip „Lega (voce)” (de exemplu 3 sesiuni, 1200 s) → Creează;
  4. butonul **Lega** din bara de sus sau **Alt+L** → acordul Lega (o dată) → alege vocea → **Pornește Lega** și permite microfonul.
- **Ecran complet:** Alt+J, butonul „Modul Lega” din Control Room sau „Ecran complet” din panoul Lega. Esc închide.
- **Oprire:**
  - „**Lega, oprește tot**” (sau „oprește tot”) = Stop All: suspendă poarta, revocă grant-urile, întrerupe execuțiile și oprește și Lega;
  - un „**oprește**” simplu (sau „stop”) oprește **doar vocea** Lega, nu și restul;
  - „Taci” oprește microfonul.
- **Căutare pe internet** (setare în panoul Lega, se aplică la următoarea pornire): `cached` (implicit, recomandat: index OpenAI, fără pagini live), `indexed`, `live` (risc mai mare, cu avertisment) sau `Oprită`. Doar Lega o primește; execuțiile agenților rămân fără căutare web.
- Vocea nu aprobă nimic. Tot ce are efecte cere click-ul tău.

### Aprobări și execuții pe proiecte

- **Aprobă și pornește:** o comandă propusă (de exemplu o execuție propusă de Lega) se aprobă și pornește într-un singur click, în ecranul Aprobări.
- **„Aprobate, încă nepornite”:** secțiune vizibilă în ecranul Aprobări, cu butonul „Pornește acum”. Apar aici și scripturile npm și verificările de browser aprobate. Dacă pornirea eșuează, apare un toast cu motivul.
- **„Permite execuții”** (pe pagina proiectului, panoul „Execuții pe acest proiect”): tastezi numele exact al proiectului și apeși butonul. Fără asta, agenții nu pot rula pe un proiect nou. „Retrage execuțiile” e un singur click și revocă grant-urile de execuție ale proiectului. Fiecare execuție cere în continuare grant, poarta deschisă și backup verificat.
- Atenție înainte de proiecte reale (de exemplu ProDelivery): Codex poate citi, pe cale absolută, fișierele neprotejate ale altor proiecte, inclusiv `.env`-ul lor. Decizia R2 e deschisă (`OPEN_ISSUES.md`).

## Cerințe

Node 24 (testat 24.14.0), dependențele din repo (`npm install` deja făcut). Codex desktop (pentru `codex.exe`) și Claude Code npm sunt opționale; fără ele, rutele respective apar „neinstalat”.

## Pornire / oprire / stare

```bash
npm run build:v2      # construiește UI-ul (o dată după modificări de UI)
npm run v2            # pornește Hub-ul în fundal pe http://127.0.0.1:8011/
npm run v2:status     # PID, mod, poartă
npm run v2:stop       # oprire grațioasă; refuză dacă rulează execuții (adaugă --force pentru a le întrerupe)
```

- Log: `.ifrim/private/v2-hub.log` (rotit la 5 MB, 3 fișiere). PID: `.ifrim/private/v2-hub.pid.json`.
- Dezvoltare UI: `npm run dev:v2:web` → http://127.0.0.1:3011 (proxy către 8011).
- Teste: `npm run test:v2` (serial, izolat, fără modele).
- Verificare manuală handshake Codex real, fără credențiale: `node v2/tests/manual/codex-handshake-fresh-home.mjs`.

Nu se instalează niciun serviciu Windows și nicio pornire automată. V1 (3004/8004, tray, task programat) rămâne cum era.

## Primul drum (fără model)

1. Deschide http://127.0.0.1:8011/ → Control Room (BUILD_SAFE, poartă suspendată).
2. Integrări → „Inspectează instalarea” la ambii provideri.
3. Integrări → Claude „Verifică contul” (local). Codex „Verifică contul” contactează OpenAI cu contul tău, fără turn și fără inferență; decizia îți aparține.
4. Setări → Backup verificat acum.
5. Conversații → conversație nouă → mesaj → „Rulează” → poarta refuză și arată de ce. Este comportamentul corect în BUILD_SAFE.

## Validare live (doar cu aprobare explicită)

1. Integrări → înregistrează confirmarea manuală de facturare pentru provider (textul exact afișat).
2. Integrări → tastează `LIVE_VALIDATION` → „Activează LIVE_VALIDATION”.
3. Integrări → grant: provider, acces „doar citire”, 1 încercare, 30 min, cu scop scris. Pentru un proiect nou: întâi „Permite execuții” pe pagina proiectului.
4. Tastează `OPEN GATE` → „Deschide poarta”.
5. Rulează din conversație sau pornește o execuție propusă cu „Aprobă și pornește”. Hub-ul creează backup-ul verificat automat dacă e nevoie.
6. După test: Stop All sau „Suspendă poarta” și „Revino la BUILD_SAFE”. Orice restart revine oricum la BUILD_SAFE.

Starea la 2026-10-01: Hub `2.3.0-m03`, BUILD_SAFE, poarta de execuție deschisă (așa ai lăsat-o pentru Lega), 0 grant-uri active, nicio execuție și nicio sesiune Lega activă.

## Incidente

- **Stop All** (buton roșu sau vocea „Lega, oprește tot” / „oprește tot”): suspendă poarta, revocă grant-urile, întrerupe execuțiile controlabile, oprește Lega și raportează separat taskurile cloud (nu există) și efectele ireversibile. Un „oprește” simplu, spus lui Lega, oprește doar vocea, nu face Stop All.
- **Lease reținut** după crash: vezi Sănătate → Recuperare. Verifică procesul raportat, apoi reconciliază înainte de a redeschide poarta (poarta refuză deschiderea cât timp există lease-uri reținute).
- **Hub nu pornește**: citește logul; verifică portul cu `npm run v2:status`. Nu opri procese pe care V2 nu le-a pornit.
- **Restaurare**: `.ifrim/V2_BACKUP_RESTORE.md`.

## Cutover V1 → V2 (decizia ta)

V2 rulează pe 8011 lângă V1. Pentru a-l muta pe 3004/8004: oprește tray-ul și procesele V1, apoi `HUB_V2_PORT=8004 npm run v2` sau actualizează portul în `v2/server/config.mjs`/`v2/scripts/common.mjs`, apoi actualizează `PORTS.md` (global, doar cu acordul tău). OpenClaw Gateway (PID 23596) și taskul programat Windows rămân de decis separat.
