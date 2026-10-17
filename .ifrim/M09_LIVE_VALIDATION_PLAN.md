# M09 · Plan de activare și validare live

Data: 2026-10-04. Nimic din acest plan nu a fost executat. Fiecare pas cere aprobarea ta pentru acel pas exact. Aprobările din milestone-urile vechi nu se importă.

## 0. Starea de azi

**§1 a fost executat pe 2026-10-04, 07:20–07:24 UTC,** de Claude, la cererea ta („fă tu pașii de trecere pe M09”). Hub-ul live rulează acum `2.10.0-m09` (contract 9, migrația 9), în BUILD_SAFE, cu 0 granturi și 0 rulări.

Pașii executați:
1. **Pre-flight (doar citire):** 0 rulări active, 0 granturi active, nicio misiune în lucru. Misiunile fabricii: DELIVERY_READY 3, ACCEPTED 2, CANCELLED 2, SPEC_DRAFT 1.
2. **`migration-dry-run.mjs` pe o copie:** 8 → 9, `m09Complete: true`, `m08Complete: true`, integritate ok, rânduri neschimbate (47 agent_runs, 9 missions, 8 factory_missions, 3201 events, 17 settings, 36 live_grants), 61 ms.
3. **`stop.mjs`:** oprire grațioasă.
4. **Backup coerent al bazei (Hub oprit, API-ul de backup SQLite):**
   - fișierul: `C:\Users\mihai\IfrimHub\hub-data\private\pre-upgrade\hub-v2.pre-m09.2026-10-04T07-23-05-815Z.sqlite`;
   - 6.967.296 B, sha256 `3f90d2bc750ae930c0c1c27ca06dc463bf34d243fe1c28f68cc493045b385651`, schema 8, 114 tabele, integritate ok.
   - Hub-ul **nu** face singur un backup înainte de migrare; acesta e backup-ul pentru revenire.
5. **`npm run build:v2`:** `v2/web/dist` are acum UI-ul contract 9, cu aceleași hash-uri ca build-ul pe care au rulat testele (`index-B_8OTl3o.js`, `Studio-BlRUkEmG.js`).
6. **`start-detached.ps1`:** `2.10.0-m09`, BUILD_SAFE, contract 9.
7. **Verificări (doar GET):**
   - health 9;
   - boot: 5 preseturi media inserate, 0 lucrări întrerupte, conversia facturării `converted: [codex, claude]`;
   - **Claude `reverify_required`** (`latched`, `legacy_unbound`), ruta blocată; Codex `valid`;
   - politica media: `autoPublish`, `liveUpload`, `liveCapture` = false;
   - biblioteca în `hub-data\private\v2-media` (nesincronizată, ~98 GB liberi);
   - UI 200 cu bundle-ul nou; log fără erori.

Poarta de execuție a rămas `open` (cum era înainte de trecere). Modul BUILD_SAFE nu permite oricum inferența. Nu am schimbat-o.

**Rămâne necomis:** codul M09 și documentele.

## 1. Trecerea pe M09 (fără model, câteva minute)

Ordinea contează. Fiecare comandă se rulează din rădăcina repo-ului:

```
node v2/scripts/migration-dry-run.mjs
```
Rulează pe o **copie** a bazei: schema 8 → 9, `m09Complete: true`, integritate ok, număr de rânduri neschimbat. Dacă raportul nu e curat, te oprești aici.

```
node v2/scripts/stop.mjs
```

```
npm run build:v2
```
Reconstruiește `v2/web/dist` pentru contractul 9. Dacă îl rulezi înainte de oprire, pagina deschisă primește 409 UI_STALE pentru scrieri până la repornire. Stop, pauza și revocarea merg oricum.

```
powershell -ExecutionPolicy Bypass -File v2\scripts\start-detached.ps1
```
La pornire se aplică migrația 9. Conversia dovezilor de facturare rulează o singură dată.

```
node v2/scripts/status.mjs
```
Trebuie să arate `2.10.0-m09`, contract 9, BUILD_SAFE și 0 granturi.

**Ce se schimbă imediat după repornire:**

1. **Claude e blocat pentru inferență** până declari din nou (§2). E intenționat: declarația veche nu avea cont și nici expirare.
2. **Codex rămâne utilizabil** până la expirarea declarației lui, pentru că Hub-ul îi verifică automat creditele.
3. **Pagina Content Studio** (`#/studio`) apare în meniul principal și se deschide din cockpit-ul Lega cu „deschide studio-ul”. Biblioteca e goală: clipul M09 a fost produs pe un Hub de test, iar fișierele lui sunt în `Videos\Ifrim Studio`. Le poți importa prin încărcare.
4. **Importul local:** implicit e permis doar `C:\Users\mihai\Videos` (inclusiv sursele clipului, din `Videos\Ifrim Studio\…\surse\`). Mai merge și prin încărcare: tragi fișierul în Studio → Bibliotecă. Alte foldere se pot seta doar prin ruta `POST /api/media/policy/import-roots`, din sesiunea de proprietar; formularul din UI lipsește încă (OPEN_ISSUES).

**Revenirea pe M08** (doar la nevoie; e decizia ta, nu se face automat):
1. `node v2/scripts/stop.mjs`.
2. Pui deoparte baza curentă: `hub-v2.sqlite` și eventualele `-wal`/`-shm` din `hub-data\private`. Nu le ștergi.
3. Copiezi backup-ul `pre-upgrade\hub-v2.pre-m09.2026-10-04T07-23-05-815Z.sqlite` ca `hub-v2.sqlite`.
4. Revii la codul M08 cu `git stash` sau checkout pe `ae3aa48`.
5. `npm run build:v2`, apoi pornirea.

**De știut:**
- Tot ce s-a făcut pe M09 după 07:23 UTC rămâne doar în baza pusă deoparte.
- Declarația veche Claude redevine valabilă în M08 (review R28). Retrage-o din M08 dacă nu o mai vrei.
- Migrația 9 doar adaugă tabele și coloane, dar codul M08 nu e testat pe o bază de schemă 9. De aceea revenirea folosește backup-ul, nu baza migrată.

## 2. Declararea din nou a facturării Claude (după trecere)

1. Deschide **Integrări → Claude**, din sesiunea ta de proprietar.
2. **Verifică contul**, printr-o probă fără inferență. Contul apare ca un pseudonim scurt, niciodată ca email.
3. **Declară din nou:**
   - textul exact al declarației: „extra usage” / usage credits oprite pentru acest cont;
   - Windows Hello proaspăt.
   Declarația expiră după 30 de zile.

**Ce nu dovedește declarația:** că nu există credite deja cumpărate în cont. Dezactivarea top-up-ului nu le consumă și nu le anulează. Hub-ul nu poate verifica automat creditele Claude și nu încearcă.

**Retragerea** e oricând fail-safe: „Retrage declarația”, inclusiv prin voce.

## 3. Pachetele de decizie Studio

Le găsești în **Pilot → Decizii**. Ordinea e impusă:

1. **MEDIA_A.** Nu autorizează nimic din B sau C.
2. **MEDIA_B.** Doar după MEDIA_A.
3. **MEDIA_C.** Doar după MEDIA_B.

**MEDIA_A · instalări și mediu** (fără efect extern):
- **MA1 · ffmpeg și ffprobe.** Se înregistrează versiunea și sha256. Sunt deja instalate: ffmpeg 8.1.x pe PATH, verificat de teste. Aprobarea doar le fixează.
- **MA2 · serverul OBS WebSocket.** Îl activezi tu în OBS: local, cu parolă. Hub-ul nu îl poate verifica fără conexiune, deci rămâne „aprobat”, niciodată „executat” dintr-un click.
- **Fonturile preseturilor** sunt citite de pe disc: Segoe UI Variable / Segoe UI, ale sistemului, și Cascadia Code (licență OFL).

**MEDIA_B · captură live și producție AI limitată:**
- **MB1 · captură live** a ecranului tău și a Hub-ului live, în Public Demo Mode.
  - Aprobarea pornește doar politica `liveCapture`.
  - **Limita M09:** fiecare sesiune de captură cere și aprobarea scopului ei exact, iar M09 nu are încă ecranul care scrie această aprobare. Deci chiar cu MB1 aprobat, captura Hub-ului live și OBS rămân refuzate. Captura demo pe un Hub de test funcționează și azi.
  - Revenirea: „Oprește captura live” (`media.policy.capture_off`), fail-safe de pe orice canal.
- **MB2 · buget AI.** E doar o decizie de buget: max 4 rulări, Claude `sonnet · medium`, fără fallback, pentru roluri de tip creative-director și scriptwriter. Nu pornește nimic. Fiecare rulare trece totuși prin plan confirmat, gate și grant, exact cu acest model, după declararea facturării din §2.

**MEDIA_C · conturi și încărcare pe platforme:**
- câte o opțiune pe platformă: MC1 Instagram · MC2 TikTok · MC3 YouTube · MC4 X · MC5 LinkedIn;
- e o decizie externă: un click nu conectează, nu încarcă și nu contează ca executat;
- în M09 nu există niciun conector API. Calea reală e pachetul manual; vezi `M09_MEDIA_RIGHTS_AND_PLATFORMS.md` §4 pentru ce cere fiecare platformă.

## 4. Probe live propuse (fiecare cu aprobarea ei)

| # | Probă | Ce cere | Cost / risc |
|---|---|---|---|
| L1 | Hub-ul pe M09 (§1) | **FĂCUT** 2026-10-04 07:23 UTC (§0) | fără model; Hub-ul a fost oprit sub un minut |
| L2 | Declarația Claude (§2) | Windows Hello | fără model |
| L3 | Aprobarea creativă a clipului M09 în Studio | Proiectul trebuie întâi recreat pe Hub-ul live: importul surselor din `Videos\…\surse\`, montajul din `plan-de-montaj_v1.json` cu id-urile noi, randarea finală. Apoi vizionarea ta + Windows Hello | fără model; ~1 min CPU. Lipsește încă un ajutor de import pentru plan (OPEN_ISSUES M09 §5) |
| L4 | Un pachet manual YouTube din clipul aprobat | aprobarea manifestului exact (Hello) | fără model; nu postează nimic |
| L5 | Postarea manuală și înregistrarea URL-ului | postarea o faci tu în YouTube Studio | publicare reală: decizia ta |
| L6 | Captura Hub-ului live în Public Demo Mode | MB1 + aprobarea scopului (de construit, vezi OPEN_ISSUES) | fără model |
| L7 | O producție AI limitată (brief/script de Creative Director) | MB2 + plan confirmat + grant | 1–4 rulări Claude `sonnet · medium` din abonament |
| L8 | Verificarea `--inference-path` pe whisper-server real | pornirea whisper-server | local, fără model cloud |

## 5. Ce rămâne în așteptare și NU e atins de acest plan

- D6 `bnd_murl82o1_00afe726c3`, Demo B `bnd_mupwze7b_e03f70f2d7` și ciornele existente.
- Pilotul ProDelivery `bnd_musqo7xj_1a204a2e55` (DELIVERY_READY, nu acceptat) și decizia F-001. Fișierele ProDelivery nu sunt atinse și pilotul nu apare în niciun material media.
- Commit și push pentru M09: cer aprobarea ta exactă. Nu se stage-uiesc `.ifrim/data-location.json`, hub-data, media brută, profile vocale sau backupuri.
