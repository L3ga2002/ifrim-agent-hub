# M10 — Starea implementării

Versiune cod: `2.11.0-m10`, contract API 10, migrarea 10 `m10-operator-plans`. Necomis pe `v2-milestone-01` (peste M09, de asemenea necomis). Hub-ul live: `2.10.0-m09`.

## Ce e implementat (fișiere)

| Zonă | Fișiere |
|---|---|
| Backup obligatoriu + runner de upgrade | `server/storage/db.mjs` (backup înainte de migrare, `PRE_MIGRATION_BACKUP_FAILED`), `server/storage/upgrade.mjs`, `scripts/upgrade.mjs` (construiește și helperul), `scripts/migration-dry-run.mjs` (tabelele M10) |
| Politica de acțiuni | `server/policy/action-policy.mjs` (LOCAL_DIRECT / PLAN_STEP / SENSITIVE / REFUSED; diacritice normalizate; procese protejate fără „.exe”) |
| Helperul desktop | `desktop/operator/IfrimOperator.cs` (C# 5, UIA, HMAC, nonce, autoritate, stop, input utilizator, desktop securizat, DPI, descoperire, Authenticode), `scripts/build-operator.mjs` (`/codepage:65001`, manifest binar ↔ sursă) |
| Clientul + serviciul | `server/desktop/operator-client.mjs`, `server/desktop/apps.mjs`, `server/desktop/operator.mjs`, `server/desktop/profiles.mjs`, `config/desktop-apps.json` |
| Planuri fără formulare | `server/ops/plans.mjs`, `server/ops/executors.mjs`, `server/ops/intent-actions.mjs`, `server/ops/ops-commands.mjs`, `server/ops/ops-routes.mjs` |
| Lega (text + voce) | `server/owner/intents.mjs` (desktop_open / focus / folder, studio_import_here, studio_variant, ops_capture_vertical, ops_continue, not_yet), `server/owner/owner-commands.mjs` („Da” pentru planul afișat, inclusiv pe calea vocală; Pauză / Preiau eu / Oprește tot opresc și operatorul) |
| Stop All | `server/runtime/command-catalog.mjs` (`system.stop_all` oprește și operatorul, iar planurile trec pe pauză) |
| Studio | `server/media/project-bundle.mjs`, `server/media/import-access.mjs`, `server/media/index.mjs` (export local, rădăcini o dată), `server/media/review.mjs` (`preferredTextTarget`, `selectedItemId`, `options`), `server/media/compile.mjs` + `variants.mjs` + `qa.mjs` (plăcuță întărită ≥ 0,9 garantată în filtrul de randare, scară, QA de lizibilitate măsurat în jurul literelor reale), `server/media/capture.mjs` (aprobarea scopului, OBS cu stare și reconciliere) |
| UI | `web/src/screens/lega/OpsPlanCard.jsx`, `web/src/shell/DesktopBar.jsx`, `web/src/screens/Desktop.jsx` (pagina Operator + panoul OBS), `web/src/screens/studio/ProjectImport.jsx`, `web/src/screens/studio/Player.jsx` (textul vizat, opțiunile), `web/src/lib/opsLogic.js`, `web/src/lib/studioLogic.js`, `web/src/styles/m10.css` |
| Unelte manuale | `tests/manual/m10-desktop-real.mjs` (`--discover`, `--open`, `--capcut-inspect`, `--notepad`), `tests/manual/m09-clip-produce.mjs` (exportul pachetului) |

## Matricea aplicație × operație (verificată, nu presupusă)

Niveluri:

- **VERIFIED_FIXTURE**: test automat cu helperul-fixture determinist.
- **REAL_READONLY**: verificat cu helperul real, fără a atinge desktopul.
- **PENDING_LIVE**: rulează la tine, din foaia de activare.

| Aplicație | Operație | Implementare | Verificare |
|---|---|---|---|
| Toate | descoperire + identitate (Authenticode) | helper `discoverApps` + `apps.mjs` | **REAL_READONLY**: toate 4 DISCOVERED, semnături de încredere (2026-10-04) |
| Toate | protocol, semnătură, reluare, termen, autoritate, scop fail-closed, citirea tablourilor JSON | helper | **REAL_READONLY**: M10-OR-01..03 |
| Notepad | deschide / prim-plan (D1) | LOCAL_DIRECT | VERIFIED_FIXTURE (DO-01); PENDING_LIVE |
| Notepad | editare + Save As + verificare pe disc + reidentificare (D2) | `notepadEditSave` | VERIFIED_FIXTURE (DO-06/07/08/10); PENDING_LIVE (`--notepad --watching`) |
| File Explorer | arată folderul aprobat, citește folderul din față | LOCAL_DIRECT, `explorerWindows` (Shell.Application) | VERIFIED_FIXTURE (DO-13, ST-08); PENDING_LIVE |
| File Explorer | selectarea fișierelor | — | UNSUPPORTED (intenționat) |
| OBS | deschide / prim-plan | LOCAL_DIRECT | VERIFIED_FIXTURE; PENDING_LIVE |
| OBS | înregistrare start / stop / stare / scenă, import | WebSocket 5 (nu clickuri) | VERIFIED cu OBS simulat (ST-11, M09 CP-*); PENDING_LIVE (cere MB1 + WebSocket) |
| CapCut | deschide / prim-plan | LOCAL_DIRECT | VERIFIED_FIXTURE (DO-01/03); PENDING_LIVE |
| CapCut | inspecție structurală (D6) | `capcutInspect` | VERIFIED_FIXTURE; PENDING_LIVE (`--capcut-inspect`) — verdictul real necunoscut încă |
| CapCut | proiect nou + import (D6) | `capcutNewProjectImport` | VERIFIED_FIXTURE (DO-12); real: UNVERIFIED până la inspecție |
| CapCut | export către platforme | — | REFUZAT (buton sensibil); exportul rămâne ASSISTED_ONLY |
| Studio | import proiect (D3), reconstruire, foldere o dată / permanente | `project-bundle.mjs`, `import-access.mjs` | VERIFIED (ST-01/02/03/08, cu ffmpeg real) |
| Studio | corectură = plan (aplicare + randare + QA) (D4) | `media.edit.correct` | VERIFIED (ST-09) |
| Studio | variantă verticală cu lizibilitate | `media.variant.render` | VERIFIED (ST-05/06/11) + randarea reală a clipului M09 |
| Studio | export local | `exportLocal` | VERIFIED (ST-07) |
| Lega | aceleași intenții pe text și voce, „Da” doar pentru cardul afișat | `intents.mjs`, `owner-commands.mjs` | VERIFIED (DO-03, OP-09/10, ST-08/09/11, M10-UI-E2E-01) |

## Ce NU e implementat sau rămâne deschis (onest)

- **Rularea live pe Hub:** upgrade-ul la M10 și demonstrațiile GUI reale sunt pașii tăi din foaia de activare. N-am rulat nicio acțiune GUI reală pe desktopul tău; am rulat doar descoperirea read-only.
- **CapCut:** controlul GUI depinde de cât expune Qt prin UI Automation; verdictul se află la prima inspecție. Proiectele tale personale nu se ating. Exportul și publicarea nu se fac.
- **Prim-planul Windows:** poate fi refuzat. Atunci răspunsul o spune, nu raportează succes.
- **Un import eșuat la jumătate** lasă proiectul parțial creat (marcat FAILED în importuri). Un reimport creează unul nou. E notat în OPEN_ISSUES.
- **QA de lizibilitate:** euristică pe un singur cadru per text, declarată ca atare.
