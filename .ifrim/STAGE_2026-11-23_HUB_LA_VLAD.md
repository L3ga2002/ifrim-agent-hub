# Etapa 2026-11-23 · Hub-ul la Vlad (2.20.0-dist)

Cerere (Catalin, 2026-11-23): Vlad, un prieten, testează Hub-ul V2 pe calculatorul lui (Windows 11), pe proiectele lui demo, cu AI-ul lui (abonamente sau chei API proprii). Când Catalin publică o versiune, instalarea lui Vlad o vede („Actualizare disponibilă”) și se actualizează. Plus un ghid de instalare. Planul a fost aprobat în thread, cu cheile API incluse în scop.

## Ce s-a construit (ramura `claude/project-thread-rzypy9`, peste `7590552` 2.19.2-m16; versiunea 2.20.0-dist, contract API 24, fără migrare)

- **Ruta API proprie** (oprită implicit), separat pe furnizor:
  - `v2/server/policy/api-keys.mjs`: seif DPAPI pentru utilizatorul Windows curent, în `<dataDir>/v2-api-keys`.
  - `v2/server/policy/api-access.mjs`: textul acordului, plafoane USD pe zi/lună/rulare, rezervări (persistate în `apiSpend.pending` și înregistrate la boot), cheltuieli înregistrate.
  - `billing.mjs` `evaluateApiRoute`: regulile abonamentului rămân neschimbate cât timp ruta e oprită.
  - Claude: cheia ajunge doar prin `apiCredential` al supervizorului; `--max-budget-usd`; costul raportat de CLI; **doar citire** pe ruta API.
  - Codex: `account/login/start` cu `-c cli_auth_credentials_store="ephemeral"`. Verificat pe codex 0.171: nu scrie nimic în CODEX_HOME și nu atinge `auth.json` existent. Costul se estimează din tokeni × tabelul `CODEX_API_PRICES` (modelele pro sunt refuzate).
  - Comenzile `api_route.*` (sesiunea de proprietar; oprirea e fail-safe) și panoul Integrări → „Cheie API proprie”.
  - Vocea GPT-Live rămâne doar pe abonament.
- **Canal de actualizări**:
  - Tag-uri adnotate `hub-release/<versiune>`. `v2/server/ops/updates.mjs` verifică la boot și zilnic cu `ls-remote` fără `--refs`, ca să ia commitul peeled.
  - `update.apply` (sesiunea de proprietar) pornește `v2/scripts/self-update.mjs`: preflight prin `upgrade.mjs --plan`, checkout tag, `npm ci` dacă s-a schimbat lock-ul, `upgrade.mjs --apply`.
  - Rollback: Hub-ul vechi care încă servește nu e oprit; procesul e dovedit oprit înainte de mutarea bazei; copia verificată dinaintea migrării e restaurată; codul, dependențele și UI-ul revin.
  - Bannerul „Actualizare disponibilă” și panoul Integrări → „Versiune și actualizări”.
  - `v2/scripts/publish-release.mjs` pentru proprietar.
- **Instalare**:
  - `v2/scripts/install.ps1`: `%USERPROFILE%\IfrimHub\Proiecte\ifrim-agent-hub` + `IfrimHub\hub-data` prin `.ifrim/data-location.json`; bază nouă.
  - `v2/scripts/add-project.mjs`: implicit proiect demo (marcaj `.ifrim-hub-test.json`, deci planurile pot da lui Codex drept de scriere pe ruta Windows); `--real` doar în PROJECTS.md.
  - `start-detached.ps1` / `common.mjs --port`.
  - Ghidul `v2/GHID_INSTALARE.md`.
- Clientul Claude Code nativ (`~/.local/bin`) și Codex instalat cu npm sunt găsite (defectul din 31.10).

## Verificări

- Teste noi: `m20-api-route` 9/9, `m20-updates` 4/4 (fixture, fără model).
- Suita completă (ramura la 857afa1): 2778/2783 trec, 1 skip. Cele 4 eșecuri: 3 reale (M01-NG1: git doar prin tools/git.mjs; M09-BE-02: forma billingInputs; R1-10: contract fixat la 22), reparate în 4f908d7 și 73b86c3 și rerulate verzi; T-DATASET-05 a picat sub încărcare (121 s) și trece singur 14/14, la fel ca pe baza 2.19.2.
- E2E real izolat (`C:\Users\mihai\vlad-e2e`, origin bare local, porturile 8031/8032, bază sintetică nouă, fără model):
  - instalare de la zero: PASS;
  - A→B: PASS;
  - update stricat după migrare: rollback PASS (schema 17→16 restaurată, codul pe B, Hub-ul pe B);
  - runda 2 pe codul reparat (port 8032): instalare PASS; A→B PASS; migrare care eșuează în dry run → rollback fără oprirea Hub-ului vechi PASS; eșec după migrare → bază restaurată, cod și Hub pe B PASS (rollback-ul așteaptă ~5 min timeout-ul de pornire).
- Review independent: 11 observații. Reparate: commit nepeeled, cost 0 fără raport, rezervarea proprie numărată la recheck, rollback care oprea Hub-ul vechi, baza mutată cu procesul viu, lock vechi, `-Root` relativ, ștergerea cheii fără sesiune, ssh. Rămase documentate: depășirea cu un apel a plafonului (limită de estimare), rulările orfane după restart.

## Ce face proprietarul

1. Rulează `C:\Users\mihai\vlad-stage\release\publica-2.20.0.cmd`. Comanda lucrează din clona `C:\Users\mihai\vlad-stage\hub`: urcă ramura, avansează `v2-milestone-01` pe GitHub (fast-forward), creează tag-ul `hub-release/2.20.0-dist` și îl publică. Folderul local al lui Catalin nu se schimbă. Push-ul din sesiune a fost refuzat de permisiuni.
2. Îi trimite lui Vlad linkul ghidului: `https://github.com/L3ga2002/ifrim-agent-hub/blob/v2-milestone-01/v2/GHID_INSTALARE.md`.
3. Versiunile următoare: după validare, `node v2/scripts/publish-release.mjs --tag` și apoi `git push origin hub-release/<versiune>`.

## Neverificat

- O rulare reală de model cu cheile sau abonamentele lui Vlad.
- Windows Hello pe calculatorul lui.
- Configurarea sandbox-ului Codex pe un Windows nou.
- Prețurile Codex (estimare; tabelul e datat 2026-11-23).
