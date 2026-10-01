# M03 · Pachetele de închidere: probele 2.3, 2.5 și 2.6

Data: 2026-10-01. Fiecare pachet se aprobă separat. Aprobarea unuia nu autorizează celelalte și nici commit, push, acceptarea R2, „Accept local” sau alte proiecte.

**Surse:**
- valorile vin din `M03_LIVE_VALIDATION_PLAN.md` (§2, tabelul probelor);
- faptele curente: starea misiunii Demo B la 15:21 UTC și refuzul `fable[1m]`;
- câmpurile reale ale grantului (`v2/server/domain/grants.mjs`).

Unde planul nu dă o valoare, apare **[Dn]**: o decizie care îți aparține. Pachetul e gata de aprobat după ce completezi toate Dn din textul lui.

## Condiții comune (plan §2)

- **Proiecte:** doar de test (`hub-test`), deci R2 nu cere acceptare.
- **Mod:** LIVE_VALIDATION pe durata probei.
- **Poarta:** deschisă.
- **Acordul ACL:** cel curent, amprenta `0f5b7efee0143fa8`, dat de tine pe 2026-10-01 la 06:46 UTC.
- **„Verifică contul” Codex cu modele, făcut în ultimele 24 h:** ultimul e din 2026-10-01, 06:46 UTC, deci e valabil până la 2026-10-02, 06:46 UTC. După această oră trebuie refăcut (click al tău, fără inferență).
- **Înainte de fiecare probă** rulez previzualizarea porții, fără model, și ți-o arăt:
  - poarta, proiectul, ruta de facturare, izolarea și `host_isolation`;
  - `run_plan`, concurența și lease-ul.

  Backup-ul proiectului se face și se verifică automat înainte de admitere.
- **După fiecare probă:**
  - reconciliem procesele și granturile;
  - revocăm grantul rămas;
  - Hub-ul revine în BUILD_SAFE.
- **Câmpurile grantului:**
  - `maxAttempts` (1–5);
  - `maxDurationS` = limita pe o execuție;
  - `ttlMinutes` (5–480) = valabilitatea grantului.

  Tabelul planului dă un singur număr de minute în coloana „Grant” și altul în „Durată max”, fără să spună cărui câmp îi corespund. Unde contează, apare ca decizie.

## Pachetul 2.3: Demo B, funcționalitate + remediere + E2E

**Faptele curente:**
- Misiunea `mis_mupj3zl4_9970bdd58b` (Demo B, reviewer `sonnet`, 2 cicluri, 120 min) a fost **aprobată și pornită de tine la 15:21 UTC**, pe 2026-10-01.
- Baseline-ul a dat **FAIL**, cum era de așteptat.
- Writer-ul a fost **refuzat de poartă** (Hub în BUILD_SAFE). Misiunea e **BLOCKED**, cu așteptarea `gate`.
- Refuzul a venit înainte de model, deci nu a consumat o încercare a etapei.
- Modelul implicit Claude al contului, `fable[1m]`, e refuzat de garda de facturare. Reviewer-ul este deci `sonnet`, trimis explicit.
- Termenul misiunii era 17:21 UTC. Dacă a trecut când apeși „Reia”, Hub-ul îl prelungește cu 120 min de la reluare (evenimentul `factory.deadline_extended`).

| Element | Valoare |
|---|---|
| Proiect | Factory Demo B · `prj_mup6nqd7_57f7ba5b4b` · `C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\ifrim-factory-demo-b` · `hub-test` · preview pe 4610 |
| Misiune | `mis_mupj3zl4_9970bdd58b`; scope-ul e deja aprobat de tine (15:21), deci nu se cere o aprobare nouă de scope |
| Traseu | IMPLEMENTING (Codex) → CHECKING → REVIEWING (Claude) → [REPAIRING → CHECKING → REVIEWING] × ≤ 2 → QA → PREVIEW (E2E în Chromium) → DELIVERY_READY |
| Codex | OpenAI · `codex app-server`, profil `ifrim_hub_rw`, rețea oprită · model: implicitul contului din `model/list`, trimis explicit (la verificarea de la 06:46: `gpt-6.1-sol`) · efort `medium` (BALANCED) |
| Claude | Anthropic · Claude Code `-p`, Read/Glob/Grep, `dontAsk`, fără MCP · model `sonnet` (`--model`) · efort `medium` |
| Drepturi | Codex: scriere doar în workspace-ul Demo B. Claude: doar citire |
| Granturi | Codex workspace-write × **3** încercări; Claude read-only × **3** încercări (1 + până la 2 cicluri de remediere). Planul dă „90 min” fără câmp → **[D2]** |
| Durată | planul: **60 min**; misiunea aprobată: **120 min** → **[D1]** |
| Date trimise | **OpenAI:** fișierele Demo B (fictive), specificația aprobată (cu pașii E2E), promptul Hub-ului, iar la remediere și findings-urile redactate. **Anthropic:** pachetul de review (diff redactat, ≤ 40 000 de caractere). E2E-ul și preview-ul rămân locale (127.0.0.1) |
| Oprire automată | apel MCP sau server MCP raportat (Codex după `thread/start`/`thread/resume`, Claude la init); model sau efort raportat diferit; model Claude refuzat (Fable, `best`, `[1m]`), `fallbackModel` sau comutare de model; `apiKeySource`; cerere de aprobare în afara workspace-ului; fișiere de control sau teste protejate modificate (finding critic); încercări epuizate; limita pe execuție; termenul misiunii; limita de 2 cicluri (→ NEEDS_OWNER_DECISION) |
| Oprire manuală | Stop pe misiune, Stop All, „Lega, oprește tot” |
| Stare finală dorită | `DELIVERY_READY`, cu pachetul în așteptarea deciziei tale; altfel BLOCKED / NEEDS_OWNER_DECISION cu motiv clar |
| Dovezi | id-urile execuțiilor (writer, reviewer, remediere); cronologia (turn → prima comandă); planul trimis/raportat; change set-urile și diff-urile; verificările; verdictul și findings-urile; ciclul de remediere; QA; E2E pe preview (pașii, capturile); pachetul de livrare |

**Decizii lipsă:**
- **[D1] Limita misiunii.** Ai aprobat 120 min la 15:21, iar planul spune 60 min. Dacă păstrezi 120 min, nu e nevoie de nimic în plus. Dacă vrei 60 min, probabil trebuie aprobat din nou scope-ul (NEVERIFICAT dacă limitele se pot schimba după aprobare).
- **[D2] Granturile.**
  - „90 min” din plan e limita pe execuție (`maxDurationS`) sau valabilitatea (`ttlMinutes`)? Cealaltă valoare lipsește.
  - Dacă valabilitatea e mai scurtă decât timpul rămas al misiunii, misiunea se poate opri la mijloc (BLOCKED, grant expirat).
- **[D3] Dacă primul change set trece fără remediere.** Remedierea apare doar dacă verificările sau review-ul găsesc o problemă, iar noi nu o forțăm. Variante:
  - accepți 2.3 cu remedierea NOT_RUN;
  - ceri o probă separată de remediere (planul permite „Demo B sau C”).

**Cine face ce:**
1. Tu: lipești textul de mai jos, completat.
2. Eu, prin API-ul local:
   - previzualizarea porții;
   - modul LIVE_VALIDATION;
   - cele două granturi;
   - îți arăt poarta.
3. Tu, în UI: Misiuni → `mis_mupj3zl4_9970bdd58b` → „Reia”, cu reviewer `sonnet`. **Doar acest clic pornește ceva.**
4. Eu:
   - urmăresc execuția și o opresc la abatere;
   - adun dovezile;
   - revoc granturile și revin în BUILD_SAFE;
   - raportez.

**Curățenie:**
- granturile rămase sunt revocate, iar Hub-ul e în BUILD_SAFE;
- 0 execuții active, niciun proces al misiunii (inclusiv preview-ul);
- în Demo B s-au schimbat doar fișierele lui, iar arborele Hub-ului e neschimbat;
- misiunea rămâne în `DELIVERY_READY` până la decizia ta („Accept local” e o acțiune separată).

**Textul de aprobare (completezi [D1]–[D3] și îl copiezi):**

> Aprob proba live 2.3 pe Factory Demo B (prj_mup6nqd7_57f7ba5b4b), misiunea mis_mupj3zl4_9970bdd58b: treci Hub-ul în LIVE_VALIDATION, creează grantul Codex workspace-write cu 3 încercări și grantul Claude read-only cu 3 încercări, fiecare cu [D2: N] min pe execuție și valabil [D2: M] min. Codex: implicitul contului din model/list, efort medium. Claude: sonnet, efort medium. Limita misiunii: [D1: 120 sau 60] min, cel mult 2 cicluri de remediere. Eu apăs „Reia” cu reviewer sonnet. Dacă primul change set trece fără remediere: [D3: accept 2.3 cu remedierea NOT_RUN / cer o probă separată de remediere]. Fără alte proiecte. După probă revoci granturile rămase și revii la BUILD_SAFE.

## Pachetul 2.5: Stop în timpul unui turn real

**Din plan:**
- proiectul `ifrim-factory-demo-a`, cu Codex read-only, efort `medium`;
- grant Codex · read-only · 1 încercare · 30 min, durată maximă 10 min;
- datele trimise: „o cerere de analiză lungă”;
- oprirea: apeși Stop la ~30 s după `turn_acknowledged`;
- dovezile: cronologia, `CANCEL_REQUESTED` → `CANCELLED`, nicio etapă următoare;
- starea finală: `CANCELLED`, nicio execuție activă.

**Fapt:** în Demo A, misiunea `mis_muph73y3_9c2c87061c` are pachetul `bnd_mupj3diq_d386324921` în așteptarea acceptării tale. O probă doar-citire nu scrie nimic. Lease-ul liber se confirmă în previzualizarea porții.

**Contradicție în plan:**
- `CANCEL_REQUESTED` → `CANCELLED` sunt stări ale unei **misiuni Software Factory**, iar turnul de model al unei misiuni e writer-ul (workspace-write).
- O execuție Codex **read-only** cu o cerere liberă e o execuție de conversație. Aceasta se oprește cu „Întrerupe” (`run.interrupt`) sau Stop All și se termină `interrupted`, fără `CANCEL_REQUESTED`.

| Element | Valoare |
|---|---|
| Proiect | Factory Demo A · `prj_mup6nfto_6214f5f782` · `C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\ifrim-factory-demo-a` · `hub-test` |
| Traseu | **[D1]**: R = execuție Codex read-only într-o conversație; M = misiune Software Factory nouă |
| Provider / model / efort | OpenAI · `codex app-server` · model **[D2]** · efort `medium` |
| Drepturi | R: doar citire (fără scriere). M: workspace-write (writer) |
| Grant | Codex · 1 încercare · R: read-only / M: workspace-write. Planul: „30 min” la grant și „10 min” durată maximă → **[D4]** |
| Încercări | 1. Stop-ul vine după ce turnul a fost trimis, deci încercarea **se consumă** (fără restituire) |
| Date trimise | OpenAI: cererea **[D3]**, promptul Hub-ului și fișierele Demo A citite de model (fictive) |
| Oprire | manual: Stop la ~30 s după `turn_acknowledged`. Automat: apel MCP, model/efort diferit, orice cerere de scriere sau aprobare (refuzată), limita pe execuție |
| Stare finală dorită | R: execuția `interrupted`, 0 execuții active. M: `CANCEL_REQUESTED` → `CANCELLED`, nicio etapă următoare |
| Dovezi | id-ul execuției; cronologia cu `turn_acknowledged`, momentul Stop și confirmarea opririi (latența); evenimentul `run.interrupted` (R) sau `factory.*` (M); reconcilierea proceselor (niciun proces Codex orfan al Hub-ului); consumul grantului; arborele Demo A neschimbat față de starea de după 2.2 |

**Decizii lipsă:**
- **[D1] Traseul.**
  - R se potrivește cu grantul read-only, cu cererea de analiză și cu durata din plan.
  - M se potrivește cu dovezile din plan (`CANCEL_REQUESTED` → `CANCELLED`), dar cere o specificație, limite și o aprobare de scope care nu sunt în plan. **M are nevoie de un pachet separat.**
- **[D2] Modelul explicit.** Planul dă doar efortul. Variante:
  - implicitul contului din `model/list` (la 06:46: `gpt-6.1-sol`);
  - alt model din listă.
- **[D3] Textul exact al cererii.** Condiții:
  - doar citire, pe fișierele fictive Demo A;
  - destul de lungă încât turnul să dureze clar peste 30 s după `turn_acknowledged`.
- **[D4] Grantul.** Ce înseamnă cele două valori? Lectura care respectă coloanele planului: 10 min pe execuție (`maxDurationS = 600`), valabil 30 min (`ttlMinutes = 30`). O confirmi sau o schimbi.

**Cine face ce:**
1. Tu: lipești textul.
2. Eu: previzualizarea porții, LIVE_VALIDATION și grantul.
3. Tu: pornești execuția din UI (planul: „același clic al proprietarului”) și apeși Stop la ~30 s după `turn_acknowledged`.
4. Eu:
   - confirm oprirea și reconciliez procesele;
   - revoc grantul și revin în BUILD_SAFE;
   - raportez.

**Curățenie:**
- grantul e revocat (sau epuizat), iar Hub-ul e în BUILD_SAFE;
- 0 execuții active și 0 procese Codex ale Hub-ului;
- Demo A e neschimbat.

**Textul de aprobare (traseul R; completezi [D2]–[D4]):**

> Aprob proba live 2.5 pe Factory Demo A (prj_mup6nfto_6214f5f782), traseul R: treci Hub-ul în LIVE_VALIDATION și creează grantul Codex read-only cu 1 încercare, [D4: 10] min pe execuție, valabil [D4: 30] min. Model [D2], efort medium. Cererea, doar citire: „[D3]”. Eu pornesc execuția și apăs Stop la aproximativ 30 s după turn_acknowledged. Fără alte proiecte și fără grant Claude. După probă revoci grantul rămas și revii la BUILD_SAFE.

Dacă alegi traseul M, îți pregătesc un pachet separat, cu specificația și limitele misiunii.

## Pachetul 2.6: Lega propune o misiune de engineering

**Din plan:**
- proiectul: Hub;
- o sesiune vocală, cu grant de voce separat;
- modelul: GPT-Live;
- grantul: voce · 1 sesiune · 10 min; durata maximă: 10 min;
- datele trimise: conversația vocală;
- oprirea: „Lega, oprește tot”;
- dovezile: propunerea, clicul tău și specificația v1;
- starea finală: `SPEC_DRAFT`, nimic nu rulează.

**Fapte (`LEGA.md`):**
- Lega folosește GPT-Live prin abonamentul ChatGPT, prin `codex app-server` (`thread/realtime/*`), fără cheie API.
- Grantul „Lega (voce)” e de tip Codex read-only. Încercările sunt sesiuni, iar durata e plafonul sesiunii (≤ 30 min).
- Sesiunea se oprește la BUILD_SAFE și la revocarea grantului.
- `propose_mission` afișează cardul „Lega propune o misiune”. După „Aprobă și creează”, misiunea se creează ca ciornă, fără execuție. Vocea nu poate aproba.
- `propose_mission` live: NOT_RUN.

| Element | Valoare |
|---|---|
| Proiect | sesiunea: Hub. Proiectul misiunii propuse: **[D2]** |
| Provider / model / efort | OpenAI · GPT-Live (abonamentul ChatGPT) · id-ul exact nu e în plan: dovada îl înregistrează cum îl raportează clientul (**[D3]** dacă vrei să-l fixezi) · efortul nu e definit în plan pentru voce |
| Drepturi | thread fără medii (fără shell, fără fișiere); doar unelte `lega.*` (rezumate, navigare, propuneri). Fără decizii din voce |
| Grant | „Lega (voce)” · 1 sesiune · 600 s · valabilitatea (`ttlMinutes`) lipsește → **[D1]** |
| Date trimise | OpenAI: conversația vocală, plus rezumatele redactate pe care le cer uneltele `lega.*` |
| Oprire | „Lega, oprește tot” (Stop All; se oprește și Lega); plafonul de 600 s; orice comandă, modificare de fișier sau apel MCP din sesiune (sesiunea se oprește, „violare”); BUILD_SAFE; revocarea grantului |
| Stare finală dorită | misiunea în `SPEC_DRAFT`, 0 execuții pornite |
| Dovezi | **doar live, cu vocea ta; nu se simulează nimic**: id-ul sesiunii; evenimentul `lega.proposal` cu aprobarea `lega.mission_request` (legată de hash); clicul tău (canal `ui`); id-ul misiunii în `SPEC_DRAFT`, cu specificația v1; consumul grantului (1/1); 0 execuții. Fără vocea ta, 2.6 rămâne NOT_RUN |

**Decizii lipsă:**
- **[D1]** Valabilitatea grantului de voce (`ttlMinutes`, 5–480).
- **[D2] Tipul, subiectul și proiectul misiunii.**
  - Tipul: `eng_bugfix`, `eng_feature` sau `eng_refactor`.
  - Subiectul: fără nimic ce pare secret, altfel propunerea e refuzată.
  - Proiectul: dacă e Hub-ul, misiunea rămâne ciornă, dar orice execuție ulterioară pe Hub e blocată de R2. Pe un proiect `hub-test`, nu.
- **[D3]** Opțional: fixarea id-ului exact al modelului de voce.

**Cine face ce:**
1. Tu: lipești textul.
2. Grantul de voce îl creez eu prin API, după aprobare, sau tu din UI (Grant nou → „Lega (voce)”).
3. Eu: pun modul LIVE_VALIDATION.
4. Tu: pornești Lega, îi ceri propunerea cu vocea, apoi apeși „Aprobă și creează”.
5. Eu:
   - adun dovezile;
   - revoc grantul și revin în BUILD_SAFE;
   - raportez.

**Curățenie:**
- grantul de voce e revocat, iar Hub-ul e în BUILD_SAFE;
- misiunea rămâne în `SPEC_DRAFT` (ștergerea ei e o decizie separată);
- 0 execuții.

**Textul de aprobare (completezi [D1]–[D2]):**

> Aprob proba live 2.6: treci Hub-ul în LIVE_VALIDATION și creează grantul „Lega (voce)” cu 1 sesiune de cel mult 600 s, valabil [D1] min. Eu vorbesc cu Lega și îi cer să propună o misiune [D2: tipul] cu subiectul „[D2: subiect]” pe proiectul [D2: proiect]; eu apăs „Aprobă și creează”. Nimic nu rulează: misiunea rămâne în SPEC_DRAFT. Fără grant de execuție. După probă revoci grantul și revii la BUILD_SAFE.
