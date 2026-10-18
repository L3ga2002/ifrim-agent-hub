# M08 · Contractul autopilotului

## Ce este

Un **obiectiv finit**: un titlu, criteriile de reușită și cel mult 5 sarcini. Fiecare sarcină are tip de lucru (BUGFIX / FEATURE / REFACTOR), criterii de acceptare, scope și dependențe. Bugetul total e de cel mult 300 de minute, cu cel mult 120 de minute pe sarcină. Fiecare sarcină devine o misiune obișnuită a fabricii (Software Factory), cu aceleași verificări.

## Fluxul

1. **Ciornă** (`autopilot.draft`): se validează cheile, duplicatele, dependențele orfane sau către sine, ciclurile (sortare Kahn) și bugetul. Nimic nu se creează în fabrică. Câmpurile prin care un client s-ar declara „proiect de test”, „proprietar” sau „mediu verificat” sunt ignorate.
2. **Pregătire** (`autopilot.prepare`): misiunile-ciornă se creează în ordinea dependențelor (SPEC_DRAFT). Nu pornește nimic.
3. **Plan** (`autopilot.propose`): **un singur plan (envelope)** peste sarcini, în ordinea obiectivului.
   - Planul se recitește din baza de date: un client nu poate pretinde alt obiectiv sau altă ordine.
   - La **TRUSTED** planul acoperă toate sarcinile, cu `nextMissionWithoutConfirmation`.
   - La **ASSISTED** acoperă doar sarcina următoare.
   - Rezumatul numește obiectivul.
4. **Confirmarea ta**, o singură dată: în cockpit (tastă sau buton) sau prin voce (fraza verificată local). Granturile se derivă intern, cel mult cât arată planul.
5. **Execuție:** sarcină după sarcină. După fiecare DELIVERY_READY, sarcina următoare pornește cu granturi derivate din nou, iar cele vechi se revocă. Scope-ul ei trebuie să fie încă cel confirmat.
6. **Oprire la DELIVERY_READY** pe ultima sarcină. Nimic nu se acceptă și nu se livrează singur.

## Condiții de oprire (afișate în plan)

- o sarcină ajunge la o decizie a ta (NEEDS_OWNER_DECISION) sau e blocată;
- s-a atins limita de timp, de încercări pe etapă sau de cicluri de remediere;
- planul expiră sau îl retragi; Stop / Pauză;
- scope-ul unei sarcini se schimbă după confirmare;
- ultima sarcină e gata de verificarea ta.

## Ce nu are voie

- **Fără drept de reluare propriu.** Nu există comenzi `autopilot.resume/retry/approve/confirm` (verificat în M08-D3-04). După Pauză rămâne în WAITING_OWNER (M08-D3-05).
- **Doar planul obiectivului.** Nu pornește alte misiuni decât cele din plan.
- **Nicio acoperire pentru un scope modificat.** Un obiectiv modificat devine o versiune nouă. Planul vechi e marcat SUPERSEDED și nu mai poate fi confirmat (M08-D3-04, plus un mutant prins).
- **Nicio acțiune exterioară.** Fără deploy, commit, push, mesaje, producție, credențiale sau migrări reale. Acestea sunt `deniedEffects` ale planului.
- **Fără canalele agent, CLI sau voce** pentru a crea, pregăti sau propune (M08-ADV-01, M08-D3-04).
- **Se oprește la orice schimbare între sarcini.** Exemplu: proiectul înghețat între două sarcini (M08-ADV-05); sarcina următoare nu pornește.

## Starea obiectivului

Starea e derivată din plan și din misiuni, nu e setată de un client:
- DRAFT → PREPARED → PROPOSED → RUNNING / WAITING_OWNER → DELIVERED / STOPPED;
- separat: SUPERSEDED.

Un plan expirat sau retras fără execuție permite un plan nou. În ASSISTED, după prima sarcină, starea revine la PREPARED pentru sarcina următoare.

## Dovada (PASS_SIMULATED)

M08-D3-02: un obiectiv cu două sarcini dependente pe proiectul fixture `bug-demo`.
- Ordinea e t1 (BUGFIX) → t2 (FEATURE).
- O singură comandă de-a ta: `envelope.confirm`. Zero formulare de grant, zero aprobări.
- Ambele sarcini ajung la DELIVERY_READY, planul se închide COMPLETED, iar modul revine la BUILD_SAFE.
- Niciun pachet nu e acceptat automat.
