# Runbook — Ifrim Agent Hub V2

## Milestone 02 (2026-09-30)

### Comenzi

```bash
npm run build:v2       # după orice modificare de UI
npm run v2             # Hub real: http://127.0.0.1:8011/ (BUILD_SAFE, poartă suspendată)
npm run v2:status
npm run v2:stop
npm run v2:sim         # SIMULATOR: http://127.0.0.1:8012/ — „SIMULARE — FĂRĂ MODELE REALE”
npm run v2:sim:stop
npm run test:v2        # teste V2, fără modele (~4 min)
npm run v2:test-project # creează și înregistrează proiectul de TEST sanitizat (Ifrim Digital Proiecte/ifrim-hub-live-test)
node v2/tests/manual/codex-sandbox-canary.mjs   # izolarea Codex pe fișiere fictive din %TEMP% (fără model)
```

### Simulatorul

- Proces separat, cu date recreate la fiecare pornire în `.ifrim/tmp/v2-sim/data`.
- Rulează pe un proiect demo git sintetic, creat de `v2/scripts/sim-demo.mjs`.
- Folosește doar fixture-uri Codex/Claude: nu poate porni un model real și nu atinge DB-ul, poarta sau grant-urile Hub-ului real.
- Scenarii: butoanele din bannerul simulatorului (Execuție, Aprobare, Cotă, Eroare auth, Handoff, Deconectare; pe desktop). Echivalent în API: `POST /api/sim/{execute|approval|quota|error|handoff|drop-stream}`, cu token-ul sesiunii.

### Izolare

- Integrări → „Izolare workspace” arată ce nu pot citi uneltele modelului și starea fiecărui traseu.
- Codex pe Windows cere acordul pentru ACL-urile persistente scrise de sandbox. Detalii în `M02_SECURITY_READINESS.md`.
- Revenire pentru o cale: `icacls "<cale>" /remove:d CodexSandboxUsers`.
- Validarea live urmează strict `M02_LIVE_VALIDATION_PLAN.md`: preflight real → verificare cont → un turn read-only per provider.

### Scurtături UI

| Scurtătură | Acțiune |
|---|---|
| Ctrl+K | paletă |
| Alt+M | mini-asistent |
| Alt+1…9 | navigare (cifra apare în tooltip și în paletă) |
| Ctrl+Enter | trimite din compozitor |
| Esc | închide dialogul sau paleta |

Scurtăturile nu sunt interceptate cât scrii într-un câmp.

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
3. Integrări → grant: provider, acces „doar citire”, 1 încercare, 30 min, cu scop scris.
4. Tastează `OPEN GATE` → „Deschide poarta”.
5. Rulează din conversație. Hub-ul creează backup-ul verificat automat dacă e nevoie.
6. După test: Stop All sau „Suspendă poarta” și „Revino la BUILD_SAFE”. Orice restart revine oricum la BUILD_SAFE.

## Incidente

- **Stop All** (buton roșu sau vocea „Oprește”): suspendă poarta, revocă grant-urile, întrerupe execuțiile controlabile și raportează separat taskurile cloud (nu există) și efectele ireversibile.
- **Lease reținut** după crash: vezi Sănătate → Recuperare. Verifică procesul raportat, apoi reconciliază înainte de a redeschide poarta (poarta refuză deschiderea cât timp există lease-uri reținute).
- **Hub nu pornește**: citește logul; verifică portul cu `npm run v2:status`. Nu opri procese pe care V2 nu le-a pornit.
- **Restaurare**: `.ifrim/V2_BACKUP_RESTORE.md`.

## Cutover V1 → V2 (decizia ta)

V2 rulează pe 8011 lângă V1. Pentru a-l muta pe 3004/8004: oprește tray-ul și procesele V1, apoi `HUB_V2_PORT=8004 npm run v2` sau actualizează portul în `v2/server/config.mjs`/`v2/scripts/common.mjs`, apoi actualizează `PORTS.md` (global, doar cu acordul tău). OpenClaw Gateway (PID 23596) și taskul programat Windows rămân de decis separat.
