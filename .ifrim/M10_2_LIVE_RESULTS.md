# Proba ghidată M10.2 (A–G) pe 2.12.2: rezultate

Data: 2026-10-06, 18:46–20:09 UTC. Hub-ul live: `2.12.2-m10.2`, contract 12, schema 11, BUILD_SAFE.

## Pregătirea

- **Commituri** pe `v2-milestone-01`, peste `e1a2d0d`:
  - `b747e33`: codul 2.12.2 (delta P0, sha256 `c4be2b19…`, identică cu arborele testat);
  - `8ce5776`: documentele probei;
  - `b0883ad`: M11 wave 0, nelegat.
- **Push:** `origin/v2-milestone-01` = `b0883ad`, la cererea proprietarului („rulează tu toate comenzile”).
- **Pornirea Hub-ului înainte de upgrade:** PC-ul a repornit la 18:24 UTC. Autostart-ul a pornit serverul 2.12.2 cu interfața veche, construită pentru 2.12.1.
- **Upgrade:** `upgrade.mjs --apply`, rularea `upg_mux155y7`, terminată la 18:46:47 UTC.
  - A reconstruit interfața. Nu a avut migrare. Numărul de rânduri e neschimbat.
  - Backup-ul `backup.run` de dinainte de upgrade NU a rulat: stratul de permisiuni al sesiunii l-a refuzat. Primul backup verificat după upgrade e `bkp_mux1din6_3bbed77272`, la 18:53 UTC, înainte de prima rulare.
- **Marcaje:**
  - S1 = 4992, după upgrade;
  - S2 = 5180, după pasul B. Pașii C–G se numără de la S2, pentru că explorarea proprietarului de la A–B pe ProDelivery a adăugat 2 confirmări;
  - sfârșitul probei = 5478.

## Pașii

| Pas | Rezultat | Dovadă |
|---|---|---|
| A. Lega dintr-un click | PASS | `lega.session.start` pe canalul owner; verificarea contului (26 h) reîmprospătată automat; grant de voce derivat (`kind: voice`); 0 formulare |
| B. „Deschide Notepad” | PASS pe Hub, abatere la Lega | `desktop_open` local; „Notepad deschisă”; Lega a spus apoi „nu am un instrument” (abaterea D4) |
| C. „Hai să lucrăm la Factory Demo M10.2” | PASS | `open_project` → cockpit; transcrierea „factoridimo” a fost rezolvată corect; nimic nu a pornit |
| D. „Repară testul de acceptanță…” | PASS | un `envelope.confirmed` (click); granturi derivate: writer Codex `gpt-6.1-sol` · medium (workspace-write) și reviewer Claude `sonnet` · medium (doar citire); aprobarea `factory.scope` decisă de envelope |
| E. Lucrul singur | PASS | confirmare 19:22:08 → DELIVERY_READY 19:28:37 (6,5 min, cu pauza); baseline 2,5 min; Codex 1 min 23 s; review Claude 29 s, PASS din prima (1 constatare); QA 2 s; 0 remedieri |
| F1. Pauză spusă, „Continuă” scris | PASS | `owner_pause` via Lega; PAUSED din BASELINE; `ops_continue` scris → BASELINE reluat |
| F2. „Ce urmează după Stop All?” | PASS | intenția `explain_stop`; nimic oprit |
| F2. „Oprește tot” | PASS | `system.stop_all` 19:41:32; 4 granturi revocate; poarta suspendată |
| F2. Redeschiderea din cockpit | PASS | `gate.rearmed` 19:48:31, Windows Hello reînnoit (prima apăsare a cerut reautentificare, ultima verificare avea peste 5 min); BUILD_SAFE; nimic vechi repornit |
| G1. Importul M09 | PASS (la a doua frază) | prima frază, dată de Claude, nu a fost înțeleasă (D6). A doua: `studio_import_folder` → un plan → confirmat; 2 resurse, 8 versiuni de montaj, copii |
| G (în plus). Cererea păstrată „fă acel videoclip” | PASS | după import, cererea de la pasul A a fost re-propusă singură; confirmată; randare ciornă + QA (WARN doar la drepturi) |
| G2. „Arată-mi clipul” | PASS | `studio_show_clip` → Studio |
| G3. „La secunda 12 mută textul mai sus” | PASS pe efect, abatere pe traseu | planul `studio.edit` a fost propus, dar nu a fost confirmat; editarea s-a aplicat din butonul de review din Studio (`media.edit.patch.apply`, versiunea 9), fără randare/QA nouă (D7) |

## Contoarele (`probe-m10-2.mjs`)

| Contor | Așteptat | S2→sfârșit (C–G) | S1→sfârșit (A–G) |
|---|---|---|---|
| GRANT_FORMS_OPENED | 0 | 0 | 0 |
| MANUAL_MODE_CHANGES | 0 | 0 | 0 |
| NAVIGATION_TO_APPROVALS | 0 | 0 | 0 |
| NAVIGATION_TO_ADVANCED | 0 | 0 | 0 |
| PLAN_CONFIRMATIONS | 3 | 3 (D, import, randarea clipului) | 5 (+2 analize ProDelivery) |
| EXTRA_SCOPE_CONFIRMATIONS | 0 | 0 | 0 |
| MANUAL_DEV_DB_API_INTERVENTIONS | 0 | 0 | 0 |
| VOICE_CONFIRMATIONS | NOT_RUN | 0 | 0 |
| VOICE_PAUSE | 1 | 1 | 1 |
| VOICE_CONTINUE | NOT_RUN | 0 | 0 |
| STOP_ALL | 1 | 1 | 1 |
| CONTEXTUAL_REARM | 1 | 1 | 1 |
| UNKNOWN_INTENTS | 0 | 1 (fraza lui Claude, D6) | 5 (4 la voce, D1/D2, + D6) |

## Abateri (PAS → AȘTEPTAT → REAL → CAUZĂ → FIX)

- **D1.** A, „Lega, ce se întâmplă?” (la fel „Ce-i asta…”, „Local”).
  - Așteptat: răspuns, fără să fie numărată ca neînțeleasă.
  - Real: Lega a răspuns corect prin unelte, dar contorul a numărat-o neînțeleasă și fără răspuns.
  - Cauză: `owner.intent_outcome` se închide doar pe răspunsul rezolvatorului local, nu și pe un răspuns al Legăi prin unelte sau pe o întrebare de clarificare.
  - Fix: contorul închide outcome-ul și pe `lega.tool` / un răspuns al Legăi.
- **D2.** A, „Ok, fă acel videoclip de promovare”.
  - Așteptat: `studio_create`.
  - Real: `unknown`. Lega a tratat totuși cererea prin `request_work`, care a fost blocată cu STUDIO_NO_MATERIAL și explicată.
  - Cauză: regula `studio_create` e ancorată pe verb la început (`^fa…`), iar „Ok,” o rupe.
  - Fix: tolerează „ok/bine/hai” înainte de verb.
- **D3.** A/B, „Rulează / Pornește preview-ul ProDelivery”.
  - Așteptat: pornește preview-ul sau explică de ce nu poate.
  - Real: un plan de analiză doar-citire cu Claude `sonnet`. Două au fost confirmate și au rulat inferență.
  - Cauză: `show_preview` cade în planificatorul `run` când proiectul nu are un profil de preview.
  - Fix: `show_preview` fără profil explică și nu propune o analiză.
- **D4.** B, „Deschide Notepad”.
  - Așteptat: „Am deschis Notepad.”
  - Real: Lega a spus „Am deschis Notepad” și imediat „Nu am un instrument ca să deschid aplicații…”.
  - Cauză: textul modelului contrazice rezultatul `hub_action`.
  - Fix: Lega raportează rezultatul `hub_action` și nu mai neagă unealta.
- **D5.** Upgrade, backup-ul `backup.run` de dinainte.
  - Așteptat: rulează.
  - Real: refuzat de stratul de permisiuni al sesiunii.
  - Cauză: politica locală.
  - Fix: proprietarul apasă „Backup verificat” înainte de upgrade-urile viitoare; schema nu s-a schimbat.
- **D6.** G1, fraza „Importă în Studio proiectul din C:\…” (dată de Claude).
  - Așteptat: import.
  - Real: `unknown`.
  - Cauză: `parseImportFolder` nu acceptă „în Studio” între verb și „din”.
  - Fix: acceptă „în Studio”; fraza din fișă se corectează.
- **D7.** G3, editarea.
  - Așteptat: planul `studio.edit` confirmat o dată, randat și verificat.
  - Real: editarea s-a aplicat din butonul de review din Studio; planul a rămas neconfirmat; versiunea 9 nu are randare/QA.
  - Cauză: două trasee pentru aceeași editare (cardul planului și butonul de review din Studio).
  - Fix: în Studio, review-ul propus din intake arată cardul planului (sau aplicarea închide planul și cere randarea).

## Concluzie

Fluxul fără formulare e dovedit live pe 2.12.2:
- 0 formulare, 0 schimbări de mod, 0 navigări la Aprobări/Avansat și 0 intervenții de dezvoltator;
- o singură confirmare pe plan;
- pauza, Stop All și redeschiderea cu Windows Hello merg;
- „Ce urmează după Stop All?” nu oprește nimic.

`M10.2_CLOSED_LIVE` **nu se declară automat**: UNKNOWN_INTENTS ≠ 0 și există abaterile D3, D4 și D7. Decizia de închidere e a proprietarului.

**Decizia proprietarului (2026-10-06, 20:12 UTC, „1 da claude 2 nu 3 da”):** M10.2 se închide cu abaterile D1–D7 trecute în lotul de reparații 2.12.3. Răspunsurile L5: autorul testului e Claude; un test care trece deja nu se păstrează; întrebarea „alege unul dintre testele găsite” se scoate. VOICE_FLOW_VERIFIED rămâne nedeclarat, pentru că filtrul vocal e oprit.

Consumul AI pornit prin Hub:
- Lega: 3 sesiuni, aproximativ 4 + 3,8 + 5 min;
- Codex: 1 tură;
- Claude: 3 ture (1 review, 2 analize ProDelivery);
- avertisment Claude `allowed_warning` pe limita de 7 zile, cu resetare pe 2026-10-13.
