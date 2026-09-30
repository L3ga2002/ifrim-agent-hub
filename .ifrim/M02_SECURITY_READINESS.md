# M02 — Security readiness (§05, §15, §24)

Data: 2026-09-30 · Hub V2 `2.2.0-m02` · BUILD_SAFE, poartă suspendată · nicio inferență, niciun model pornit.

## Concluzie

Riscul raportat pentru Codex (sandbox-ul putea citi `.ifrim/private`, `.env`, credențiale) este **remediat prin control la nivel de sistem de operare**, verificat pe fișiere fictive (canary). Nu mai depinde de instrucțiunea „nu citi .env”.

Remedierea lasă însă o urmă persistentă, așa că ruta live Codex rămâne **blocată de poartă** până la aprobarea ta explicită (`NEEDS_LIVE_APPROVAL`). Claude rămâne limitat la doar-citire, cu reguli la nivel de unealtă; Claude cu shell/scriere este `SECURITY_BLOCKER` pe Windows nativ.

| Traseu | Limită | Stare |
|---|---|---|
| Codex · doar citire | OS: sandbox Windows `elevated` + profil `ifrim_hub_ro` | izolare verificată local (46/46 canary); pe mașina reală `NEEDS_LIVE_APPROVAL` (acord ACL) + „Verifică contul” recent |
| Codex · scriere în workspace | OS: `ifrim_hub_rw` (scriere doar în workspace) | la fel |
| Claude Code · doar citire | Unelte Read/Glob/Grep + reguli deny absolute (Claude Code) | permis de poartă; limită la nivel de unealtă, nu OS |
| Claude Code · scriere/shell | nicio limită OS pe Windows nativ | `SECURITY_BLOCKER` |

## Cele trei straturi

1. **Backend-ul Hub**: citește legitim date private (DB, loguri, backupuri). Nu le expune prin API-uri de fișiere, artefacte, căutare sau export.
2. **Clientul oficial și autentificarea lui** (Codex app-server, Claude Code): nu sunt restricționate; autentificarea oficială rămâne intactă.
3. **Uneltele, shell-ul și codul rulat de model**: aici se aplică izolarea.

## Codex — izolare la nivel OS

- **Mecanism.** Pe acest calculator, Codex folosește sandbox-ul nativ Windows `elevated`: utilizatori dedicați `CodexSandbox*` și ACL-uri.
  - Hub-ul trimite fiecărui proces app-server două profiluri de permisiuni (`-c permissions.ifrim_hub_ro=…`, `ifrim_hub_rw=…`), plus `default_permissions` și `windows.sandbox="elevated"`.
  - Nimic nu se scrie în `~/.codex/config.toml`.
  - Parametrii vechi `sandbox`/`sandboxPolicy` nu se mai trimit (nu se combină cu profilurile).
- **Opriri înainte de turn** (`v2/server/providers/codex.mjs`):
  - thread raportat `dangerFullAccess`;
  - `workspaceWrite` la o rulare read-only;
  - reviewer diferit de `user`;
  - schimbare de model.
- **Poarta** (`v2/server/policy/gate.mjs` → `isolation`). Cere:
  - `windowsSandbox/readiness = ready`;
  - profilul Hub raportat „allowed” de `permissionProfile/list`;
  - pe Windows, acordul tău pentru exact lista curentă de căi (amprentă).
- **Căi negate** (`v2/server/policy/isolation.mjs`):
  - în workspace: `.ifrim/private`, `.ifrim/BACKUPS`, `.ifrim/tmp`, `**/.env`, `**/.env.*`;
  - absolut, pentru Hub (și când workspace-ul e alt proiect): `<Hub>/.ifrim/private`, `<Hub>/.ifrim/BACKUPS`, `<Hub>/.ifrim/tmp`, `<Hub>/.env`, `<Hub>/.env.*`, plus directoarele de date și backup configurate;
  - home, directoare întregi: `.claude`, `.ssh`, `.aws`, `.azure`, `.docker`, `.gnupg`, `.config/gh`, `.openclaw`;
  - home, în `~/.codex` doar: `auth.json`, `secrets`, `sessions`, `archived_sessions`;
  - rețea oprită pentru comenzile modelului.
- **Lista reală de pe acest calculator**: 16 căi, amprentă `9cab02fd58238507`, vizibilă în Integrări → Izolare.

### Constatări verificate fără model (fișiere fictive, 2026-09-30)

| # | Constatare | Consecință în design |
|---|---|---|
| F1 | Profilul cu `:root = deny` este refuzat de sandbox-ul elevated; cere `:root = read` | se neagă căi specifice, nu tot discul |
| F2 | Negarea se aplică scriind un ACE **DENY-read moștenibil** pentru grupul `CodexSandboxUsers` pe cale | afectează doar identitățile sandbox-ului, nu contul tău |
| F3 | ACE-ul **rămâne** după rulare; o rulare ulterioară fără negare nu îl elimină | se aplică și sesiunilor Codex desktop → cere acordul tău explicit (poarta blochează fără el) |
| F4 | O intrare „read” pe un subdirector **nu** anulează negarea părintelui | `~/.codex` nu se neagă întreg: runner-ul sandbox-ului rulează din `~/.codex/.sandbox-bin` |
| F5 | Glob-urile absolute funcționează (`<rădăcină>/**/.env`, `<rădăcină>/**/.ifrim/private`), inclusiv imbricat | opțiune pregătită pentru protecția altor proiecte (vezi Rezidual R2) |
| F6 | Căile absolute ale Hub-ului sunt negate și când workspace-ul este un proiect separat | închide golul pentru proiectul de test sanitizat |
| F7 | Pe căile reale (`~/.codex`, `~/.ssh`, `.ifrim/private` etc.) există azi **0 ACE-uri DENY**; ACE-urile `CodexSandbox` existente sunt drepturile de lucru acordate de Codex desktop în folosirea ta normală | nimic din M02 nu a modificat ACL-uri reale; azi sandbox-ul Codex desktop poate citi `.ifrim/private` (riscul inițial) |

**Revenire pentru orice cale**, după o validare live:

```bash
icacls "<cale>" /remove:d CodexSandboxUsers
```

### Canary (PASS_LOCAL)

- Script: `node v2/tests/manual/codex-sandbox-canary.mjs`, cu `codex sandbox -P` și profilul exact al Hub-ului.
- Rulează într-un arbore temporar din `%TEMP%`: un Hub fals, un home fals și un workspace separat. Arborele se șterge la final.
- Nu trimite nimic la model și nu afișează conținut.
- Rezultat: **46/46 PASS_LOCAL** (binary `c6fe824d725f02d7`, Codex 0.159.2).
- Pentru fiecare profil (ro, rw), verificările acoperă:
  - README din workspace citibil;
  - `.ifrim/private|BACKUPS|tmp`, `.env`, `app/.env.local` și junction-ul spre `.ifrim/private` negate;
  - `<hub>/README.md` citibil;
  - `<hub>/.ifrim/*`, `<hub>/.env`, `<hub>/.env.production` și `<data>` negate;
  - `~/.ssh`, `~/.codex/auth.json`, `~/.codex/sessions`, `~/.claude/.credentials.json`, `~/.config/gh` negate;
  - `~/.codex/.sandbox-bin` și `~/.codex/config.toml` citibile;
  - scriere: ro refuzată, rw permisă în workspace, refuzată în `.ifrim/private`.
- Rulare anterioară, înainte de negările absolute: 24/24 PASS_LOCAL.

### Preflight real (pregătit, NU rulat)

`node v2/tests/manual/codex-real-profile-preflight.mjs --consent-fingerprint=<amprenta>` rulează comenzi simple sub sandbox-ul real, cu profilul real:
- `echo`;
- `README` citibil;
- `dir` pe `.ifrim/private`, `.ifrim/BACKUPS`, `~/.ssh`;
- `type` pe `~/.codex/auth.json`, cu ieșirea redirecționată spre `nul`;
- `.sandbox-bin` citibil.

Detalii de funcționare:
- **Scrie ACE-urile pe căile reale**, deci refuză să ruleze fără amprenta aprobată.
- Nu afișează nume de fișiere sau conținut din căile protejate.
- Este primul pas al planului live.

## Claude Code — limită la nivel de unealtă

- Rulările read-only folosesc doar `Read`/`Glob`/`Grep`.
- `--disallowedTools` primește:
  - reguli relative și absolute (`//c/...`) pentru `.ifrim/private|BACKUPS|tmp` din proiect **și din Hub**;
  - `.env`/`.env.*` oriunde;
  - directoarele de credențiale din home, inclusiv `~/.codex` întreg (regula Claude nu are efect pe disc).
- Alte protecții: `--setting-sources user`, `--no-chrome`, MCP gol (`--strict-mcp-config`) și mediul `CLAUDE_GUARD_ENV`:
  - advisor, fast mode, 1M, workflows, cron, background tasks și auto-memory sunt oprite;
  - comenzile de upgrade, login și extra usage sunt dezactivate.
- Modele refuzate: Fable, `best`, `[1m]`.
- Sandbox-ul Bash al Claude Code nu există pe Windows nativ (docs: code.claude.com/docs/en/sandboxing), deci accesul cu shell/scriere este `SECURITY_BLOCKER` în poartă.

## Rutele Hub (server, nu doar ascundere în UI)

- **`resolveInScope`** (`v2/server/security/paths.mjs`):
  - refuză `.ifrim/private|backups|tmp`, `.git` și numele de tip secret, case-insensitive și cu separatori mixți;
  - verifică și calea reală după `realpath`, deci un junction spre o zonă protejată este refuzat.
- **`files.list`** ascunde intrările protejate.
- **`files.read`** e paginat (≤256 KB pe pagină) și refuză fișierele binare.
- **`files.search`** caută literal, sare peste zonele protejate, symlink-uri, `node_modules`/`dist`, binare și fișiere >1 MB, și redactează rezultatele.
- **`artifact.register`** judecă zonele protejate relativ la proiect și pe calea reală. A fost corectat în M02 după o regresie găsită de suita M01 (vezi Test report).
- **Istoricul `tool-calls`** este redactat.
- **Screenshot-urile browserului** sunt servite doar după regex (`^shot_[a-z0-9_]+\.png$`).

## Suprafețe UI noi (§24)

- **Markdown**: parser de tokeni, fără HTML brut; linkurile nesigure (`javascript:`, `data:`) devin text.
- **Aprobări**: acțiune exactă, argumente, țintă, versiune, expirare și amprentă. Execuția se face doar prin rutele backend (`/api/approvals/:id/execute`); butoanele dezactivate nu sunt singura protecție.
- **Acordul de izolare**: text exact + amprenta listei curente. O pagină veche nu poate aproba altă listă (`conflict`). Vocea nu poate da acordul (canal refuzat). Retragerea e posibilă și din voce.
- **Rețea**: server doar pe `127.0.0.1`, origini permise explicit, fără CORS wildcard, fără port nou, fără service worker.
- **Simulatorul**:
  - proces separat pe 8012, DB în `.ifrim/tmp/v2-sim`;
  - supervisorul refuză orice executabil din afara `v2/tests/fixtures`;
  - `/api/sim` răspunde 404 în Hub-ul real;
  - proiectul demo git este creat de scriptul `v2/scripts/sim-demo.mjs`, nu de server (invariant M01-NG1: `v2/server` nu rulează git mutant).
- **Browser Workspace**:
  - doar URL-uri locale cu port explicit, niciodată Hub-ul;
  - context nou, service workers blocați, descărcări refuzate;
  - aprobare legată de URL-ul exact;
  - Playwright nu este instalat → `NEEDS_INSTALL_APPROVAL`, iar registrul de integrări raportează `needs_setup`, nu „available”.
- **Erori UI**: error boundary pe ecran și pe nucleu. O eroare nu mai golește aplicația; Stop All rămâne disponibil. Verificat prin injectare de eroare.

## Rezidual și blocaje

| ID | Descriere | Stare |
|---|---|---|
| R1 | ACE-urile DENY persistente ale Codex (F2–F3) | `NEEDS_LIVE_APPROVAL`: acord în Integrări → Izolare, apoi preflight |
| R2 | Codex (`:root = read`) poate citi fișiere neprotejate ale **altor proiecte** (cod sursă, `.env` ale altor proiecte) prin cale absolută | pregătit: glob-uri absolute pe `Ifrim Digital Proiecte/**/.env*` și `**/.ifrim/private` (F5); neactivat, pentru că ar scrie ACE-uri în alte proiecte → decizia ta |
| R3 | `~/.codex/config.toml` (și copiile `config.toml.*`) rămân citibile de sandbox; pot conține valori de mediu pentru servere MCP | de verificat în preflight dacă runner-ul funcționează cu `config.toml*` negat; abia apoi se extinde lista (amprentă nouă, acord nou) |
| R4 | Claude read-only: limită la nivel de unealtă, nu OS | acceptat pentru read-only; shell/scriere rămâne `SECURITY_BLOCKER` |
| R5 | Testul symlink de fișier | `SKIPPED_ENV` (EPERM fără Developer Mode); junction-urile sunt testate real. Developer Mode nu a fost activat |
| R6 | Ultima „Verifică contul” Codex de pe Hub-ul real (13:01) precede citirea sandbox-ului | poarta raportează „neverificat” până la o nouă verificare (contactează OpenAI fără inferență → aprobarea ta) |
