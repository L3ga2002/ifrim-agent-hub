# Modelul de securitate V2

## Rețea și sesiune

- Server doar pe `127.0.0.1:8011`. Header-ul `Host` trebuie să fie `127.0.0.1:8011` sau `localhost:8011` (protecție DNS rebinding).
- CORS doar pentru originile 8011 și dev 3011; orice altă `Origin` → 403.
- Token de sesiune aleator la fiecare boot, obligatoriu în `X-Hub-Token` pentru orice cerere care modifică starea. `/api/session` refuză `Sec-Fetch-Site: cross-site`.
- Limite de corp: 1 MB (15 MB doar pentru atașamente). CSP strictă pentru UI; preview-urile rulează în `iframe sandbox` fără acces la sesiunea Hub.
- Nu există acces remote/mobil: fără tuneluri, porturi deschise sau pairing. Aplicația rămâne locală și explică asta.

## Niveluri de permisiune

`READ_ONLY` → `WORKSPACE_EDIT` → `DEVELOPMENT_TOOLS` → `EXTERNAL_ACTIONS` → `SENSITIVE_ACTIONS`. Rolurile și skill-urile își declară nivelul; nu îl pot ridica singure.

## Aprobări

Hash SHA-256 peste JSON canonic: tip acțiune, țintă, payload exact (comandă/diff), versiune cod (git HEAD), tier, scope, expirare. Decizia cere hash-ul afișat în UI; orice diferență → 409 „acțiunea s-a schimbat”. Consumul recalculează hash-ul; nepotrivirea invalidează definitiv aprobarea (persistată chiar dacă apelul eșuează). Aprobările sunt de unică folosință. Doar canalul `ui` poate decide; vocea și automatizările nu pot.

## Politica de aprobare (Milestone 01)

`v2/server/policy/approval-policy.mjs` decide pentru fiecare acțiune: **AUTO_ALLOWED**, **ASK_ONCE_FOR_TASK**, **ALWAYS_ASK** sau **DENIED**.

- Catalogul de acțiuni are pentru fiecare tip o politică implicită și limita cea mai permisivă (`loosest`). O regulă a ta poate fi oricând mai strictă, dar nu mai permisivă decât limita. Tipurile blocate (`billing.purchase_credits`, `billing.enable_extra_usage`, `billing.plan_upgrade`, `billing.paid_api_route`, `credentials.enter`, `skill.permission_escalation`) sunt DENIED și nu se pot schimba.
- Implicit: citirile locale AUTO_ALLOWED; comenzile și modificările propuse de modele ALWAYS_ASK (se pot relaxa la ASK_ONCE_FOR_TASK); trimiteri, push, deploy, taskuri cloud, programări native, connectori cu scriere, browser real și control vizual ALWAYS_ASK (fixat); tipurile necunoscute ALWAYS_ASK.
- ASK_ONCE_FOR_TASK: prima acțiune de acel tip dintr-un task cere aprobarea ta; aceasta devine un *task scope* (task + tip + țintă + suprafață, 8 h) folosit automat în restul taskului. Scope-urile se revocă la COMPLETED/CANCELLED/FAILED și la Stop All.
- Politica se aplică la fel când acțiunea o execută o suprafață vendor (Claude computer use, connectori, Claude in Chrome, pluginuri OpenAI, OpenClaw, Paperclip, Agent Zero). **Dialogul de permisiuni al vendorului este un strat suplimentar și nu înlocuiește decizia Hub** (`vendorDialogReplacesHub: false`).

## Command bus și canale

Orice schimbare de stare este o comandă numită (≈60), validată pe schemă, cu canalele permise declarate: `ui`, `voice`, `automation`, `schedule`, `companion`, `recovery`, `test`. Vocea poate opri (Stop All, suspendarea porții, întrerupere) dar nu poate deschide poarta și nu poate aproba. Programările locale pot rula doar comenzile din `SCHEDULE_COMMANDS` (fără model, fără efecte externe). Jurnalul `commands` păstrează payload-ul redactat (pentru atașamente și importuri doar metadate), decizia politicii, ruta, aprobarea și rezultatul; `idempotency_key` previne dublurile.

## Skills și oglindiri

- Un skill nu acordă niciodată permisiuni: uneltele efective sunt intersecția skill ∩ rol, nivelul efectiv este minimul; conținutul este scanat la import (secrete, ocolirea permisiunilor, push/publish, rute API plătite, ștergeri distructive).
- Oglindirea sesiunilor Claude (`claude agents --json`) este read-only; sesiunile din directoare care nu aparțin proiectelor înregistrate sunt doar numărate, nu stocate.
- Exportul de memorie/skills către vendori este asistat (îl aplici tu); Hub-ul nu scrie în conturile vendorilor.

## Execuție

- Poarta (vezi `V2_ARCHITECTURE.md`) este singurul punct de decizie; UI, voce și viitorul companion trec prin ea.
- Lease exclusiv per workspace (index unic parțial în SQLite); un lease cu stare necunoscută rămâne `retained` până la reconciliere.
- Supervisor: allowlist de mediu, `windowsHide`, `shell:false`, refuz pentru shim-uri `.cmd/.bat`, oprire arbore cu `taskkill /T /F`, stdout rezervat protocolului, stderr redactat într-un buffer circular. În teste nu poate porni decât fixture-uri.
- Claude: workspace-urile cu hooks/MCP proprii sunt refuzate dacă proiectul nu e de încredere; `--strict-mcp-config` cu config gol.
- Codex: allowlist de metode; aprobările server→client devin aprobări Hub; escaladările de permisiuni, refresh de token, atestare și tool-uri dinamice sunt refuzate.

## Fișiere și instrumente

- `resolveInScope`: blochează traversarea, căile absolute, ieșirea prin symlink/junction, `.git`, `.ifrim/private` și numele de tip secret (`.env*`, `*.pem`, `*.key`, `.npmrc`, `auth.json`, `credentials*`…).
- `preview.check` acceptă doar `http://127.0.0.1|localhost` (anti-SSRF).
- `process.run` acceptă doar scripturile `test`, `build`, `test:v2`, `build:v2`, cu aprobare legată de comanda exactă.
- Desktop, captură ecran și browser automat sunt blocate până la aprobare.

## Date și secrete

- Redaction (`v2/server/security/redact.mjs`) pentru evenimente, loguri, erori, stderr, pachete handoff, exporturi și tabele legacy: chei OpenAI/Anthropic/GitHub/Slack/AWS, Bearer, JWT, chei private, atribuiri `*token=`, `password=`, `secret=` etc.
- Memoria și atașamentele text refuză conținut de tip credențial.
- Identitatea contului (e-mail, org) nu este stocată: inspecțiile păstrează doar tip, metodă, plan.
- Conținutul fișierelor, paginilor, tool output-ului și payload-urilor de eveniment este tratat ca date, nu ca instrucțiuni.
- **Citirea fișierelor private de către modele (Milestone 01).** Rulările Claude folosesc `--setting-sources user`, deci regulile `deny` din `.claude/settings.json` al proiectului nu se mai încarcă. Hub-ul le transmite singur: `--disallowedTools` cu `CLAUDE_DENIED_READS` (`.ifrim/private/**`, `.ifrim/BACKUPS/**`, `.ifrim/tmp/**`, `.env`, `.env.*`, inclusiv în subdirectoare). Regulile `Read` se aplică și pentru Grep/Glob. Promptul fiecărei rulări (Codex și Claude) interzice explicit citirea acestor căi.

## Riscuri cunoscute

- Codex nu are reguli de refuz la citire pe căi: sandbox-ul read-only poate citi tot proiectul. Pentru Codex, protecția `.ifrim/private` / `.ifrim/BACKUPS` este doar instrucțiunea din prompt. De evaluat în LIVE_VALIDATION: permission profiles Codex (0.138+) sau un workspace de lucru fără aceste directoare.

- `node:sqlite` este experimental în Node 24 (avertisment la pornire).
- Tokenul de sesiune poate fi citit de orice proces local al utilizatorului; modelul presupune că mașina locală este de încredere.
- Testul de symlink de fișier nu poate rula fără privilegiu Windows (NOT_RUN); ramura de junction este testată real.
