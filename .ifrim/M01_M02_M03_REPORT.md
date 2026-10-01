# Raport Milestone 1 + 2 + 3: Ifrim Agent Hub V2

**Date de identificare:**
- Data: 2026-10-01.
- Hub: `127.0.0.1:8011`, versiunea `2.4.0-m03`, pornește mereu în BUILD_SAFE.
- Branch: `v2-milestone-01`. `main` a rămas la `e9ab563`; nimic nu e în `main` și nimic nu e publicat.

**Commit-uri:**

| Commit | Conținut | Stare |
|---|---|---|
| `f31240b` | Milestone 1 | pe GitHub |
| `0fb71d2` | Milestone 2 | pe GitHub |
| `30bfbef`, `dac2db4`, `ce819b9`, `bbe8757` | Lega | pe GitHub |
| `6432c5e` | verificarea M2 + izolarea MCP | pe GitHub |
| `b4b5cdb` | Milestone 3 | **local**, push-ul îl faci tu |
| `294a677` | probele live 2.1–2.2 + gărzile noi Claude | **local**, push-ul îl faci tu |

**Etichete:**
- **PASS_LIVE**: verificat cu un model sau provider real.
- **PASS_LOCAL**: verificat pe calculatorul tău, cu componente reale, fără model.
- **PASS_SIMULATED**: verificat cu provideri simulați.
- **NOT_RUN**: nu a fost rulat.
- **BLOCKED**: nu se poate face acum.
- **NEVERIFICAT**: nu am dovezi.

## 1. Pe scurt

- **Compania există și lucrează.** Ai departamente, roluri, misiuni, aprobări, poartă de execuție, granturi și backup. Lega e asistentul vocal, iar Software Factory e departamentul Engineering.
- **Prima misiune Engineering a fost dusă live cap-coadă** pe proiectul de test Demo A:
  - bug reprodus (baseline roșu);
  - Codex a scris fixul și un test de regresie;
  - verificări 6/6;
  - review independent Claude (sonnet): PASS;
  - QA 2/2;
  - pachet de livrare gata pentru acceptarea ta.
- **Cele ~8 minute de așteptare au acum o explicație.** Cauza principală era efortul `max` moștenit: la `medium`, de la turn la prima comandă trec 14 s, față de 290–467 s înainte. Sandbox-ul costă ~150 s o singură dată (la prima comandă), apoi ~5 s.
- **Gărzile de facturare au funcționat live:**
  - modelul implicit al contului tău Claude, `fable[1m]`, a fost oprit înainte de orice inferență, iar încercarea a fost returnată;
  - acum alegi explicit modelul reviewer-ului;
  - Claude nu mai poate comuta singur pe alt model.
- **Calitatea:** înainte de commit au rulat patru runde de verificare cu mai mulți agenți. Au găsit și am reparat defecte reale, în special în pauză, Stop și reluare. Fiecare reparație are test, iar cele importante au fost verificate prin mutație. Suita V2: 309 teste, 308 trec, 0 pică.
- **Nu e încă gata pentru proiecte reale de clienți.** R2 e deschis: sandbox-ul Codex poate citi alte proiecte prin cale absolută. Soluția e un mediu separat (WSL2 sau VM).

## 2. Milestone 1: fundația companiei (`f31240b`)

- **Structura companiei** (PASS_LOCAL):
  - 12 departamente, dintre care 4 active (executive, engineering, sales, operations);
  - 18 roluri cu ierarhie, obiective și misiuni;
  - Chief of Staff determinist.
- **Fluxul muncii** (PASS_LOCAL / PASS_SIMULATED):
  - 33 de suprafețe de execuție cu stare reală;
  - 10 cicluri de viață;
  - magistrala de comenzi (~65 de comenzi) cu idempotență și jurnal;
  - motorul de aprobări (AUTO_ALLOWED, ASK_ONCE_FOR_TASK, ALWAYS_ASK, DENIED; regulile doar înăspresc);
  - router cu 11 factori;
  - programări fără duplicate.
- **Cunoaștere** (PASS_LOCAL):
  - 11 skill-uri versionate;
  - memorie pe 8 zone;
  - auditul capabilităților OpenAI și Anthropic (fișierele `V2_*`, verificat adversarial).
- **Siguranță** (PASS_LOCAL / PASS_SIMULATED):
  - backup verificat prin restaurare;
  - import V1 reversibil;
  - gărzi de facturare: credite peste 0 → Codex blocat, Fable refuzat, `--setting-sources user`;
  - telemetrie cu etichete clare (măsurat, raportat, estimat, necunoscut).

## 3. Milestone 2 + Lega + verificarea M2 (`0fb71d2`, Lega, `6432c5e`)

- **Izolare:**
  - Codex rulează sub sandbox-ul Windows (profilurile `ifrim_hub_ro` / `ifrim_hub_rw`), cu negări pentru Hub, `.env` și credențiale;
  - Claude Code e doar-citire la nivel de unealtă; Claude cu shell sau scriere pe Windows: BLOCKED;
  - serverul nu dă prin API fișierele protejate.
- **Interfața „JARVIS”** (PASS_LOCAL / PASS_SIMULATED):
  - Control Room;
  - nucleul WebGL cu rezervă SVG;
  - ecranul Focus, cu streaming și Stop;
  - misiuni cu dovezi;
  - catalogul OpenAI/Anthropic;
  - simulatorul pe 8012;
  - responsive 360–1920 px și accesibilitate.
- **Lega**, asistentul vocal prin abonamentul ChatGPT (GPT-Live prin Codex), **PASS_LIVE** (11,4 minute în română):
  - vede compania, arată pe ecran și pregătește propuneri;
  - nu aprobă nimic din voce;
  - „Lega, oprește tot” oprește tot.
- **Execuții live din 2026-09-30:**
  - Claude doar-citire: PASS_LIVE;
  - Codex scriere (formular de contact, `npm test` 4/4): PASS_LIVE;
  - Codex doar-citire după reparația MCP: PASS_LIVE.
- **Bug-uri găsite live și reparate:**
  - aprobările nu porneau nimic → acum „Aprobă și pornește” într-un singur click;
  - o execuție Codex a folosit un server MCP din afara sandbox-ului → acum pluginurile sunt oprite, serverele MCP dezactivate pe nume și verificate înainte de turn, iar orice apel MCP oprește execuția.

Detalii: `M01_M02_REPORT.md`.

## 4. Milestone 3: pregătirea execuțiilor și Software Factory (`b4b5cdb`, `294a677`)

### Ce s-a construit

**Pregătirea execuțiilor:**
- **Model și efort explicite:** modelul vine din `model/list`, iar profilul implicit e BALANCED = `medium`. Un model sau un efort raportat diferit oprește execuția înainte de turn.
- **Cronologie pe faze** pentru fiecare execuție, cu timpul atribuit: om, Hub, provider, model/sandbox.
- **Poarta verifică acum și:**
  - `run_plan`;
  - `host_isolation` (R2: Codex doar pe proiecte de test sau cu acceptarea ta).
- **R3:** comenzile modelului nu mai pot citi `~/.codex/config.toml*` și `history.jsonl`.

**Software Factory:**
- **Fluxul:** cerință → specificație versionată (cu teste de acceptanță protejate) → plan → **un singur writer (Codex)** → verificări prin `codex sandbox` → **review independent (Claude, doar-citire)** → cel mult 2 remedieri → QA → preview → **E2E în browser** (Playwright 1.61.0, Chromium cu sandbox) → pachet de livrare → decizia ta.
- **Controlul:** dispatch durabil, fără dublări. Stop, Pauză, termenul și repornirea sunt sigure.
- **Interfața:** panoul Engineering în Misiuni. Lega poate propune misiuni, dar nu le poate porni.

### Verificarea dinainte de commit: 4 runde cu mai mulți agenți

Fiecare rundă a fost doar-citire, cu verificare adversarială.

**Defecte reale găsite și reparate:**
- o pauză putea porni totuși o execuție cu model;
- reluarea putea sări peste un baseline blocat sau peste verificări incomplete;
- E2E nu avea limite de timp;
- o pornire refuzată imediat nu era văzută;
- pauzele consumau încercările;
- „Încă un ciclu” nu repara;
- un test sărit trecea drept PASS la reluare;
- Claude putea comuta modelul singur (`fallbackModel`).

**Dovezi:** 27 de teste noi de flux (FAC-01…27), 8 teste de browser, verificare prin mutație pentru cele importante. Detalii: `M03_TEST_REPORT.md` §6.

### Probele live de azi

Toate au fost aprobate de tine; după fiecare, Hub-ul a revenit la BUILD_SAFE.

| Probă | Rezultat |
|---|---|
| Canary sandbox pe arbore fictiv (R3 refuzat, R2 confirmat deschis) | PASS_LOCAL (50 de verificări) |
| Server sub sandbox-ul Codex real, ascultând pe 127.0.0.1 | PASS_LOCAL (6,2 s) |
| **2.1** Codex scrie prin fabrică pe Demo A | **PASS_LIVE**: `gpt-6.1-sol` · `medium`, 130 s, fără MCP, verificări 6/6 |
| **2.2** Review Claude: modelul implicit `fable[1m]` | oprit înainte de model (garda **PASS_LIVE**), încercare returnată |
| **2.2** Review Claude cu `sonnet` (explicit) → QA → pachet | **PASS_LIVE**: PASS VALID, QA 2/2, pachet `bnd_mupj3diq_d386324921` |
| **2.3** Demo B: feature + remediere + E2E în browser | **pregătită, nepornită**: aprobarea trebuie dată de tine |
| **2.5** Stop în timpul unui turn real | NOT_RUN (cere aprobarea ta pentru o execuție nouă) |
| **2.6** Lega propune o misiune | NOT_RUN (cere vocea ta) |

### Nivelurile din definiția de „gata”

- **BUILD_READY:** DA.
- **SIMULATED_E2E_VERIFIED:** DA.
- **LIVE_SANDBOX_VALIDATED:** **PARȚIAL**. Demo A e validat live cap-coadă; Demo B (cu E2E), Stop și Lega încă nu.
- **REAL_PROJECT_READY:** NU (R2).
- **OWNER_ACCEPTED:** decizia ta (pachetul Demo A te așteaptă).

## 5. Teste

| Suită | Rezultat |
|---|---|
| V2 (`npm run test:v2`, fără modele, rularea finală) | 309 teste: **308 PASS, 0 FAIL**, 1 SKIPPED_ENV (symlink, Windows fără Developer Mode) |
| V1 (`npm test`, rulată azi mai devreme) | 552 de teste: 548 PASS, 1 omis, 3 FAIL (timeout-uri la API-ul V1 live de pe 8004, care era lent); codul V1 e neatins |
| Build UI | OK |
| `npm audit` | 0 vulnerabilități |

## 6. Ce nu am făcut și de ce

- **Push:** stratul local de permisiuni îl refuză pentru Claude. Îl rulezi tu.
- **Pornirea probei 2.3 și a probei 2.5:** clasificatorul de siguranță al sesiunii refuză ca un agent să-și aprobe singur scope-ul sau execuțiile în numele tău. E corect, așa că nu l-am ocolit. Granturile create au fost revocate nefolosite.
- **„Accept local” pe pachetul Demo A:** în dovezi apare ca acceptarea ta. Dacă l-aș apăsa eu, dovada ar fi falsă.
- **Proba vocală Lega:** cere vocea ta.
- **Mediul separat pentru R2 (WSL2/VM):** e o instalare de sistem.
- **Merge în `main`:** e decizia ta.

## 7. Ce ai de făcut când revii

1. **Push** pentru cele două commit-uri locale:
   ```
   git push origin v2-milestone-01
   ```
2. **Pachetul Demo A:** Misiuni → „Numele din spații trebuie refuzat” → verifică diff-ul și dovezile → „Accept local” (sau Respinge, cu motiv).
3. **Proba 2.3 (Demo B), dacă o vrei:**
   - spune-mi „pornește 2.3”: eu pun modul LIVE_VALIDATION și granturile (Codex scriere × 3, Claude citire × 3 pe Demo B);
   - tu apeși „Cere aprobarea scope-ului” → „Aprobă și pornește” pe misiunea „Solicitare serviciu: formular + endpoint + bază de test”;
   - restul urmăresc și închid eu.

## 8. Recomandările mele pentru următorul prompt

1. **Încheie validarea live:** 2.3 (Demo B, cu E2E în browser și o remediere reală) și 2.5 (Stop într-un turn real). Asta duce LIVE_SANDBOX_VALIDATED de la „parțial” la „da”.
2. **R2 înainte de orice proiect real** (ProDelivery sau clienți): un mediu separat pentru execuțiile Codex (WSL2 sau VM, cu doar workspace-ul montat). Fără el, Codex pe un proiect real înseamnă un risc acceptat, nu izolare.
3. **Merge în `main` printr-un PR**, după 2.3. Branch-ul are trei milestone-uri verificate.
4. **Opțional:** schimbă modelul implicit din Claude Code (acum `fable[1m]`) dacă vrei ca reviewer-ul să nu mai ceară alegerea explicită. Hub-ul refuză oricum Fable.
5. **Următorul departament:** Sales & Lead Generation. Poate refolosi misiunile, aprobările, dispatch-ul durabil, pachetul cu dovezi și regula „ciornă, nu trimitere”.

Documente detaliate:
- `M03_REPORT.md`;
- `M03_LIVE_VALIDATION_PLAN.md`;
- `M03_TEST_REPORT.md`;
- `M03_PERFORMANCE_REPORT.md`;
- `M03_RUNTIME_READINESS.md`;
- `M03_SOFTWARE_FACTORY.md`;
- `M01_M02_REPORT.md`.
