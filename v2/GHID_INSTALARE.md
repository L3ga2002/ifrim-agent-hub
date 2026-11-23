# Ifrim Agent Hub — ghid de instalare și testare (Windows 11)

Ghidul e pentru cine instalează Hub-ul pe calculatorul propriu ca să-l testeze pe proiectele lui demo. Totul rulează pe calculatorul tău: Hub-ul, baza de date, cheile și proiectele. Hub-ul ascultă doar pe `localhost`, deci nu poate fi accesat din internet sau din rețeaua locală. Un model AI pornește doar după ce confirmi un plan.

**Timp estimat:** 20–30 de minute. **Drepturi de administrator:** nu sunt necesare pentru Hub. Instalarea Git și Node.js prin `winget` poate cere o confirmare Windows.

---

## 1. Ce îți trebuie

- Windows 11, cu internet și cu 3 GB liberi pe disc.
- Windows Hello configurat (PIN, amprentă sau față). Îl folosești pentru „sesiunea de proprietar”, care confirmă acțiunile importante.
- Microsoft Edge sau Google Chrome.
- Acces la AI, cel puțin una dintre variante:
  - **Abonament:** ChatGPT (Plus, Pro sau Business) pentru Codex și/sau Claude (Pro sau Max) pentru Claude Code. Consumul intră în abonamentul tău.
  - **Cheie API proprie:** OpenAI și/sau Anthropic. Plătești la furnizor, după consum. Hub-ul te oprește la plafoanele pe care le setezi.

## 2. Instalează Git și Node.js (o singură dată)

Deschide **PowerShell** și rulează:

```powershell
winget install --id Git.Git -e
```

```powershell
winget install --id OpenJS.NodeJS.LTS -e
```

Închide PowerShell și deschide-l din nou, ca Windows să găsească programele noi.

## 3. Instalează Hub-ul

În PowerShell rulează:

```powershell
$f = "$env:TEMP\ifrim-install.ps1"; Invoke-RestMethod https://raw.githubusercontent.com/L3ga2002/ifrim-agent-hub/v2-milestone-01/v2/scripts/install.ps1 -OutFile $f; powershell -ExecutionPolicy Bypass -File $f
```

Scriptul face următoarele:

- alege ultima versiune **publicată**;
- o descarcă în `%USERPROFILE%\IfrimHub\Proiecte\ifrim-agent-hub`;
- creează o bază de date nouă și goală în `%USERPROFILE%\IfrimHub\hub-data`;
- instalează dependențele și construiește interfața;
- pornește Hub-ul și deschide `http://localhost:8011`.

Dacă vrei ca Hub-ul să pornească singur când intri în Windows, adaugă `-Autostart` la sfârșitul comenzii.

## 4. Prima deschidere: tu ești proprietarul

1. În pagina deschisă, urmează **Pașii**. La „Autentificatorul tău” apasă **Înregistrează acest calculator (Windows Hello)** și confirmă cu PIN-ul sau amprenta.
2. De aici înainte, acțiunile importante cer o confirmare Windows Hello. Sunt incluse aici: salvarea unei chei, pornirea rutei API, confirmarea unui plan, instalarea unei actualizări.

Deschide Hub-ul mereu la `http://localhost:8011`, nu la `127.0.0.1`. Windows Hello funcționează doar pe `localhost`.

## 5. Conectează AI-ul

### Varianta A — abonamentele tale

**Codex** (abonament ChatGPT):

```powershell
npm install -g @openai/codex
```

```powershell
codex login
```

**Claude Code** (abonament Claude):

```powershell
irm https://claude.ai/install.ps1 | iex
```

După instalare rulează `claude` o dată și autentifică-te cu `/login`.

Apoi, în Hub, deschide **Integrări**. La fiecare furnizor:

1. Apasă **Inspectează instalarea**, apoi **Verifică contul**. Verificarea nu pornește niciun model.
2. Verifică în contul furnizorului că plata suplimentară e oprită: *usage credits* sau *auto-reload*.
3. Scrie exact textul declarației afișat și apasă **Declară din nou**.

### Varianta B — cheia ta API

În **Integrări → Cheie API proprie**, pentru OpenAI (Codex) și/sau Anthropic (Claude Code):

1. Lipește cheia și apasă **Salvează cheia**. Cheia se criptează cu contul tău de Windows și nu se mai afișează niciodată. Vezi doar ultimele 4 caractere.
2. Setează plafoanele în USD: lunar, zilnic și pe rulare. Valorile de start sunt 20, 5 și 2.
3. Citește textul acordului și apasă **Accept textul și pornesc ruta API**.
4. Hub-ul verifică automat cheia, fără model. Dacă ruta rămâne blocată, apasă **Verifică contul** la furnizorul respectiv.

> **Setează și o limită de cheltuieli în contul furnizorului.** Pentru OpenAI: platform.openai.com → Settings → Limits. Pentru Anthropic: console.anthropic.com → Limits. Plafonul Hub-ului e a doua frână. Prima frână e limita din contul furnizorului.

Ce face Hub-ul cu cheia ta:

- Fiecare rulare primește din buget cel mult cât a mai rămas pe zi, pe lună și pe rulare. Când se atinge plafonul, rularea se oprește.
- Claude Code raportează singur costul și se oprește la plafonul rulării.
- La Codex, costul e o estimare făcută de Hub din tokeni, cu o marjă de siguranță.
- O rulare oprită fără raport de cost se socotește la plafonul ei. Factura reală e cea de la furnizor.
- Pe ruta API, Claude Code poate doar să citească: face analize și review. Scrierea în proiect o face Codex. Pe Windows, Claude nu are un sandbox care să țină cheia departe de comenzile pe care le rulează.
- Zilele și lunile bugetului se socotesc după ora calculatorului tău.
- Conversația vocală live cu L3ga (GPT-Live) merge doar prin abonamentul ChatGPT, niciodată pe cheia API. Conversația scrisă funcționează și fără ea.
- **Oprește ruta API** te întoarce la abonament. **Oprește și șterge cheia** scoate cheia de pe calculator. Revocă cheia și în contul furnizorului dacă nu o mai folosești.

## 6. Adaugă proiectele tale demo

1. Copiază fiecare proiect demo într-un folder din `%USERPROFILE%\IfrimHub\Proiecte\`, de exemplu `%USERPROFILE%\IfrimHub\Proiecte\demo-magazin`. **Nu copia** `node_modules`, `dist`, `.env` și chei. Hub-ul refuză un proiect demo care are fișiere secrete sau peste 5000 de fișiere.
2. Cu Hub-ul pornit, rulează pentru fiecare proiect:

```powershell
node "$env:USERPROFILE\IfrimHub\Proiecte\ifrim-agent-hub\v2\scripts\add-project.mjs" --dir "$env:USERPROFILE\IfrimHub\Proiecte\demo-magazin" --name "Demo magazin"
```

Proiectul apare în L3ga și în **Proiecte** ca proiect demo. Pe un proiect demo, planurile pot da lui Codex drept de scriere.

> **De știut despre izolare:** pe Windows, sandbox-ul Codex limitează **scrierea** la proiect. O comandă a modelului poate totuși **citi** alte fișiere de pe calculator, dacă le știe calea. Nu ține secrete reale în folderele proiectelor demo și nu da proiecte cu date de clienți.

## 7. Prima lucrare

1. Deschide **L3ga** și alege proiectul demo.
2. Scrie sau spune ce vrei, de exemplu: „Adaugă validare pentru formularul de contact și testele ei”.
3. L3ga îți arată un plan: ce face, cu ce model, cu ce drepturi și ce verificări. Confirmă-l cu un clic. Windows Hello îți cere confirmarea.
4. Hub-ul face backup, rulează, verifică și îți arată rezultatul pentru acceptare. **Stop** oprește oricând tot.

## 8. Actualizări

Hub-ul verifică zilnic dacă există o versiune **publicată** nouă. Când apare una, în partea de sus a paginii vezi mesajul **Actualizare disponibilă**.

1. Apasă **Actualizează acum** și confirmă cu Windows Hello.
2. Hub-ul face backup, instalează versiunea și repornește în 1–3 minute. Reîncarcă pagina după repornire.
3. Dacă ceva nu merge, Hub-ul revine singur la versiunea anterioară, cu tot cu baza de date.

Poți verifica și manual, din **Integrări → Versiune și actualizări → Verifică acum**.

Nu modifica fișierele din folderul `ifrim-agent-hub`. Dacă există modificări locale, actualizarea automată este refuzată, ca să nu se piardă nimic.

## 9. Oprire, pornire, pornire automată

```powershell
node "$env:USERPROFILE\IfrimHub\Proiecte\ifrim-agent-hub\v2\scripts\stop.mjs"
```

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\IfrimHub\Proiecte\ifrim-agent-hub\v2\scripts\start-detached.ps1"
```

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\IfrimHub\Proiecte\ifrim-agent-hub\v2\scripts\autostart.ps1" -Install
```

Pentru a scoate pornirea automată, rulează ultima comandă cu `-Uninstall`.

## 10. Probleme frecvente

| Ce vezi | Ce faci |
|---|---|
| `git` sau `node` „nu este recunoscut” | Închide și redeschide PowerShell după instalare. |
| Pagina nu se deschide | Pornește Hub-ul (secțiunea 9). Jurnalul e în `%USERPROFILE%\IfrimHub\hub-data\private\v2-hub.log`. |
| Windows Hello nu apare | Folosește Edge sau Chrome și deschide `http://localhost:8011`, nu `127.0.0.1`. |
| „Claude Code binary not found” / „codex.exe not found” | Instalează clientul (secțiunea 5), apoi **Integrări → Inspectează instalarea**. |
| „Plafonul zilnic/lunar este atins” | Ridică plafonul în **Integrări → Cheie API proprie** sau așteaptă ziua sau luna următoare. |
| Proiectul demo e refuzat | Scoate ce numește mesajul (`node_modules`, `.env`, chei, scurtături) și rulează din nou `add-project.mjs`. |
| „Instalarea are fișiere modificate local” la actualizare | Rulează `git status` în folderul `ifrim-agent-hub` și anulează modificările cu `git checkout -- .`. |

## 11. Dezinstalare

1. Oprește Hub-ul și scoate pornirea automată (secțiunea 9).
2. Revocă cheile API în contul furnizorului dacă le-ai pus.
3. Șterge folderul `%USERPROFILE%\IfrimHub`. Odată cu el dispar codul, baza de date și cheia criptată.
