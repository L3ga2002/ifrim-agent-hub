# Backup și restaurare (V2)

Implementare: `v2/server/backup/backup.mjs`, `v2/server/backup/zip.mjs`, `v2/server/domain/backups.mjs`. Teste: `v2/tests/backup.test.mjs`.

## Garanție păstrată din V1

Nicio execuție cu model nu este admisă fără un backup **complet** (0 fișiere sărite), **restaurat și verificat**, mai nou de 30 de minute. Dacă lipsește, Hub-ul îl creează înainte de admitere; dacă eșuează, run-ul este înregistrat `blocked` înainte de model.

## Cauza incidentului V1 (HUB-018, backup > 120 s)

1. Scriptul PowerShell compara căi relative cu separatori diferiți, așa că `.ifrim/BACKUPS` (246 MB de arhive) era parcurs și re-arhivat. Corecția V1 din `apps/api/src/server.mjs` normalizează separatorii.
2. În V2 am reprodus pe fixture o formă de lentoare separată: diagnosticul OneDrive parcurgea recursiv `.ifrim/private` (runtime-ul OpenClaw) și ajungea la timeout după 22 s. Corecție: verificare non-recursivă doar în directoarele copiate efectiv (42 de directoare, 4,6 s).

Corecția V1 nu a fost reîncărcată în API-ul V1 activ (PID 28392). V2 nu folosește acel cod.

## Reguli

- Tăiate **înainte** de parcurgere: `node_modules`, `.git`, `dist`, `build`, `.next`, `.vite`, `.venv`, `venv`, `__pycache__`, `.pytest_cache`, `.playwright-cli`, `coverage`, `.cache`, `.turbo`, `.parcel-cache`, `.gradle`, `.expo`, directoarele `.env*`, `.ifrim/BACKUPS`, `.ifrim/private`, `.ifrim/tmp`.
- Excluse după nume, listate în manifest: fișierele de tip secret (`.env*` cu excepția `.env.example`, `*.pem`, `*.key`, `*.pfx`, `id_rsa*`, `.npmrc`, `credentials*`, `auth.json`). Se restaurează din sursa lor protejată.
- Symlink-uri și junction-uri: nu sunt urmate; sunt listate.
- Bazele SQLite din proiect: copiate prin API-ul oficial de backup SQLite (consistent și cu WAL activ), cu `integrity_check`.
- Baze suplimentare pentru Agent Hub: `hub-v2` (conexiunea live) și `hub-v1` (read-only), ca fișiere separate, private.
- Manifest: SHA-256 per fișier, reguli, excluderi, fișiere OneDrive online-only (citite oricum), baze de date cu număr de rânduri.
- Buget de timp: depășirea produce `failed`, niciodată un backup parțial marcat „creat”.

## Verificarea restaurării

Arhiva se extrage într-un director privat `.ifrim/tmp/v2/restore-verify-*`. Se verifică SHA-256 și mărimea fiecărui fișier, `integrity_check` și numărul de rânduri per tabel pentru fiecare bază. Nu se contactează niciun provider. Directorul temporar se șterge apoi.

## Execuție reală (2026-09-29, Agent Hub)

`bkp_mun7qdb3_88891aba89`: **verified**. 245 fișiere, 4,29 MB sursă, arhivă 2,98 MB, 0 sărite. `hub-v2` și `hub-v1` au `integrity ok`. Restaurare: 245/245 fișiere, 2/2 baze, 0 probleme. Durată: 44 s creare (cu diagnosticul OneDrive vechi) + 16 s verificare, în timp ce suita de teste rula în paralel. După corecția diagnosticului, colectarea durează ~0,9 s și diagnosticul ~4,6 s.

Arhive: `.ifrim/BACKUPS/v2/` (ignorat de Git). Snapshot-urile de rebuild: `.ifrim/BACKUPS/v2-rebuild/`.

## Milestone 01 (2026-09-30)

- **Checkpoint de start** (`.ifrim/CHECKPOINTS/2026-09-30-milestone-01-start.json`): `bkp_mun98kt4_4e90e12ab3` — verified, 259 fișiere, 0 sărite, restaurare OK, 2 baze. Manifestul checkpointului conține HEAD `e9ab563`, cele 113 fișiere necomise cu SHA-256, porturile active și starea Hub-ului (BUILD_SAFE, poartă suspendată, 0 execuții).
- **Migrarea 2 pe copie** (`v2/tests/manual/migration-on-copy.mjs`): copie coerentă a bazei live prin API-ul de backup SQLite, migrată separat: `integrity_check` ok, 0 încălcări FK, 22 de tabele noi, 0 rânduri pierdute (6 conversații, 39 mesaje, 26 taskuri, 21 execuții, 83 backup-uri, 40 aprobări, 565 evenimente). Abia apoi Hub-ul live a fost repornit pe schema 2.
- **Backup real după migrare:** `bkp_munfsdem_b334f5f4fd` — verified, 310 fișiere, 0 sărite, ambele baze `integrity ok`, restaurare OK; poarta de backup raportează OK.
- **Defect corectat:** backup-urile rulate cu slug-ul proiectului (`ifrim-agent-hub`) erau înregistrate sub slug, iar poarta le căuta după id, deci raporta „Niciun backup verificat”. `backups.run/list/freshVerified` rezolvă acum id sau slug și cheiază după id (test `M01-BKP-SLUG`).
- **Backup de final Milestone 01:** `bkp_munni08k_40e7f81a95` — verified, 323 fișiere, 0 sărite, `hub-v2` + `hub-v1` cu `integrity ok`, colectare 1,9 s (după restartul PC-ului, cu Hub-ul repornit). Referit în `.ifrim/CHECKPOINTS/2026-09-30-milestone-01-done.md`.
- Checkpoint ≠ Backup ≠ Migrare ≠ Commit: checkpointul Hub (`checkpoint.create`) referențiază ultimul backup verificat, dar nu îl înlocuiește; niciun pas nu face commit.

## Restaurare reală (manuală, cu aprobarea ta)

V2 nu suprascrie niciodată automat proiectul. Pași:
1. Oprește V2 (`npm run v2:stop`) și procesele proiectului.
2. Fă un backup nou al stării curente.
3. Extrage arhiva aleasă într-un director separat și compară-l cu manifestul (SHA-256).
4. Copiază manual fișierele dorite; pentru baze, înlocuiește fișierul doar cu serverul oprit.
5. Pornește V2 și rulează `npm run test:v2`.
