# M10 — Foaia de activare (o singură foaie)

**Stare la 2026-10-04 13:53 UTC: pasul 1 e FĂCUT.**

- Hub-ul live rulează **2.11.0-m10** (contract 10, migrarea 10), în BUILD_SAFE, cu 0 granturi și 0 rulări.
- L-am făcut eu, la aprobarea ta („aprob upgrade ul la m10”), prin `upgrade.mjs --apply`, rularea `upg_mutvrr79`.
- Backupul verificat de dinainte de migrare: `hub-data\private\pre-upgrade\hub-v2.pre-migration.v9-to-v10.2026-10-04T13-53-14-962Z.sqlite` (sha256 `bef36396…fb50`, integritate ok, cu manifest). Backupul pre-M09 a rămas neatins.
- Helperul desktop e construit în `hub-data\work\desktop\` (manifest verificat față de sursă).
- Codul e încă **necomis**.

Continui de la pasul 2. Nimic de mai jos nu pornește singur.

Bifezi pe rând. Fiecare pas spune ce face, ce cere de la tine și ce e reversibil.

---

## 1 · Upgrade la M10 (o comandă)

**Ce face:**

- verifică întâi că nu rulează nimic: execuții, granturi, misiuni, randări, sesiune desktop;
- face dry run pe o copie a bazei;
- oprește Hub-ul;
- construiește UI-ul și **helperul desktop** din sursă;
- pornește Hub-ul. **Serverul face singur backupul verificat înainte de migrare** (`hub-data\pre-upgrade\`) și refuză să migreze fără el;
- verifică versiunea, contractul, backupul și numărul de rânduri.

Dacă se oprește la jumătate, reiei cu `--resume`: pașii făcuți nu se repetă.

Întâi doar citire (nu schimbă nimic):

```bash
node v2/scripts/upgrade.mjs --plan
```

Apoi upgrade-ul:

```bash
node v2/scripts/upgrade.mjs --apply
```

Dacă vrei să-l rulez eu, scrie exact: **„Aprob upgrade-ul live la M10 (upgrade.mjs --apply)”**. Stratul de permisiuni al sesiunii a refuzat în trecut acțiuni pe Hub-ul live; dacă refuză și acum, rulezi tu comanda.

Revenire: vezi RUNBOOK → M10 → „Rollback”. Backupul de dinainte de migrare e acolo, cu manifest; restaurarea nu e niciodată automată.

## 2 · Sesiunea și aplicațiile (2–4 confirmări cu Windows Hello)

1. Deschide http://localhost:8011 → **Deblochează sesiunea** (Windows Hello).
2. Pagina **Operator** → **Caută aplicațiile** (Windows Hello). Ar trebui să apară toate patru, „găsită și semnată”. Așa le-am găsit eu cu helperul real, doar citind:
   - Notepad 11.2607.14.0;
   - File Explorer;
   - OBS Studio 32.2.2;
   - CapCut 9.3.0.3970.
3. Autorizezi o dată fiecare aplicație pe care vrei să o controleze Lega: **Autorizează (Windows Hello)**. Sau nu apeși nimic aici și spui direct „Deschide CapCut”: cardul cuprinde decizia, iar o confirmare o autorizează.

## 3 · Demonstrații (fiecare are un test automat echivalent)

| # | Spui / faci | Ce trebuie să vezi | Confirmări |
|---|---|---|---|
| D1 | „Deschide Notepad”, apoi „Adu CapCut în față” | Aplicația deschisă și în prim-plan; bara de sus arată ce face operatorul, cu Stop / Preiau eu. Dacă Windows refuză prim-planul, mesajul o spune. | 0 după autorizare |
| D8 | „Deschide Studio” | Pagina Studio; niciun model, nicio acțiune pe desktop | 0 |
| — | „Arată folderul exporturilor” | Explorer pe `…\Videos\Ifrim Studio\Exporturi` (creat dacă lipsește) | 0 |
| D3 | Studio → Centrul de comandă → **Importă un proiect** → `C:\Users\mihai\Videos\Ifrim Studio\M09 - Un plan, o confirmare` → **Importă**. Sau prin Lega: deschizi folderul în Explorer și spui „Importă din folderul acesta”. | Previzualizarea:<br>• 2 surse verificate prin hash;<br>• 8 versiuni de montaj;<br>• etichete SIMULATION păstrate;<br>• „revizuirea creativă rămâne în așteptare”.<br>Apoi proiectul în Studio. | 1 (Windows Hello) |
| D4 | În clipul importat: „La secunda 21 mută textul mai sus” (sau orice corectură) | Propunerea + un card → „Da” → versiune nouă, ciornă randată, QA automat; originalul rămâne; „Revizuire creativă: în așteptarea ta” | 1 |
| D2 | În terminal (ești la calculator):<br>`node v2/tests/manual/m10-desktop-real.mjs --notepad --watching` | Pe un fișier **sintetic** dintr-un folder temporar:<br>• Notepad se deschide;<br>• se scrie text cu diacritice;<br>• se salvează ca fișier nou;<br>• conținutul e verificat pe disc;<br>• fereastra e mutată și reidentificată.<br>Mouse-ul sau tastatura ta îl opresc imediat. | 0 (script manual) |
| D6 | `node v2/tests/manual/m10-desktop-real.mjs --capcut-inspect --watching` | Verdictul real pentru CapCut (`STRUCTURAL_CONTROLS` / `LIMITED` / `CANVAS_ONLY`) și controalele expuse; nu apasă nimic | 0 |

## 4 · OBS (D5 / D7), doar dacă vrei înregistrare reală

1. **În OBS:** Tools → WebSocket Server Settings → *Enable WebSocket server*, port 4455, *Enable Authentication* cu o parolă pe care o păstrezi tu. Nu o scrie în chat.
2. **Pagina Operator → OBS:** folderul înregistrărilor (OBS → Settings → Output → Recording Path), adresa `ws://127.0.0.1:4455`, scena (opțional; trebuie să existe deja) → **Salvează** (Windows Hello).
3. **Decizia MB1 / MEDIA_B** (Pilot → Pachete): captura live. Fără ea, Lega spune exact ce lipsește și nu face niciun plan.
4. Spui: „Înregistrează demonstrația cu OBS și pregătește varianta verticală, fără să publici”. Primești **un singur card**: înregistrare → oprire → import → montaj → randare → variantă verticală + QA. Scrii parola OBS în card (rămâne doar în memorie) → **Confirmă planul**.

## 5 · Ce rămâne decizia ta (nu e în pașii de mai sus)

- **MEDIA_A / MEDIA_B (MB1) / MEDIA_C:** captură live; conturi, încărcare, publicare (fiecare postare are confirmarea ei).
- **Aprobarea creativă** a clipului (Studio → Decizia creativă, Windows Hello).
- **Acceptarea sau respingerea** pilotului ProDelivery/F-001, D6 și Demo B.
- **Autostart, acces remote, ascultare permanentă:** opțiuni separate, toate **oprite** implicit; M10 nu le pornește.
- **Sonde de model:** M10 nu cere niciun model. Nu e nevoie de nicio sondă pentru activare.
- **Commit / push** pentru M10: separat, la cererea ta.
