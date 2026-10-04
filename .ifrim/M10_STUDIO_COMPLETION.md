# M10 — Studio terminat (utilizabil)

## 1. Importul proiectului (nu doar un MP4)

Modulul e `v2/server/media/project-bundle.mjs`, iar manifestul se numește `proiect-studio.json` (format `ifrim-studio-project` v1).

- **Exportul** scrie într-un folder:
  - proiectul: titlu, format, platforme, public, preset;
  - brief-ul, scripturile, storyboard-ul;
  - afirmațiile cu dovezile lor;
  - **toate versiunile de montaj** (IR complet, cu părinți și linii de variantă);
  - variantele;
  - sursele în `surse/`, cu sha256, mărime și drepturile lor.

  Un fișier identic deja prezent în `surse/` e refolosit, niciodată suprascris. Aprobările nu se exportă (`NOT_EXPORTED`). Comanda `media.project.export` scrie doar într-un folder aprobat (îl creează dacă lipsește, după ce verifică părintele real).
- **Previzualizarea** se face doar citind: manifestul e JSON și nu se execută niciodată.
  - Fiecare fișier trebuie să fie în folder, să fie un fișier obișnuit (fără linkuri) și să aibă sha256 și mărimea declarate.
  - Fiecare material folosit într-o versiune trebuie să fie în pachet.
  - Rezultatul arată:
    - formatul: pachet sau reconstruire;
    - fișierele verificate și versiunile;
    - etichetele păstrate, inclusiv SIMULATION;
    - ce lipsește și problemele găsite.
- **Importul** se face după o singură confirmare, în sesiunea de proprietar:
  - totul trece prin serviciile obișnuite (ingest în bibliotecă, drepturi cu sursa `project_import`, documente, versiuni de montaj, variante ca DRAFT);
  - id-urile sunt remapate;
  - etichetele și proveniența rămân;
  - **revizuirea creativă rămâne în așteptarea ta**.

  Reimportul aceluiași pachet e idempotent: același proiect, `duplicate: true`. Un fișier modificat după export e refuzat.
- **O livrare veche fără manifest** (planuri de montaj + surse) poate fi **reconstruită explicit**: proiectul primește sufixul „(reconstruit)”, iar ce nu se poate reface e listat (brief, scenariu, storyboard, planurile variantelor, legăturile afirmațiilor cu cadrele). Nu e prezentată niciodată ca import fără pierderi.

Unde se folosește:

- **în Studio:** Centrul de comandă → „Importă un proiect”;
- **prin Lega:** deschide folderul în Explorer și spune „Importă din folderul acesta”, apoi confirmi cardul.

**Clipul M09** are acum `proiect-studio.json` în `C:\Users\mihai\Videos\Ifrim Studio\M09 - Un plan, o confirmare\`. Pe Hub-ul live se importă după upgrade-ul la M10 (foaia de activare). Nu am importat nimic în Hub-ul live: acesta rulează încă M09 și nu are comenzile M10.

## 2. Foldere de import contextuale

Modulul e `v2/server/media/import-access.mjs`.

- **Previzualizarea folderului:** nume, tipuri, mărimi (cel mult 2 niveluri, 300 de fișiere). Conținutul nu se citește; fișierele cu aspect de secret (`.env`, chei, `.pem`, `.kdbx`…) sunt sărite și numărate.
- **Acces o dată:** legat de un plan sau de o comandă. Expiră (60 min implicit) și se consumă la import. Cât e activ, folderul apare printre rădăcinile de import, apoi dispare.
- **Folder permanent:** alegere explicită, cu **reautentificare proaspătă**. Sunt refuzate: un disc întreg, profilul, Desktop, OneDrive, Documents.
- **Refuzate mereu:** datele Hub-ului, repo-ul, `.codex`, `.claude`, `.ssh`, `AppData`, Windows, Program Files, căile UNC. Un folder care *conține* unul dintre acestea e refuzat la fel.
- **Un folder schimbat după previzualizare** primește `IMPORT_PREVIEW_CHANGED` și ți se arată din nou.
- Lista globală de foldere aprobate nu se lărgește ca să treacă un import.

## 3. Ținta corecturii: `preferredTextTarget` (implementat)

Implementarea e în `v2/server/media/review.mjs`:

- `preferredTextTarget(active, { selectedItemId, recentItemId })`;
- `parseInstruction(..., { selectedItemId, recentItemId })`.

Ordinea de alegere a textului vizat:

1. **Selecția ta** din Studio câștigă, chiar dacă e o etichetă: e alegerea ta.
2. Altfel, **singurul text de conținut** vizibil. Eticheta de dezvăluire (SIMULARE / RECONSTITUIRE / ACCELERAT…) nu e niciodată ghicită ca țintă.
3. Altfel, **ultimul text corectat** pe această versiune.
4. Altfel, **întrebare**, cu opțiunile (`options`) afișate ca butoane „Acesta: «…»”.

O selecție învechită (id-ul nu mai e în versiune) e ignorată, cu o notă.

În Studio există acum, lângă corectură, selectorul „Textul vizat”, care arată doar textele vizibile la acel moment și marchează etichetele.

## 4. Lizibilitate (LinkedIn ~21 s, suprapuneri pe vertical)

- **IR:** fiecare text poate avea `plate` (boolean) și `scale` (0,6–2).
- **Variantele înguste** (vertical, 4:5, pătrat): fiecare text **de conținut** (nu eticheta de dezvăluire) primește:
  - mărimea minimă lizibilă (4,2% din lățimea cadrului, ≈ 45 px la 1080);
  - **plăcuță opacă** (`plate: true`). Stilurile care au deja o cutie translucidă primesc cutia întărită: opacitate ≥ 0,9 și margine ≥ 1,4% din înălțime.

  Fiecare schimbare e înregistrată (`text_legibility`) și apare în diferențele variantei. `plate: false` pus explicit de tine e respectat.
- **QA de lizibilitate pe cadrul real** (`qa.mjs` → `legibility`): ffmpeg decupează zona textului și se măsoară fundalul **în jurul literelor găsite efectiv în cadru**, nu în dreptunghiul estimat.
  - Avertismente și erori:
    - `LOW_CONTRAST_TEXT`: eroare sub 3:1, avertisment sub 4,5:1;
    - `BUSY_BACKGROUND`: fundal agitat fără plăcuță;
    - opacitatea plăcuței **nu** se judecă dintr-un cadru: marginile literelor (anti-aliasing) domină o zonă strânsă, iar o primă încercare (`PLATE_TOO_TRANSPARENT`) dădea alarme false pe clipul real și a fost scoasă. Opacitatea ≥ 0,9 e garantată prin construcție, în filtrul ffmpeg (testul M10-ST-13).
  - E o euristică declarată: un cadru pe text.
- **Ce am verificat cu ochii:** la randarea M10 a clipului, LinkedIn 4:5 la 21 s are textul „Nimic nu se acceptă în locul tău.” mai mare. Prima randare a arătat că plăcuța stilului (0,75) încă lăsa să se vadă rândurile UI; am întărit-o și am randat din nou. Cadrele înainte/după sunt notate în `M10_REPORT.md`.

## 5. Backupul obligatoriu înainte de migrare (runner de upgrade)

Implementarea e în `v2/server/storage/db.mjs`, `v2/server/storage/upgrade.mjs` și `v2/scripts/upgrade.mjs`.

- **La pornire,** dacă baza există și are migrări în așteptare:
  - serverul face întâi `VACUUM INTO` într-un fișier nou din `<dataDir>/pre-upgrade/`;
  - verifică copia: `integrity_check`, versiunea de schemă, tabelele, sha256;
  - scrie un manifest (`wx`, nu se suprascrie niciodată) și abia apoi migrează.

  Dacă backupul eșuează, apare `PRE_MIGRATION_BACKUP_FAILED`: baza rămâne neatinsă și Hub-ul nu pornește. Raportul de pornire și evenimentul `storage.pre_migration_backup` arată backupul.
- **`node v2/scripts/upgrade.mjs`** are următoarele moduri:
  - `--plan`: doar citire, versiunile + dry run pe o copie;
  - `--apply`: pașii preflight → dry run → stop → build → start → verify, unde:
    - preflight refuză dacă rulează ceva: execuții, granturi, misiuni active, randări, sesiune desktop;
    - build construiește UI-ul pentru contractul nou și helperul desktop din sursă;
    - verify confirmă versiunea, contractul, backupul și numărul de rânduri;
  - `--resume`: continuă de la pasul eșuat; pașii făcuți nu se repetă;
  - `--abandon`.

  Starea e în `<dataDir>/upgrade/state.json` + `runs.jsonl`. Restaurarea nu e niciodată silențioasă: backupul e acolo, cu instrucțiunile din RUNBOOK.

## 6. Captura: aprobarea scopului și OBS

- **`media.capture.scope.approve`** e o comandă de proprietar, cu reautentificare proaspătă. Aprobă scopul **exact** al unei sesiuni de captură (sha-ul scopului, expirare 5–240 min). UI-ul, vocea fără sesiune și agenții sunt refuzați.
- **OBS WebSocket 5** (`capture.mjs`):
  - capacitățile se negociază din `GetVersion.availableRequests`, nu se presupun;
  - o înregistrare pornită de altcineva nu se preia și nu se oprește;
  - scena dedicată trebuie să existe deja (colecția ta de scene nu se modifică), iar scena anterioară se restaurează la stop;
  - un răspuns pierdut după Start/Stop se reconciliază din `GetRecordStatus`, fără un al doilea Start;
  - fișierul raportat de OBS se importă doar din folderul înregistrărilor aprobat.

  În planuri, pasul `capture.obs_record` autorizează și înregistrarea, și importul **înainte** de pornire; oprirea nu e refuzată niciodată.
- **Parola OBS** se scrie în cardul planului, rămâne doar în memorie și nu se stochează nicăieri. OBS WebSocket nu e expus workerilor.
- **Fără MB1** (captura live oprită), „Înregistrează demonstrația…” nu produce un plan: Lega spune exact ce lipsește.

## 7. Exportul local

`media.exportLocal` / comanda `media.export.local`:

- scrie în folderul exporturilor (implicit `<prima rădăcină de import>\Ifrim Studio\Exporturi`, care trebuie să fie într-un folder aprobat);
- nu suprascrie niciodată: același nume ocupat de alt fișier primește „(2)”, iar aceeași randare exportată din nou e același fișier;
- verifică sha după copiere;
- un nume nu poate ieși din folder;
- nu publică nimic.
