# M06 · Mission Authorization Envelopes

Data: 2026-10-02. Cod: `v2/server/owner/envelopes.mjs`, `owner-commands.mjs`, `policy/approvals.mjs` (`decideByEnvelope`), `factory/factory.mjs` (cârligul de autoritate), `domain/grants.mjs` (`envelope_id`), migrarea 6.

## Ce problemă rezolvă

Până în M05, o misiune normală cerea de la tine 5–7 acțiuni administrative (proba (c) din M05):
- modul LIVE_VALIDATION, tastat;
- un grant Codex scriere și un grant Claude citire, completate în formulare;
- cererea de scope și „Aprobă și pornește”;
- uneori „Reia” cu alt reviewer.

M06 păstrează aceleași garanții, dar le mută în spate. Vezi planul exact, îl confirmi **o singură dată** în sesiunea ta autentificată, iar Hub-ul derivă intern granturile tehnice, fără ca ele să depășească planul.

## Ce conține un envelope

Conținutul planului e hash-uit; metadatele (id, nonce, timp) nu fac parte din hash.

| Câmp (cerința §17) | Unde |
|---|---|
| id, schema_version, project_id, mission_ids | `mission_envelopes` (migrarea 6) |
| specification_version, plan_hash | `body.missions[].specVersion/specSha/planSha/scopeHash`, `body.planHash` |
| workspace_scope, base_snapshot | `body.workspaceScope` (ruta), `body.baseSnapshot`. Git propriu: HEAD + dimensiunea și ora fiecărui fișier modificat. Fără git propriu: parcurgere limitată la 5.000 de fișiere. Doar metadate, niciun conținut. |
| eligible_environments, attestation_refs | `body.eligibleEnvironments`, `body.attestationRefs` (atestare + amprentă, sau acordul ACL pe Windows) |
| allowed_roles, providers, models, effort_policy | `body.allowedRoles`, `providers`, `models`, `effortPolicy` (din limitele misiunii) |
| allowed_tools, filesystem_scope, network_scope | `body.allowedTools`, `filesystemScope`, `networkScope` |
| max_duration, max_attempts, max_repair_cycles, max_concurrency | `body.limits` (cicluri per misiune, după nivelul de autonomie) |
| allowed_effects, denied_effects | `body.allowedEffects`, `body.deniedEffects` (deploy, commit, push, mesaje, publicare, bani, acces, izolare, politici, instalări, ștergeri, cloud, alte proiecte, acceptarea în locul tău) |
| subscription_policy | `INCLUDED_SUBSCRIPTION_ONLY` (ghidajele de facturare din M01–M05 rămân neatinse) |
| continuation_policy | după închiderea panoului da; remedieri fără confirmare doar peste ASSISTED; misiunea următoare doar la HIGH_AUTONOMY_BOUNDED; oprire la DELIVERY_READY |
| issued_at, expires_at, nonce, revocation_state | coloane: `issued_at`, `confirm_by` (15 min), `expires_at` (durata + 30 min), `nonce`, `status` |

Tu vezi un rezumat uman: unde lucrez, ce pași fac, ce nu fac niciodată, unde mă opresc, cost, trecerea de mod, o estimare de fișiere (marcată „nu promisiune”) și nivelul. Detaliile tehnice se pot extinde.

## Ciclul de viață

`PROPOSED` → (confirmarea ta) → `CONFIRMED` → `ACTIVE` ⇄ `WAITING_OWNER` → `COMPLETED` | `EXPIRED` | `REVOKED` | `CANCELLED` | `FAILED_TO_START`, plus `SUPERSEDED`.

- **Propunere** (`envelope.propose`, orice canal al tău, inclusiv vocea):
  - nimic nu rulează și nu se creează niciun grant;
  - funcționează și sub politica legacy;
  - un plan mai nou îl înlocuiește pe cel vechi.
- **Confirmare** (`envelope.confirm`, numai canalul `owner`):
  1. Politica voice-first trebuie să fie activă și sesiunea validă. Pentru HIGH_AUTONOMY_BOUNDED e nevoie de reautentificare recentă.
  2. Nonce-ul și hash-ul afișat trebuie să corespundă, iar termenul de confirmare să nu fi trecut.
  3. Conținutul se **recalculează**. Orice diferență refuză confirmarea și numește ce s-a schimbat: specificația, limitele, ruta, atestarea, starea repository-ului, modul, modelele.
  4. Pregătirea trebuie să fie OK. Poarta se verifică pentru writer și reviewer, fără ce rezolvă planul însuși (grant, mod, lease, backup, concurență). Pentru proiectele reale se cere și harta etapelor eligibilă.
  5. Statusul se preia atomic (`PROPOSED` → `CONFIRMED`). Există și un index unic: o singură autoritate în vigoare per proiect.
  6. Dacă Hub-ul e în BUILD_SAFE, trece în LIVE_VALIDATION; asta e scris explicit în plan.
  7. Se emit granturile derivate și se dispecerizează comanda obișnuită `factory.start` pe canalul `owner`.
  8. Aprobarea scope-ului e decisă prin `decideByEnvelope`, cu hash-ul recalculat. `executeApproved` rulează apoi și statusul devine `ACTIVE`.
  9. Un eșec după preluare duce la `FAILED_TO_START`: granturile se revocă, iar modul revine la BUILD_SAFE dacă planul l-a schimbat.
- **Urmărire:**
  - `DELIVERY_READY` duce la `COMPLETED`, sau la misiunea următoare pentru HIGH;
  - `NEEDS_OWNER_DECISION`, `BLOCKED` și `PAUSED` duc la `WAITING_OWNER`;
  - `CANCELLED` sau `REJECTED` duc la `CANCELLED`;
  - Stop All sau revocarea tuturor granturilor duc la `REVOKED`;
  - expirarea, verificată în tick-ul scheduler-ului, duce la `EXPIRED`.
  - La închidere se revocă granturile rămase și se eliberează modul.
- **Revocare** (`envelope.revoke`): fail-safe, din orice canal al tău.

## Granturile derivate (CapabilityIssuer)

- Per misiune se emit două granturi: Codex workspace-write și Claude read-only.
- Încercările sunt `(1 + ciclurile permise) × maxAttemptsPerStage`, plafonate la 5.
- TTL-ul și expirarea sunt cel mult cele ale planului; durata maximă a unei execuții e cel mult cea a misiunii.
- Coloana nouă `live_grants.envelope_id` leagă fiecare grant de planul din care derivă.
- `assertWithin` refuză orice grant mai larg decât planul: alt proiect, alt provider, alt rol, reviewer cu scriere, încercări peste limita grantului sau peste plan, durată peste plan, expirare după plan. Testat cu M06-EN-06 și mutantul MU-06.
- Poarta de execuție rămâne singurul loc care decide fiecare pas (`live_grant`, `billing_route`, `isolation`, `host_isolation`, `project_frozen` etc.). Envelope-ul doar furnizează autorizația.

## Autonomia per proiect

| Nivel | Ce înseamnă | Implicit pentru |
|---|---|---|
| OBSERVE | citire, navigare, planuri; confirmarea e refuzată | proiectele reale (registry) |
| ASSISTED | o confirmare per misiune; o remediere așteaptă confirmarea ta (`envelope.confirm_delta`) | proiectele de test |
| TRUSTED | implementare, teste, review, remedieri în limita misiunii, QA, preview, fără confirmări intermediare | — |
| HIGH_AUTONOMY_BOUNDED | o listă finită (≤ 5) de misiuni pregătite, una după alta, în aceleași limite totale; cere reautentificare | — |

- Ridicarea nivelului cere sesiunea reautentificată în ultimele 5 minute.
- Coborârea e fail-safe din orice canal și revocă un plan în vigoare mai larg decât noul nivel.
- Niciun nivel nu se activează prin folosire repetată și niciunul nu trece peste izolare, costuri sau alte proiecte.
- `REAL_PROJECT_ELIGIBLE` vine numai din harta etapelor verificată.

## Cum se leagă de fabrica M03 (nu un al doilea orchestrator)

Singura schimbare în fabrică este `factory.attachAuthority(fn)`, consultat:
- **înainte de o remediere:** înainte să se numere ciclul sau să se creeze taskul de remediere;
- **înainte de fiecare pas cu model.**

Fără envelope, comportamentul rămâne exact cel din M03–M05. La ASSISTED, remedierea trece în `NEEDS_OWNER_DECISION` cu motivul „cere confirmarea ta”. După `confirm_delta` + „Reia”, aceeași decizie se repetă și trece. Testat cu M06-EN-07 și mutantul MU-10.

## Politica veche și auditul

- Aprobările istorice nu se rescriu. Decizia prin plan apare ca `decided_via = owner_session`, `decided_by = owner:<sesiune>`, cu nota `envelope <id>`, niciodată ca un clic `ui` fictiv.
- Evenimentele separă:
  - `envelope.proposed`: propunerea, inclusiv cea venită de la model prin vocea Lega;
  - `envelope.confirmed`: consimțământul pe canalul real, cu modalitate, sesiune și credențial;
  - `envelope.grants_derived`: granturile derivate;
  - `envelope.mission_started` și `factory.stage`: execuția.
  - Toate poartă `correlation_id` = id-ul planului.
- Politica `ownerPolicy` e implicit `legacy`. Backend-ul refuză confirmarea dacă politica nu e activă (M06-EN-01). Testele M01–M05 rulează în continuare pe calea legacy.
