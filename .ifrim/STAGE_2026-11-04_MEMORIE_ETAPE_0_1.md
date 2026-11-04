# Etapa 2026-11-04 — Memoria agenților, etapele 0 + 1 (cod `2.19.2-m16`)

Sursa: auditul read-only din 2026-11-03 (`docs/audit-memorie-agenti.md`), recomandarea „începem cu 0 și 1”, aprobată de proprietar pe 2026-11-04 la 14:51, ora României („ok aprob tot”). Etapele 2–6 vin după ce vede acest rezultat.

Lucrat doar în cloud, pe o clonă separată (branch `claude/project-thread-kvdcer`, bază `1acca9e`), cu Hub-uri sintetice și fără model. PC-ul proprietarului și Hub-ul live nu au fost atinse. **Nu e live** până la upgrade-ul făcut de proprietar. Nu există migrare (schema 16); API contract 23 (aditiv).

## Ce s-a schimbat

**Etapa 0 — lecțiile (regulile pe care le confirmi)**
1. Un prompt de agent primește cel mult 20 de reguli. Ordinea: misiunea, apoi proiectul, apoi toate proiectele; în fiecare grup, cele mai noi primele.
   - Regulile care nu mai încap sunt numărate în prompt.
   - Ecranul Lecții arată proiectul care depășește limita.
   - Fișiere: `runtime/prompt.mjs` (`lessonsForPrompt`), `intel/teach.mjs` (`promptFit`), `intel/intel-routes.mjs`, `web/src/screens/intel/Owner.jsx`.
   - Înainte, rămâneau cele mai **vechi** 20, fără avertisment.
2. O regulă „pentru misiunea asta” ajunge la rulările acelei misiuni și la nicio altă rulare. `runs.mjs` trimite misiunea task-ului. Înainte, nu ajungea deloc.
3. O propunere care înlocuiește o regulă schimbată între timp e refuzată la confirmare (`LESSON_STALE_BASE`, „propune din nou”). Același lucru dacă a devenit activă altă regulă pentru aceeași condiție. Înainte rămâneau două reguli active.
   - Propunerea ține minte regulile pe care le înlocuiește. La confirmare, toate regulile active pentru aceeași condiție devin înlocuite (și dublurile rămase de la versiunea veche), chiar dacă intrarea lor din memorie fusese ștearsă între timp. O condiție are o singură regulă activă.

**Etapa 1 — cine scrie ce ajunge la agenți**

4. Memoria, faptele, preferințele și deciziile:
   - Le scrie doar sesiunea de proprietar sau canalul de test.
   - Interfața fără sesiune poate salva doar ipoteze. Pentru un fapt primește 401 `needSession`.
   - Autorul spune cine a scris cu adevărat: `owner:<sesiune>` sau `ui`, nu mai e „user” pentru orice proces local.
   - Rutele `/api/memory` trec prin dispecerul de proprietar.
   - Ștergerea unui fapt activ cere sesiunea. La fel și înlocuirea lui (inclusiv transformarea lui în ipoteză).
   - Fișiere: `domain/memory.mjs`, `runtime/command-catalog.mjs`, `http/routes.mjs`.
5. Deciziile:
   - `decision.record` fără sesiune devine **draft**. Nu intră în prompt și nici în pachetul de handoff.
   - Proprietarul îl decide în ședința Board, cu sesiunea lui (mecanismul exista deja).
   - Din sesiune, decizia e activă direct (și prin `/api/decisions`, care trece acum prin dispecerul de proprietar).
   - Ecranul Twin („impact”) arată doar deciziile active.
6. În prompt, conversația anterioară și pachetul de handoff sunt etichetate ca date: textul din ele nu trece peste regulile Hub-ului.
7. Filtrul de securitate al lecțiilor semnalează și blochează confirmarea pentru trei cazuri noi:
   - trimiterea de date în afară (site, link, cloud, URL);
   - ocolirea regulilor sau a verificărilor;
   - dezvăluirea conținutului fișierelor de configurare, jurnalelor sau bazei de date.

   Restricțiile negate („nu încărca…”) rămân permise.

## Dovezi

- `v2/tests/r-memory-audit.test.mjs`: 7/7 trec. Pentru fiecare corectură am făcut o mutație care readuce codul vechi, și testul ei pică (7 mutații pentru corecturile inițiale, 4 pentru cele din review: 11/11 prinse).
- Un review independent (agent separat, read-only) a găsit 13 puncte; 10 sunt corectate și acoperite de teste, 3 sunt notate mai jos.
- Testele zonelor afectate, după corecturile din review: 27 de fișiere, 295 de teste, 294 trec, 0 pică, 1 sărit (`L3-UI-02`, lipsește browserul Playwright în cloud).
- La rularea mai largă dinainte de review (28 de fișiere), 4 teste au picat (`M03-FAC-02`, `M03-FAC-19`, `M09-IN-03`, `U04-05`). Pică la fel și pe baza neschimbată `1acca9e`, pentru că cloud-ul nu are Chromium 1228 și uneltele media. Sunt limite de mediu, nu regresii.
- Suita completă (~1 h 45 min) nu a rulat; testare proporțională, cum s-a cerut.
- Build-ul interfeței trece (într-un folder temporar).
- Rulat cu Node 24.14.0 în cloud.

## Ce rămâne

- Release: upgrade gestionat pe PC, făcut de proprietar (fără migrare). Verificarea vizuală a ecranului Lecții nu s-a făcut.
- Profilul de dezvoltare pornit lasă orice proces local al contului lui să deschidă o sesiune de proprietar. Un nonce nu rezolvă: un proces al aceluiași utilizator poate citi și pagina, și baza. Oprirea profilului rămâne decizia lui.
- Deciziile înregistrate ca active înainte de 2.19.2 de un proces fără sesiune (autor „user”) rămân active; nicio migrare nu le reclasifică. O etapă ulterioară le poate lista pentru confirmarea ta.
- Ecranul Memorie pornește încă pe tipul „Fapt” și nu cere reautentificare; fără sesiune, salvarea e refuzată cu un mesaj clar (nu e coborâtă în tăcere).
- Etapele 2–6 din audit: versionare și restaurare, `expectedVersion`, memorie căutabilă pentru agenți, „dreaming” cu aprobare, portabilitate.
