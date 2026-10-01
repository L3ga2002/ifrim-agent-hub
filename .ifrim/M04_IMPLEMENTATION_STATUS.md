# M04 — Starea implementării (Vânzări & lead generation)

Versiune: `2.5.0-m04` · 2026-10-01 · Branch `v2-milestone-01`. Codul M04 nu e comis; ultimul commit este `3c5d202`, deja împins.

## Niveluri

| Nivel | Stare |
|---|---|
| BUILD_READY | **Atins**: modulele sunt implementate și testate local (vezi `M04_TEST_REPORT.md`) |
| SIMULATED_SALES_FLOW_VERIFIED | **Atins**: import → identitate → audit → calificare → oportunitate → propunere → ciornă → contact (fals/manual) → acceptare → ciornă Software Factory, cap-coadă pe date sintetice (PASS_SIMULATED) |
| LIVE_RESEARCH_VALIDATED | Neatins: cere o probă viitoare autorizată (surse, volum, durată, condiții de oprire) |
| REAL_CLIENT_DATA_READY | Neatins: cere protecțiile și verificările pentru date reale (retenție, ștergere, temei legal) |
| OUTREACH_ENABLED | Neatins: `OUTREACH_DISABLED`; cere un canal configurat și o autorizare separată |
| OWNER_ACCEPTED | Decizia ta |

## Pe secțiunile promptului M04

| § | Cerință | Stare | Unde |
|---|---|---|---|
| 05 | Pachetele de închidere M03 (2.3/2.5/2.6) pregătite, nepornite | Făcut | `.ifrim/M03_CLOSURE_PACKAGES.md` |
| 06 | Planul R2 (opțiuni, autorizări, criterii) | Făcut, R2 rămâne deschis | `.ifrim/M04_R2_ISOLATION_OPTIONS.md` |
| 09 | Arhitectura peste infrastructura existentă: command bus, aprobări, evenimente, scheduler, misiuni, Lega | Făcut | `v2/server/sales/sales.mjs`, `sales-commands.mjs`, migrarea 4 |
| 10 | Import CSV/XLSX: validare → mapare → preview → confirmare → raport pe rând; reluare idempotentă; rollback cu verificarea editărilor | Făcut | `tabular.mjs` (fără dependențe noi), `sales.mjs` |
| 11 | Identitate și deduplicare cu motive și conflicte; review uman pentru ambiguități; aliasuri; merge reversibil | Făcut | `identity.mjs`, coada `NEEDS_REVIEW` |
| 12 | Dovezi cu etichete, sursă, dată, fragment, metodă; reverificare, înlocuire, contradicții | Făcut | `sales_evidence`, `annotateEvidence` |
| 13 | Strat de surse cu timeout, rate limit, cache versionat, deduplicare; validarea URL-urilor; colectare live dezactivată | Făcut (doar fixture-uri) | `research.mjs` |
| 14 | Audit de site pe criterii verificabile, observație → efect → serviciu → condiții | Făcut (doar fixture-uri `.test`) | `audit.mjs`, `v2/fixtures/sales/sites/` |
| 15 | Calificare deterministă, explicabilă (`q-v1`), necunoscut ≠ 0, override cu motiv | Făcut | `qualify.mjs` |
| 16 | Stări CRM validate; CONTACTED/WON doar prin evenimente; DO_NOT_CONTACT imediat și la reimport | Făcut | `LEAD_TRANSITIONS`, `OPPORTUNITY_TRANSITIONS` |
| 17 | Propuneri versionate, fără prețuri/termene inventate; ciorne care nu pretind analize inexistente | Făcut | `proposal.mjs` |
| 18 | Aprobarea conținutului ≠ trimitere ≠ livrare; transport fals doar în teste; idempotență | Făcut | `sendDraft`, `M04_CONTACT_POLICY.md` |
| 19 | Follow-up local, din contact real sau dată explicită; scheduler fără mesaje; suspendare la răspuns/opoziție | Făcut | `scheduleFollowup`, `tick` |
| 20 | Sales → Engineering: ciornă Software Factory (SPEC_DRAFT), fără grant, fără rulare; propunere schimbată → hand-off depășit | Făcut | `sales.handoff.create` |
| 21 | Ecranul Vânzări în JARVIS: importuri, firme, pipeline, fișă, dovezi, audit, calificare, oportunitate, propuneri, ciorne, follow-up, catalog | Făcut | `v2/web/src/screens/Sales.jsx`, `screens/sales/*` |
| 22 | Lega: sumar pipeline, detaliu lead, ciorne (doar rezumate); din voce doar „nu contacta” | Făcut | `lega-policy.mjs`, `lega.mjs` |
| 23 | Metrici de activitate din date; fără rate de conversie din date sintetice | Făcut | `overview()` |
| 24 | Securitate: limite, XLSX sigur, export neutralizat, HTML tratat ca text, fără CORS/MCP relaxat | Făcut | vezi `M04_TEST_REPORT.md` |
| 25 | Scenariile A–H | PASS_SIMULATED / PASS_LOCAL | `v2/tests/m04-*.test.mjs` |

## Ce nu s-a făcut, intenționat

- Nicio inferență, nicio colectare live, niciun contact extern, nicio instalare.
- Nicio acceptare a Demo A și nicio probă M03 relansată.
- Gmail, SMTP, calendar și inbox nu sunt conectate.
- Codul nu e comis și nu e împins.
- Catalogul de servicii pornește **gol** în Hub-ul real. Nu există servicii confirmate în proiect, deci nu am inventat niciunul. Îl completezi tu în Vânzări → Catalog. Simulatorul are un catalog marcat SINTETIC.
- Lista istorică de ~3.700 de firme nu a fost găsită în scope. Volumul a fost testat cu 3.700 de rânduri sintetice.

## Abateri de la contract (documentate)

- Același nume în orașe diferite merge în review (`NEEDS_REVIEW`, conflict „orașe diferite”), nu e creat automat. Motivul: poate fi un punct de lucru al aceleiași firme. Nu se unește niciodată automat.
- Două rânduri din același fișier cu CUI-uri valide diferite nu sunt „duplicate în fișier”. Al doilea merge în review cu conflictul „CUI-uri valide diferite”. Asocierea lor e refuzată.
- O propunere nouă după `WON` e permisă ca schimbare de scope. Oportunitatea rămâne `WON`, iar hand-off-ul devine „depășit”, cu nota „e nevoie de o decizie nouă de scope”.
- `liveHttpAdapter()` întoarce un adaptor care refuză fiecare cerere, în loc să arunce la creare.
