# M10 — Operatorul desktop (Desktop Operator)

Data: 2026-10-04 · versiune cod `2.11.0-m10` · contract API 10 · migrarea 10.

## Ce este

Un helper Windows mic, scris în C# (.NET Framework 4.8.1), compilat local cu compilatorul care vine cu Windows (`csc.exe`, fără descărcări). Prin el, Hub-ul poate:

- deschide o aplicație autorizată sau îi reutiliza fereastra;
- aduce fereastra în față și verifica dacă e chiar în prim-plan;
- citi structura ferestrei prin UI Automation (tipuri de controale, nume, id-uri; fără valorile din câmpuri, dacă nu le cere pasul);
- tasta text Unicode doar în fereastra verificată din prim-plan;
- apăsa butoane prin modelele UI Automation (Invoke) sau, ca ultimă soluție, printr-un click verificat pe dreptunghiul proaspăt al elementului;
- salva prin dialogul standard „Save As”;
- arăta un folder aprobat în Explorer și citi folderul ferestrei Explorer din față.

Fiecare operație urmează trei pași: observă → acționează → verifică. Un pas al cărui rezultat nu poate fi citit înapoi devine `UNCERTAIN`, niciodată „gata”.

## Cum e legat de Hub (un singur punct de trecere)

`v2/server/desktop/operator.mjs` → `perform(ctx, action)` este singura poartă. Pentru fiecare operație face următoarele:

1. **Clasifică efectul** cu `v2/server/policy/action-policy.mjs`: `LOCAL_DIRECT`, `PLAN_STEP`, `SENSITIVE` sau `REFUSED`. Decid ținta (aplicația, fișierul, destinația, butonul), nu verbul și nici cine pretinde că cere.
2. **Verifică autoritatea contextului:**
   - o comandă directă cere sesiunea de proprietar (WebAuthn, canalul `owner`);
   - un pas de plan cere `authorize()` al planului confirmat, adică status, termen, sesiune încă deschisă, pas, operație, aplicație, folder și buget.
3. **Ia sesiunea desktop exclusivă:** un singur controlor; un plan diferit primește `DESKTOP_BUSY`, iar o sesiune pe pauză primește `DESKTOP_PAUSED`.
4. **Trimite cererea semnată** la helper, cu o autoritate scurtă: planul, pasul, procesele aplicației și expirarea (`exp`).
5. **Înregistrează acțiunea** în `desktop_actions`: ținta (aplicație, hwnd, numele fișierului), clasa, rezultatul sumar și eroarea. Conținutul documentelor și textul tastat nu sunt înregistrate niciodată; se păstrează doar lungimi și hash-uri.

## Protocolul helperului (stdio, JSON pe linii)

- La pornire, Hub-ul generează o **cheie HMAC-SHA256 nouă** și o trimite în prima linie (`hello`). Helperul răspunde semnat.
- **Fiecare cerere e semnată** și are un `nonce` unic (o reluare primește `REPLAY`) și un `ts` în fereastra de ±120 s (altfel `STALE`). O semnătură greșită primește `BAD_MAC`.
- **Operațiile cu efect** cer `auth.exp`, adică autoritatea Hub-ului (`NO_AUTHORITY` / `AUTHORITY_EXPIRED`). Operațiile deschise sunt doar `ping`, `stop`, `releaseAll`, `desktopState`, `inputState`, `resume`.
- **`auth.apps` e obligatoriu** pentru orice operație pe o fereastră: lista proceselor permise. Lipsa listei înseamnă refuz (`OUT_OF_SCOPE`), niciodată „orice aplicație”.
- **`stop`** e tratat pe firul de citire, înaintea operațiilor din coadă. Inputul se oprește, tastele ținute sunt eliberate, iar helperul rămâne pe pauză până la `resume`. Hub-ul trimite `resume` doar după ce reverifică starea.
- Fiecare operație rulează pe un fir STA propriu, cu timeout. Un răspuns care nu vine produce `OPERATOR_TIMEOUT`, iar pasul e marcat `UNCERTAIN`.

## Ce refuză helperul (chiar dacă Hub-ul ar greși)

- **Procese protejate:** `consent`, `credentialuibroker`, `logonui`, `lockapp`, managerii de parole (1Password, KeePass, KeePassXC, Bitwarden, LastPass, Dashlane), Task Manager, Registry Editor, MMC, `cmd`, `powershell`, `pwsh`, Windows Terminal, `conhost`, `wsl`, `bash`.
- **Fereastra Hub-ului** (titlu cu „Ifrim Agent Hub” / `localhost:8011`): Hub-ul nu se administrează prin desktop.
- **Butoane cu efect extern, distructiv sau de plată:** publish, post, share, upload, send, delete, pay, buy, subscribe, sign in, „Export to TikTok/YouTube/…”, plus echivalentele românești (publică, postează, încarcă, trimite, șterge, plătește, cumpără, abonează, autentifică…). Aceeași listă există și în politica Hub-ului, unde diacriticele se normalizează înainte de comparare.
- **Desktopul securizat:** ecran blocat, UAC sau Winlogon (desktopul de intrare nu e „Default”) produce `SECURE_DESKTOP`, iar controlul se suspendă.
- **Schimbarea identității:** HWND refolosit de alt proces, proces repornit sau fereastră înlocuită produc `IDENTITY_CHANGED`.
- **Inputul utilizatorului:** dacă ai folosit tastatura sau mouse-ul după ultimul input injectat, comparația `GetLastInputInfo` cu momentul injectării dă `USER_INPUT`. Operatorul se oprește și așteaptă („Preiau eu” / „Continuă”).
- **Tastarea** se face doar dacă fereastra țintă e în prim-plan, verificat înainte de fiecare bucată de 16 caractere. Altfel apare `NOT_FOREGROUND`.

Ce nu face helperul:

- nu rulează ca administrator și nu folosește `uiAccess`;
- nu citește clipboardul și nu e un keylogger;
- nu închide forțat aplicații.

Stop lasă aplicațiile deschise.

## Aplicațiile (registru cu stări separate)

`v2/config/desktop-apps.json`, cu stările `NOT_FOUND` → `INSTALLED` (executabil găsit) → `DISCOVERED` (semnat de editorul așteptat, semnătură de încredere) → `AUTHORIZED_SCOPE` (autorizat o dată de tine, în sesiunea de proprietar).

Descoperirea folosește doar sursele standard (App Paths, scurtături Start pe două niveluri, căi cunoscute, folderul versionat al aplicației), fără scanarea discului. Un binar schimbat (de exemplu după o actualizare) pierde autorizarea.

Descoperirea reală pe acest PC, 2026-10-04, cu helperul construit din sursa curentă:

| Aplicație | Stare | Executabil | Versiune | Semnătură |
|---|---|---|---|---|
| Notepad | DISCOVERED | `WindowsApps\Microsoft.WindowsNotepad_11.2607.14.0…\Notepad.exe` (App Paths) | 11.2607.14.0 | Microsoft Corporation, de încredere |
| File Explorer | DISCOVERED | `C:\WINDOWS\explorer.exe` | 10.0.26100.8875 | Microsoft Windows, de încredere |
| OBS Studio | DISCOVERED | `C:\Program Files\obs-studio\bin\64bit\obs64.exe` | 32.2.2 | OBS Project, LLC, de încredere |
| CapCut | DISCOVERED | `%LOCALAPPDATA%\CapCut\Apps\9.3.0.3970\CapCut.exe` (folderul versionat are prioritate față de lansator) | 9.3.0.3970 | Bytedance Pte. Ltd., de încredere |

Niciuna nu e autorizată încă pe Hub-ul live: autorizarea e un pas din foaia de activare M10.

## Profilurile pe aplicații (`v2/server/desktop/profiles.mjs`)

Toate profilurile folosesc selectori structurali (tip de control, automation id, clasă, model de nume), nu coordonate fixe.

- **Notepad (D2):** deschide fișierul ca argument, apoi:
  - verifică precondiția (fila activă are exact conținutul fișierului);
  - focus, apoi tastare;
  - verifică documentul;
  - Save As într-un folder aprobat, niciodată peste un fișier existent;
  - verifică fișierul pe disc;
  - mută fereastra și o reidentifică prin proces, momentul pornirii și structură.
- **CapCut, doar inspecție (D6):** citește arborele structural (fără valori) și dă un verdict: `STRUCTURAL_CONTROLS`, `LIMITED` sau `CANVAS_ONLY`.
- **CapCut, proiect nou + import (D6):** doar dacă butoanele sunt expuse prin UI Automation. Fiecare pas care nu își găsește controlul se oprește cu pasul asistat exact („Apasă tu «Import»…”). Exportul către platforme e refuzat.
- **OBS** se controlează prin API-ul său WebSocket (start, stop, stare, scenă), nu prin clickuri. Vezi `M10_STUDIO_COMPLETION.md`.

## Comenzile Lega (aceeași cale pentru text și voce)

| Spui / scrii | Clasa | Ce se întâmplă |
|---|---|---|
| „Deschide CapCut / OBS / Notepad / Explorer” | LOCAL_DIRECT | Lansare sau reutilizare, prim-plan, verificat. O aplicație găsită și semnată, dar neautorizată, primește un card cu acea singură decizie (Windows Hello). |
| „Adu OBS în față”, „Treci pe CapCut” | LOCAL_DIRECT | Prim-plan, verificat. |
| „Arată folderul exporturilor”, „Unde e exportul?” | LOCAL_DIRECT | Explorer pe folderul exporturilor (aprobat), verificat după locația ferestrei. |
| „Importă din folderul acesta” | PLAN | Folderul ferestrei Explorer din față, apoi un card de import, cu acces o dată dacă folderul nu e aprobat. |
| „Oprește tot” / „Preiau eu” / „Pauză” | fail-safe | Operatorul se oprește imediat, iar planurile trec pe pauză. Nimic nu se închide. |
| „Continuă” | reluare | Planul oprit continuă în aceleași limite, după ce verifică pașii incerți. |

Comenzile directe nu pornesc dintr-un document, dintr-o transcriere media sau de pe canalul vocal fără sesiune.

## Limite cunoscute (oneste)

- **Prim-planul.** Windows poate refuza aducerea în față a unei ferestre când alt program ține focusul. Atunci răspunsul spune „deschisă, dar nu în prim-plan”; nu raportează un succes fals.
- **CapCut.** Interfața (Qt) poate expune puține controale. Verdictul real (`STRUCTURAL_CONTROLS` / `LIMITED` / `CANVAS_ONLY`) se obține la prima inspecție de pe foaia de activare. Până atunci, „invokeControl” și „import” sunt `UNVERIFIED`, iar exportul e `ASSISTED_ONLY`.
- **Testele automate** folosesc un helper-fixture determinist care vorbește exact protocolul. Helperul real e verificat automat doar prin operații care nu ating desktopul: protocol, semnături, reluare, autoritate, citirea tablourilor JSON și scopul fail-closed. Demonstrațiile GUI reale (D1, D2, D6) rulează la tine, cu `v2/tests/manual/m10-desktop-real.mjs --open notepad --watching` / `--notepad --watching`.
