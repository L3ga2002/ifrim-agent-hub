# M08 · Planul pilotului real (pachetul B, ProDelivery)

**Stare: PREGĂTIT, NEPORNIT.** Se decide după pachetul A. Pornirea cere planul confirmat de tine. Nu am folosit datele ProDelivery ca fixture: testele M08 rulează pe proiectul sintetic `bug-demo`.

## De ce această sarcină

ProDelivery are un backend FastAPI + MongoDB (23 de fișiere de test pytest) și un frontend React/CRACO. Fabrica nu le poate rula testele azi:
- nu există `package.json` în rădăcină;
- `node_modules` nu se copiază;
- testele cer MongoDB;
- sandbox-ul nu are rețea.

Pilotul ales e, deci, cel mai mic lucru real, reversibil și verificabil fără servicii externe: modulul **`backend/utils/driver_ranking.py`**. E pur (doar `datetime` și `zoneinfo`) și conține clasamentul curierilor, pragurile `TIER_CONFIG`, fereastra de ciclu în jurul `CLOSE_HOUR` și fusul `Europe/Bucharest`.

## Testul de acceptanță independent (scris de Hub la aprobarea B4)

Fabrica cere teste de acceptanță care există înaintea writer-ului și pe care writer-ul nu le poate modifica (protejate, verificate byte cu byte). Pentru o sarcină de tipul „scrie testele”, livrabilul e chiar suita, așa că testul de acceptanță verifică livrabilul obiectiv, fără să reimplementeze regulile de business:
- suita `backend/tests/test_driver_ranking_unit.py` există;
- trece doar cu biblioteca standard;
- are cel puțin 12 teste;
- apelează fiecare funcție publică a modulului.

Înainte de schimbare pică (nu există încă suita), cum cere o misiune FEATURE.

**Verificat în `ifrim-runner`** (Python 3.12.3, cu baza de fusuri orare), pe o copie sintetică:
- pică fără suită, cu 5 teste, cu o funcție neapelată sau cu o suită care pică;
- trece cu o suită bună.

La aprobarea B4, Hub-ul adaugă în ProDelivery **doar acest fișier** (`backend/tests/acceptance/test_driver_ranking_acceptance.py`), apoi pregătește misiunea ca ciornă.

## Sarcina (opțiunea B4)

**„Teste unitare pentru clasamentul curierilor (driver_ranking) și remedierea problemelor găsite”**

- **În scope:**
  - `backend/utils/driver_ranking.py`;
  - `backend/tests/test_driver_ranking_unit.py` (fișier nou).
- **În afara scope-ului:**
  - routere, modele, baza de date, frontend, dependențe noi;
  - deploy, commit, push, mesaje;
  - credențiale și date de producție.
- **Criterii de acceptare:**
  - pragurile din `get_tier_for_score` / `get_next_tier_for_score` sunt respectate la limite, inclusiv la egalitate;
  - fereastra din `_build_cycle_window` e corectă în jurul orei de închidere și la schimbarea orei de vară/iarnă;
  - `calculate_driver_score` tratează lipsa datelor și anulările fără excepții;
  - testele rulează doar cu biblioteca standard.
- **Verificare:** verificările rulează `python3 -m unittest backend/tests/test_driver_ranking_unit.py`, iar acceptanța rulează `python3 -m unittest backend/tests/acceptance/test_driver_ranking_acceptance.py`. Doar pe ruta `wsl-runner`; pe Windows comanda e refuzată, cu motivul afișat.
- **Modele:** writer Codex `gpt-6.1-sol · medium` (abonament); reviewer Claude `sonnet · medium`, doar citire. Gărzile de facturare rămân neschimbate.
- **Limite:** 45 de minute, 2 încercări pe etapă, 1 ciclu de remediere.
- **Ce se copiază în mediu:** fișierele urmărite de git plus cele neurmărite și neignorate.
- **Ce rămâne exclus:** `.ifrim/`, `.claude/`, `.env*`, fișierele de tip secret, `node_modules/` și artefactele de build.

## Opțiunile pachetului B

| Cheie | Ce schimbă | Revenire |
|---|---|---|
| B1 | ProDelivery pe ruta izolată `wsl-runner` (politica (b) e deja aprobată pe amprenta curentă) | ruta înapoi pe cea implicită (Proiecte → Mediu); pe Windows un proiect real rămâne blocat de izolare |
| B2 | autonomie ASSISTED pe ProDelivery pentru pilot | autonomia înapoi pe OBSERVE |
| B3 | fabrica acceptă și `python3 -m unittest <fișiere .py>` (fără shell, căi relative fără `..`) | dezactivezi opțiunea și comanda e refuzată din nou |
| B4 | sarcina de mai sus: după aprobare se pregătește ca ciornă (SPEC_DRAFT); pornește doar după planul confirmat de tine în cockpit | ciorna se anulează |

**Despre B3:** comanda e permisă doar când setarea `factoryExtraCommands` conține `python-unittest`. Implicit e refuzată. Testul M08-PK-01 verifică exact aceste refuzuri: `../x.py`, `; rm -rf /`, `python3 -c`.

## Ce rămâne de făcut pentru pilot

1. **Pachetul A** decis și executat.
2. **Pachetul B** decis în Pilot → Decizii, cu Windows Hello.
3. **Planul pilotului:** în cockpit, „Hai să lucrăm la ProDelivery”, apoi „Arată-mi planul”, apoi confirmarea ta (tastă, buton sau „Da, execută planul”).
4. **Pachetul de livrare:** se verifică de tine. Nimic nu se acceptă și nu se publică singur.

**Nivel de „gata”:** LIVE_PROJECT_PILOT_VERIFIED = NU (pilotul nu a rulat).
