# M03 · Raport de performanță: cele ~8 minute până la prima comandă Codex

Data: 2026-10-01. Ce s-a măsurat, ce nu și ce a fost reparat. Fără percentile: numărul de observații e mic și e declarat.

## 1. Înainte (execuțiile live din 2026-09-30, n = 2, „rece” pentru fiecare execuție)

Sursa: evenimentele persistate ale execuțiilor, citite prin API-ul Hub-ului (doar citire). Timpii sunt în secunde de la crearea execuției.

| Execuție | Acces | Hub: cerere → turn trimis | Turn → prima comandă | Prima modificare de fișier | Total | Efort raportat de thread |
|---|---|---|---|---|---|---|
| `run_muojnivb_b113ce0591` | workspace-write | 7,0 s (auth 0,9 · thread 6,9) | **289,5 s** | 466,8 s | 757,6 s | `max` (moștenit din config) |
| `run_muomogfu_f3b3dcccd7` | read-only | 4,4 s (auth 2,8 · thread 3,9) | **466,8 s** | — | 546,5 s | `max` (moștenit din config) |

**Concluzii susținute de date:**
- Partea Hub-ului (poartă, lease, grant, backup proaspăt, git, pornirea procesului, handshake, verificarea contului, thread, MCP) a durat 4–7 s. **Nu Hub-ul e cauza.**
- Aproape tot timpul (290–467 s) se scurge între `turn/start` și primul eveniment `item/started` de comandă.
- După prima comandă, comenzile vin la 0,1–22 s una de alta.
- Ambele thread-uri au raportat efortul `max` din config-ul tău: Hub-ul nu trimitea niciun efort.

**Ce NU se poate spune din aceste date:** cât din cele 290–467 s e raționament la efort `max` și cât e pregătirea sandbox-ului Windows (sincronizarea ACL pe căile negate, inclusiv arbori mari ca `~/.claude`). Evenimentele vechi nu le separă. Ipoteza H1 (sandbox) și ipoteza H2 (efort `max`) rămân amândouă deschise.

## 2. Ce s-a schimbat

**Cronologie pe faze pentru fiecare execuție** (`agent_runs.timeline_json`, `v2/server/runtime/timeline.mjs`):
- **Fazele înregistrate:** cerere, aprobare cerută/decisă, admitere, plan, poartă, lease, grant, backup, git, înregistrare, proces, handshake, cont, limite, thread, MCP, turn trimis, turn acceptat, primul eveniment, prima comandă începută, **prima comandă terminată**, prima modificare de fișier, primul text, final.
- **Atribuirea timpului:** fiecare segment e pus pe seama cuiva: om, Hub, provider, model-sau-sandbox, execuția unei comenzi.
- **Unde se vede:** în Inspector (Focus) și în panoul Software Factory.

**Efort explicit:** implicit profilul BALANCED (`medium`), setat pentru proces și verificat în `thread/start`. Un `max` moștenit oprește acum execuția înainte de turn.

Am mai verificat:
- **Așteptări fixe și poll-uri ale Hub-ului:**
  - persistarea textului la 700 ms;
  - poll de 50 ms doar la întreruperea unui turn în curs de pornire;
  - scheduler la 15 s, doar pentru housekeeping.

  Niciuna nu e în drumul critic dinaintea turnului.
- **Timeout-uri:** `thread/start` 120 s (după reparația din `30bfbef`), `turn/start` 60 s. Nu se suprapun.
- **Descoperirea AGENTS.md:** a fost eliminată în `30bfbef`, deci nu mai există scanări inutile.

## 3. După

Nicio execuție cu model nu a fost pornită în M03.

### 3.1 Sandbox-ul singur, fără model, profil fictiv: PASS_LOCAL (2026-10-01)

Comanda: `node v2/tests/manual/codex-sandbox-timing.mjs --fictive`, rulată la cererea ta. Codex CLI 0.159.2 (binar `c6fe824d725f02d7`). Fiecare comandă trece prin `codex sandbox` cu profilul Hub, pe un arbore fictiv din `%TEMP%`.

| Rundă | `cmd /c` | `node --version` |
|---|---|---|
| 1 (rece) | **4,7 s** | 6,2 s |
| 2 (cald) | 3,7 s | 6,4 s |
| 3 (cald) | 4,9 s | 5,6 s |

N = 6 observații, toate cu exit 0. Arborele temporar a fost șters.

**Ce arată:**
- Pe un profil mic, sandbox-ul Windows costă **~4–6 s pe comandă**, rece sau cald. Nu minute.
- Costul e plătit la fiecare comandă: un QA cu 3 comenzi adaugă ~15 s. E acceptabil, dar e un cost real, nu zero.

**Ce NU arată încă:** profilul tău real neagă arbori mari (de exemplu `~/.claude`), iar sincronizarea ACL poate dura mai mult acolo. H1 nu e exclus pentru profilul real; e exclus doar pentru unul mic. Rămâne `--real-profile` (rulat de tine, fiindcă reaplică DENY-urile reale).

### 3.2 Măsurătorile care lipsesc

1. **Fără model (tu, în terminalul tău):** `node v2/tests/manual/codex-sandbox-timing.mjs --real-profile`.
   - Dacă prima comandă durează tot secunde → cauza celor ~8 minute e raționamentul la `max` (H2).
   - Dacă durează minute → cauza e sincronizarea ACL pe căile reale (H1).
2. **Cu model (grant separat):** un turn Codex read-only, același task ca `run_muomogfu`, cu efort `medium`. Comparăm:
   - `turn_sent` → `first_command_started`, care măsoară raționamentul plus emiterea comenzii;
   - `first_command_started` → `first_command_completed`, care măsoară execuția comenzii, sandbox inclus.

   Se notează separat rece (primul turn) și cald (al doilea turn, același thread).

Nu promit o durată finală înaintea acestor măsurători.

## 4. În simulare (fără valoare de performanță reală)

Testele cu provideri falși înregistrează aceleași faze. Ele dovedesc că instrumentarea funcționează (M03-TL-01, M03-FAC-01), nu viteza reală.

Un flux Software Factory simulat complet durează 30–90 s pe acest calculator, din cauza pornirii proceselor Node. Timpul nu e reprezentativ pentru providerii reali.

## 4. Live: proba 2.1, Codex writer prin Software Factory pe Demo A (2026-10-01, PASS_LIVE, n = 1)

Execuția `run_muphc63x_ef0699abd6`: `gpt-6.1-sol`, efort `medium` (trimis explicit și confirmat de thread), workspace-write, profil `ifrim_hub_rw`.

| Fază | Durată |
|---|---|
| Hub: cerere → turn trimis (poartă, lease, grant, backup, git, proces, handshake, cont, limite, thread, MCP) | **4,2 s** |
| Turn → primul text | 4,9 s |
| Turn → **prima comandă** | **14,1 s** (înainte: 290–467 s la `max`) |
| Prima comandă, execuția ei în sandbox | 6,2 s |
| Prima comandă terminată → prima modificare de fișier | 48,2 s |
| Prima modificare → final | 57,4 s |
| **Total execuție** | **130,1 s** |

Runner-ul Hub, prin `codex sandbox` cu profilul real:

| Comandă | Durată |
|---|---|
| baseline: `node --test test/acceptance.test.mjs` (prima comandă din sandbox după acordul R3) | **151,3 s** |
| verificări: `node --test` (a doua comandă) | **5,2 s** |

**Concluzie, cu n = 1:**
- **Cauza principală a celor ~8 minute era efortul `max` moștenit (H2).** La `medium`, turn → prima comandă coboară de la 290–467 s la 14 s.
- **Sandbox-ul (H1) are un cost unic, nu repetat.** Prima comandă din sandbox cu profilul real a durat ~2,5 minute, foarte probabil scrierea ACL-urilor DENY pe căile reale (inclusiv intrările R3 noi). Comenzile următoare iau ~5–6 s.
- Pentru o concluzie fermă trebuie mai multe măsurători: o a doua execuție rece și `--real-profile`.
