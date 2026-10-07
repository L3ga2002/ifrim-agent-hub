# Pilotul L5 pe 2.13.0-m11: rezultate

Data: 2026-10-07. Hub-ul live: `2.13.0-m11`, upgrade `upg_muy2ozna` la 12:17 UTC. Commitul `05a0d2b`, împins.

Proiectul pilot: „Factory Demo L5” (`prj_muy2psz9_2df3ee0630`), creat din fixture-ul `bug-demo-test-first`. E un proiect de test, pe ruta Windows, fără test de acceptanță. Marcajul de la care se numără pilotul e 5544.

## Rezultat: PASS_LIVE, cu o abatere de traseu

Pilotul a ajuns la DELIVERY_READY cu o singură confirmare.

| Etapă | Ora (UTC) | Dovadă |
|---|---|---|
| Confirmarea planului | 13:27:50 | un singur `envelope.confirmed`, prin click; buget 10 pe rol; plan valabil 209 min |
| TEST_AUTHORING | 13:27:51 → 13:28:05 | Claude `sonnet` · medium, doar citire; `factory.test_staged` cu 2 cazuri, în `.ifrim-hub/staging/` |
| TEST_PROVING | 13:28:05 → 13:28:10 | 2 rulări identice, 1 caz pică și 1 control trece; verdictul `PROVEN`, fără model |
| TEST_REVIEW | 13:28:10 → 13:28:44 | Codex `gpt-6.1-sol` · medium, sandbox `readOnly`, fără rețea; PASS, cu 1 constatare |
| Protejarea | 13:28:44 | `test/hub/repara-validarea-un-nume-format-41a4f4.test.mjs`, bază nouă; zona de lucru a rămas goală |
| BASELINE | 13:28:46 | testul protejat pică (1/2), cum trebuie |
| Implementare, verificări, review, QA | 13:28:46 → 13:31:16 | Codex workspace-write; review Claude PASS; QA |
| DELIVERY_READY | 13:31:16 | aproximativ 3,5 min de la confirmare |

Contoarele de la 5544:
- 0 formulare, 0 schimbări de mod, 0 navigări la Aprobări sau Avansat, 0 intervenții de dezvoltator;
- 2 confirmări de plan: pilotul și planul pornit pe proiectul greșit, abaterea P1 de mai jos;
- 2 fraze tastate neînțelese.

AI pornit prin Hub: Claude 2 ture (autorul testului și review-ul codului), Codex 2 ture (verificarea testului și implementarea). Asta e sub plafonul de 8 ture.

## Abateri

**P1. Proiectul greșit.**
- Pas: „Repară validarea în Factory Demo L5: …”, tastat cu cockpitul Factory Demo M10.2 deschis.
- Așteptat: un plan pe Factory Demo L5.
- Real: planul s-a făcut pe Factory Demo M10.2, cu testul existent legat. Baseline-ul a trecut, deci misiunea a ajuns la NEEDS_OWNER_DECISION fără nicio rulare de model.
- Cauză: rezolvatorul citea proiectul numit doar după „din / pe / la / pentru”, nu și după „în”.
- Fix: `PROJECT_TAIL` acceptă „în”, cu testul `m11-l5-pilot-fixes` (2.13.1). Fix-ul nu e încă pe Hub-ul live.

**P2. Scriptul de creare a proiectului.**
- `create-factory-fixture.mjs` verifica `src/server-app.js` pentru noul fixture și a afișat o eroare falsă. Proiectul era complet.
- Fix: verifică `src/requests.js` pentru orice fixture `bug-demo*`.

**P3. Testul golden U1** compara cu `HEAD`. După commitul L5, HEAD conține chiar L5, așa că baza e acum fixată la `b0883ad`.

**Neverificat:** cele 2 fraze tastate neînțelese (13:26:59 și 13:27:21). Textul lor nu e în evenimente; probabil sunt încercările de oprire sau de navigare dinaintea pilotului.

Acceptarea pachetului de livrare rămâne decizia proprietarului.
