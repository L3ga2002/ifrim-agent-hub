# M08 · Planul de protecție a datelor (pachetul A)

## Situația de azi (din OPEN_ISSUES după M07)

- **Datele V2 sunt sincronizate în OneDrive.** Proiectul e sub OneDrive Desktop, deci și `.ifrim/private` (baza Hub V2, atașamentele, jurnalele), `.ifrim/BACKUPS/v2` și `.ifrim/tmp/v2` (copii de lucru, pachete de livrare) se sincronizează în cloud.
- **Profilul vocal e în afara OneDrive**, în `C:\Users\mihai\IfrimHub\voice\profiles`, dar moștenește drepturile folderului `IfrimHub`, inclusiv citirea pentru grupul `CodexSandboxUsers`.

Pachetul A apare în **Pilot → Decizii** cu inventarul real: dimensiuni, ce e sincronizat, ACL-ul citit cu `icacls`, doar metadate. Fiecare opțiune are execuție, revenire și limite. Starea „executată” se citește din realitate: A1 din pointerul de locație, A2 din ACL.

## A1 · Mutarea datelor V2 în afara OneDrive

**Ținta propusă:** `C:\Users\mihai\IfrimHub\hub-data`, cu `private/`, `backups/v2/` și `work/` dedesubt. Nu e `%LOCALAPPDATA%`, fiindcă un proces pornit dintr-o aplicație MSIX vede o copie redirecționată a AppData (aceeași regulă ca la motorul vocal).

**Ce se mută:** doar intrările V2 din `.ifrim/private`:
- `hub-v2.sqlite`, plus `-wal`/`-shm` (copiată prin backup-ul online SQLite);
- tot ce începe cu `v2-` (atașamente, jurnal);
- `browser-evidence`, `sales-imports`;
- plus integral `.ifrim/BACKUPS/v2` și `.ifrim/tmp/v2`.

**Ce NU se mută:** baza V1 și fișierele OpenClaw din `.ifrim/private`. V1 rulează în continuare acolo și nu e atins.

**Pașii** (cu Hub-ul oprit pentru `--apply`; `--plan` și `--dry-run` merg și cu el pornit):
1. `node v2/scripts/relocate-data.mjs --plan` — unde sunt datele și ce s-ar muta (căi, număr de fișiere, dimensiuni; niciun conținut).
2. `node v2/scripts/relocate-data.mjs --dry-run --to "C:\Users\mihai\IfrimHub\hub-data"` — o copie de probă lângă țintă:
   - ACL-ul e restrâns la contul tău și SYSTEM, apoi recitit;
   - baza e copiată cu backup online, apoi verificată (integrity_check, număr de rânduri pe fiecare tabel), iar celelalte fișiere cu sha256;
   - căile salvate sunt rescrise în copie;
   - copia de probă se șterge (doar ce a creat rularea).
3. `node v2/scripts/stop.mjs`, apoi `node v2/scripts/relocate-data.mjs --apply --to "C:\Users\mihai\IfrimHub\hub-data"`:
   - copie verificată la fel ca mai sus;
   - pointerul `.ifrim/data-location.json`, scris doar după verificare;
   - `V2_MOVED.json` în folderul vechi: un Hub V2 refuză să-l mai deschidă, deci niciodată două baze active.
4. Pornești Hub-ul și verifici în Sistem locația datelor și integritatea.
5. **Reconfirmi izolarea Codex (R3).** Lista de negare a sandbox-ului conține căile datelor, iar amprenta ei se schimbă după mutare.

**Căi salvate rescrise în copie:** `attachments.storage_path`, `backups.archive_path` / `manifest_path` și `factory_bundles.file_path`, cu numărul de rânduri raportat. Altfel, pachetele de livrare care te așteaptă ar fi rămas legate de vechiul folder din OneDrive.

**Revenire:** `node v2/scripts/relocate-data.mjs --rollback`.
- Fără schimbări după mutare: folderul vechi redevine activ, copia nouă primește marcajul, iar pointerul devine o arhivă.
- Dacă baza nouă s-a schimbat, alegi explicit:
  - `--copy-back`: datele noi revin, verificate; versiunile vechi se păstrează cu sufixul `.pre-rollback-…`, iar căile se rescriu înapoi;
  - `--discard-new`: revii la datele de dinainte; copia nouă rămâne marcată, neștearsă.

**Refuzuri:**
- **Ținta:**
  - într-un folder sincronizat;
  - în folderul proiectului;
  - suprapusă cu sursa;
  - negoală.
- **Starea Hub-ului:** un Hub care răspunde sau un proces Hub viu; date deja mutate.

## A2 · Accesul la profilul vocal

`powershell -ExecutionPolicy Bypass -File v2\scripts\voice-acl.ps1` cu:
- `-Plan`: ACL-ul curent, grupurile largi, ce se va schimba;
- `-Apply`: salvează ACL-ul curent (`profiles.acl-backup.txt`), oprește moștenirea doar pe `profiles` și lasă contul tău și SYSTEM cu control total. Refuză un folder cu intrări explicite, ca revenirea să rămână exactă;
- `-Verify`: fără grupuri largi, fără moștenire, listare permisă ție;
- `-Rollback`: folderul revine la moștenire, adică exact starea dinainte.

**Ce nu face:** nu atinge `~/.codex`, nu adaugă reguli DENY (o negare globală ar rupe vocea sau Codex) și nu schimbă folderul părinte sau motorul vocal.

**Verificat pe un folder temporar:**
- `-Apply` → doar SYSTEM și contul tău;
- un al doilea `-Apply` e refuzat;
- `-Rollback` → aceleași 9 intrări moștenite ca înainte.

## A3 · Copiile deja sincronizate

Mutarea locală **nu șterge** ce s-a sincronizat deja în OneDrive (inclusiv istoricul de versiuni și Coșul din cloud). Opțiunea A3 doar recunoaște asta. Păstrarea sau ștergerea lor e decizia ta, separată, și nimic nu se șterge automat. Copiile locale vechi rămân și ele până decizi.

## Ce se întâmplă după A

Pachetul B se deblochează doar când A1 și A2 sunt **decise**, iar cele aprobate sunt **executate**. „Executată” se citește din realitate: pointerul pentru A1, ACL-ul restrâns pentru A2. O opțiune respinsă contează ca decisă.
