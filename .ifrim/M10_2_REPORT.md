# M10.2 — Fluxul vocal fără formulare de grant

Data: 2026-10-05 · cod `2.12.0-m10.2` · contract API 11 · migrarea 11 `m10-2-work-requests` · **necomis** · **Hub-ul live rulează `2.12.0-m10.2` din 2026-10-05 04:57 UTC** (`upgrade.mjs --apply`, rularea `upg_muus3hq2`, backup verificat înainte de migrare `hub-v2.pre-migration.v10-to-v11…sqlite`, sha256 `4048d8a8…`).

Închiderea P0 (2026-10-05 → 06): codul din folder e acum `2.12.1-m10.2`, contract API 12, schema 11 (fără migrare). Vezi §11. Comis local ca `e1a2d0d` (fără push) și activ pe Hub-ul live din 2026-10-06, 03:03 UTC (rularea `upg_muw3g5tp`).

## 1. Ce s-a întâmplat (traseul tău real, 2026-10-04, 18:42–18:50 UTC)

1. Ai cerut prin voce un clip de promovare. Lega a propus o misiune (un click), iar misiunea a rămas ciornă (DRAFT).
2. Lega ți-a spus: „Hub-ul e în BUILD_SAFE, introdu LIVE_VALIDATION” și ți-a arătat panoul. Ai schimbat modul de mână.
3. Ai creat de mână un grant Codex.
4. Lega a fost refuzată de izolarea R2 a proiectului „Ifrim Agent Hub” și te-a trimis la panoul de izolare. Ai întrebat: „ce trebuie să fac aici”.
5. Sesiunea vocală s-a oprit la limita de 20 de minute.

## 2. Cauza (arhitectură, nu fraze)

- **Uneltele Lega.** Lega avea doar unelte care produceau carduri de aprobare și pointeri spre formulare (`prepare_grant`, „tastează LIVE_VALIDATION / OPEN GATE”). Nicio unealtă nu ajungea la planurile cu o singură confirmare.
- **Doi interpretori.** Browserul și serverul interpretau aceleași cuvinte separat. De aceea Hub-ul a deschis Notepad în timp ce Lega spunea că nu poate.
- **Un singur fel de plan.** Planurile acopereau doar misiunile Software Factory. Un clip de promovare a devenit o ciornă pe care niciun plan nu o putea lua.
- **Modul global.** Confirmarea unui plan scria modul global al Hub-ului, iar un grant manual putea fi folosit de un pas al planului.
- **Blocaje fără explicație.** Blocajele reale (R2, atestarea WSL) apăreau ca ID-uri brute, fără explicație și fără păstrarea cererii.
- **Confirmarea vocală armată** nu se putea declanșa niciodată.

## 3. Ce s-a schimbat

**Un singur traseu de comenzi**
- Vocea, textul și interfața trec toate prin același serviciu (`v2/server/owner/intake.mjs`). `owner.intent` e acum doar un înveliș.
- Clasa de efect se decide pe server (`policy/effect-class.mjs`):
  - **citire / navigare**: fără worker nou;
  - **acțiune locală simplă**: de exemplu „Deschide Notepad” într-o aplicație deja autorizată;
  - **plan cu limite**: o singură confirmare;
  - **schimbare de scope / sensibilă**: decizie separată;
  - **întrerupere** și **refuzat**.
- O transcriere a providerului nu confirmă niciodată, nu ridică autonomia și nu redeschide poarta.

**Lega pe traseul comun**
- Puntea vocală de pe server trimite fiecare propoziție finală a ta prin traseul comun. Hub-ul spune singur ce a făcut, ca agentul să nu-l contrazică.
- Sub politica voice-first, Lega nu mai are `prepare_grant` și nu mai arată spre mod, poartă sau formularul de grant.
- Lucrul real trece prin `lega.request_work`. `propose_run` și `propose_mission` duc la planificatori, nu la carduri de aprobare.
- Calea veche (politica legacy) a rămas neschimbată.

**Planuri cu o singură confirmare**
- **Inginerie** („Repară testul X din proiectul Y”): ciornă plus un singur plan. Modelele pe rol (Codex gpt-6.1-sol · medium, Claude sonnet · medium) sunt afișate și legate în plan; nu folosesc niciodată modelul implicit al contului.
- **Analiză** („Analizează…”, „Rezumă…”): plan cu un singur pas de model, doar citire.
- **Studio**: import dintr-un folder numit, „arată-mi clipul”, „la secunda N mută textul”, variante. Totul local, fără model.

**Hub-ul rămâne în BUILD_SAFE**
- Poarta admite doar pașii legați de un plan deschis, prin granturi derivate „legate”.
- Un grant manual nu servește niciodată un pas de plan, și invers.
- Limitele de timp se numără de la confirmare.
- Când granturile unui plan se epuizează, Hub-ul derivă altele, în bugetul afișat.
- Remedierile afișate pe card sunt incluse în plan.
- Revocarea unui plan sau a grantului lui oprește misiunea.

**Blocaje oneste**
- O explicație o singură dată, apoi o linie scurtă. Cererea rămâne păstrată (tabela `work_requests`) și e re-propusă singură când blocajul dispare. Doar propusă: confirmarea rămâne a ta.
- Pașii automați de pregătire rulează singuri, fără model: verificarea contului, inspecția mediului, reconcilierea skill-urilor.
- Re-atestarea WSL pe aceeași amprentă rulează după confirmarea ta, ca pas al planului. Planul afișează „Plan pregătit (fac singur pregătirea după confirmare)”.
- O amprentă nouă nu e aprobată niciodată automat.
- Invalidarea atestării e anunțată la pornire, nu abia la Start.

**Confirmare vocală armată automat**
- După ce Hub-ul îți prezintă planul în sesiunea Lega, fereastra de 90 s se deschide singură, dar doar dacă sunt îndeplinite toate condițiile: filtrul vocal activ, profil, transcriere locală, plan gata, autonomie potrivită.
- „Da, execută planul” confirmă planul exact o singură dată, chiar dacă ai fost navigat în altă parte.
- „Nu acum”, „Stai, nu executa planul”, o reluare sau vocea lui Lega nu confirmă.

**Pauză, Continuă, Oprește tot**
- „Pauză” (spusă sau scrisă) e pauza ta: se înregistrează autentificatorul tău, iar misiunile și planurile de operare se pun pe pauză.
- „Continuă”, scris sau spus local, redeschide doar pauza ta.
- După Stop All, redeschiderea porții era în 2.12.0 o acțiune de administrare (schimbat în 2.12.1 — vezi §11).

**Securitate**
- **Căutarea „live” a Lega** cere confirmarea pe server: un tab vechi nu poate porni fără ea. Setarea ta nu e schimbată.
- **`GET /api/media/tools`** nu mai fixează nimic. Fixarea e o acțiune explicită: butonul „Fixează” în Studio → Unelte sau un pas al unui plan confirmat. Un binar schimbat se confirmă în același panou.
- **Skill-urile** se reconciliază fără aprobare automată. Aprobarea vine doar dintr-un commit sau din decizia ta.

**Contoarele probei (§13)**
- `GET /api/owner/probe?sinceSeq=N` (doar citire) numără:
  - formularele de grant deschise;
  - schimbările manuale de mod;
  - navigările la Aprobări;
  - confirmările de scope;
  - clarificările;
  - autentificările suplimentare;
  - intervențiile dezvoltatorului (canalele agent / cli / test și scrierile în afara jurnalului).
- Scriptul `node v2/scripts/probe-m10-2.mjs` le afișează.

**Interfața**
- Cardurile de plan apar oriunde. Enter confirmă exact cardul prezentat, iar focusul e legat de id-ul planului.
- Căile manuale vechi sunt mutate la „Avansat”. Stop All, revocarea, „Revino la BUILD_SAFE” și „Suspendă poarta” rămân la un click.

## 4. Decizii luate după promptul tău (fără să te mai întreb)

| | Decizie |
|---|---|
| D1 | Sub voice-first, ciorna creată din cererea ta nu mai cere un card de aprobare separat: planul e singura confirmare. |
| D2 | Hub-ul rămâne în BUILD_SAFE; pașii planului sunt admiși prin autoritatea planului (fanionul `envelopeScopedLive`, revocabil). |
| D3 | Re-atestarea pe aceeași amprentă rulează după confirmarea planului, ca pas al lui; nu se aprobă niciodată automat o amprentă nouă. |
| D4 | Modelele pe rol sunt cele implicite, afișate și legate în plan; le poți suprascrie per proiect (`factory.defaults.set`, Windows Hello). |
| D5 | În M10.2 nu există clipuri generate și niciun model media. Fără materiale, cererea e păstrată, cu opțiunile de import sau captură. |
| D6 | Remedierile afișate pe card sunt incluse în aceeași confirmare. |
| D7 | Vocea transcrisă de provider poate deschide aplicații deja autorizate, dar doar într-o sesiune Lega derivată din sesiunea ta, verificată pe server. |
| D8 | Filtrul vocal rămâne o setare globală, pe care o activezi tu o dată. |
| D9 | Paza căutării „live” e pe server; setarea ta nu e schimbată. |
| D10 | Depozitul Hub-ului nu e niciodată țintă pentru Software Factory sau pentru scrierea Codex. Explicația e dată o singură dată. |
| D11 | Reziduurile tale de pe Hub-ul live (mod, grant manual, ciorne) nu au fost atinse. |
| D12 | Telemetria de navigare `owner.nav`: doar o listă fixă de ecrane, fără id-uri sau text. |
| D13 | „Continuă” redeschide doar pauza ta; după Stop All rămânea, în 2.12.0, acțiunea de administrare (schimbat în 2.12.1 — vezi §11, D14). |

## 5. Ce rămâne o decizie separată (intenționat)

- **Activarea filtrului vocal**: o dată, în sesiunea ta.
- **Căutarea pe internet „live”**: rămâne setarea ta, cu confirmare la fiecare pornire.
- **Ruta wsl-runner a unui proiect real și aprobarea (b)**, o amprentă nouă, acceptarea riscului R2: decizii de administrare.
- **MB1 / MEDIA_B / MEDIA_C**, OBS și publicarea.
- **Acceptarea pachetelor istorice**: ProDelivery, D6, Demo B.

## 6. Verificare

**Hartă:** 9 agenți, doar citire, cu `fișier:linie` pentru fiecare traseu.

**Implementare:** 16 unități în 5 valuri, fiecare cu testele ei.

**Integrare:** goluri reparate de mine:
- interogarea Studio care număra mereu 0 materiale;
- poarta tratată ca blocaj pentru Studio;
- cererile păstrate marcate DONE când planul se termină;
- pauza Lega care devine pauza ta;
- rutarea cererilor de analiză și de inginerie scrise;
- rutele lipsă;
- fraza „cererea ta rămâne păstrată” mutată la început, ca să nu fie tăiată la vorbire.

**Review adversarial:** 60 de agenți, 8 dimensiuni, fiecare constatare contestată de un verificator.

| | Câte |
|---|---|
| Confirmate | 42 (5 grave) |
| Infirmate | 10 |
| Reparate | toate cele 42, fiecare cu test de regresie |

Mutațiile verificate au fost toate prinse.

**Teste:** vezi §7.

## 7. Teste

**Suita completă V2:** 1110 teste · 1109 PASS · 0 FAIL · 1 SKIP (T25). **V1:** 552 · 551 PASS · 1 SKIP. Detalii în `M10_TEST_REPORT.md` §7.

## 8. Activare

Prin runner-ul de upgrade, cu backup automat înainte de migrarea 11:

```
node v2/scripts/upgrade.mjs --plan
node v2/scripts/upgrade.mjs --apply
```

La repornire Hub-ul revine singur în BUILD_SAFE: modul LIVE_VALIDATION setat de tine de mână dispare. Cele 6 skill-uri media sunt reimportate la boot, deja comise.

**Făcut pe 2026-10-05 la 04:57 UTC** (rularea `upg_muus3hq2`). Verificat pe runtime-ul servit, doar prin citiri:
- versiunea `2.12.0-m10.2` / contract 11;
- BUILD_SAFE (`modeReset`) și niciun plan activ;
- atestarea WSL invalidă, anunțată la pornire (`canary_changed`);
- paza căutării „live” activă (`webSearchNeedsConfirm`);
- `/api/owner/probe` răspunde;
- cele 6 skill-uri media sunt tracked + clean la `e8a55ce`;
- două citiri `GET /api/media/tools` nu au produs niciun eveniment, iar pinurile existente au rămas;
- interfața servită conține textele noi.

## 9. Fișa probei ghidate (o singură autorizare)

Vezi secțiunea „Proba ghidată” din raportul de închidere din chat. Contoarele se citesc cu:

```
node v2/scripts/probe-m10-2.mjs --mark
node v2/scripts/probe-m10-2.mjs --since <seq>
```

## 10. Limite cunoscute

- **Consumul real** al vocii (GPT-Live) și al Claude nu e raportat: vezi doar estimări.
- **API-ul vocal `thread/realtime`** e experimental: orice actualizare Codex cere retestare.
- **Filtrul vocal** nu e autentificare. Pragul e calibrat doar pe mostrele tale, iar rata de acceptări false nu e măsurată.
- **Fără filtru vocal**, orice voce din cameră poate cere navigare, planuri sau deschiderea aplicațiilor autorizate. Nu poate confirma și nu poate schimba autoritatea.
- **CapCut**: expunerea reală prin UI Automation e încă necunoscută (`--capcut-inspect` nerulat).
- **Repo-ul Hub-ului** nu poate fi țintă pentru scriere Codex (D10).

## 11. Închiderea P0 — `2.12.1-m10.2`

Data: 2026-10-05 → 2026-10-06 · cod `2.12.1-m10.2` · contract API 12 · schema 11 (fără migrare) · pe `v2-milestone-01`, peste `e8a55ce` · **comis local ca `e1a2d0d`** (fără push) · **activ pe Hub-ul live din 2026-10-06, 03:03 UTC** (rularea `upg_muw3g5tp`, verificat: `2.12.1-m10.2`, contract 12, BUILD_SAFE, 0 granturi active).

Nimic din 2.12.1 nu a fost rulat live: niciun model, nicio sesiune Lega, niciun upgrade, niciun Windows Hello real. Toate dovezile de mai jos sunt PASS_SIMULATED; partea live e NOT_RUN.

### 11.1 Ce mai era greșit după 2.12.0

**Două resturi din fluxul vechi:**

1. **Redeschiderea după „Oprește tot” era o cale de administrare.** Singura cale era `OPEN GATE` tastat în Integrări → Avansat: fără sesiunea ta, fără Windows Hello, nelegată de oprirea pe care o anula. Textele te trimiteau acolo sau la „Sistem”, unde nu există niciun control al porții.
2. **„Continuă” mergea doar scris.** Raportul spunea „scris sau spus local”, dar calea rostită nu ajungea nicăieri: Lega refuza cuvântul, iar segmentul verificat local nu era trimis de nimeni.

**Ce a mai găsit harta** (doar citire, cu `fișier:linie`, înaintea implementării):

- Stop All nu înregistra cine a oprit. Orice suspendare care nu era pauza ta apărea ca „Stop All”, inclusiv „Pauză” din paletă.
- După Stop All, un „Continuă” scris relua totuși un plan de operare pe care chiar Stop All îl oprise.
- Doar forma exactă a pauzei rostite era a ta. „Lega, pune totul pe pauză” devenea o pauză fără sesiune, pe care „Continuă” nu o putea redeschide.
- După un plan expirat, „Continuă” răspundea „Nu am niciun plan oprit de continuat”.
- Proba ar fi eșuat din motive mărunte:
  - numele „Factory Demo M10.2” (cu punct) nu era recunoscut;
  - fraza de la pasul D cerea o întrebare despre test;
  - cardul promitea preview și E2E, deși specificația nu le avea.
- Butonul „Rulează pașii automați” ar fi atestat și o amprentă nouă a mediului WSL: pe canalele `ui` și `agent` nu exista nicio verificare a amprentei.

**Ce a mai găsit review-ul**, după prima rundă de implementare (cele mai importante):

- O execuție aflată încă în admitere când cădea Stop All ajungea totuși la model. Defect vechi al comutatorului de oprire, dinainte de P0 (AS-01).
- Regula din runda 1 ținea pe loc prea mult: „Continuă” nu mai relua planuri fără model oprite din alt motiv decât oprirea porții (REG-01).
- Un „Continuă?” rostit putea relua, când transcrierea locală pierdea semnul întrebării (VOICE-01).
- „Redeschide poarta după Stop All” era citit ca un al doilea Stop All (PF-01).
- Cardul de rearmare putea fi „apăsat” din nou singur, la o reîncărcare a cockpitului (UI-02).
- O misiune blocată la poartă nu mai putea fi reluată după rearmare (SM-01), iar o trecere de pregătire o putea relua singură (SM-02).

### 11.2 Ce s-a schimbat, în termenii tăi

**D14 — Redeschiderea porții e un card în cockpit.**
- După „Oprește tot” (sau după orice suspendare care nu e pauza ta), cockpitul îți arată un card: ce a oprit poarta, când și de unde, ce s-a oprit, ce rămâne oprit.
- Confirmi în sesiunea ta, cu Windows Hello proaspăt (cel mult 5 minute). Confirmarea e legată de oprirea exactă (nonce + hash; oprirea e verificată din nou în aceeași tranzacție). Dacă între timp apare altă oprire, cardul vechi nu mai e bun. Cardul e valabil 5 minute.
- Doar click, Enter sau text tastat. Niciodată voce, telefon, agent sau temporizator.
- `OPEN GATE` tastat în Integrări → Avansat rămâne doar cale de diagnostic. Refuză o oprire aflată lângă un eveniment de securitate.

**D15 — Rearmarea redeschide poarta, nu munca.**
- Se redeschide toată poarta: un singur comutator. Dacă Hub-ul nu era în BUILD_SAFE, revine acolo.
- Nimic vechi nu repornește. Doar cererea care a afișat cardul e propusă din nou, ca plan care cere confirmarea lui.
- „Oprește tot” închide și cardurile de plan care încă așteptau confirmarea. Cererile lor rămân păstrate, dar nu sunt propuse din nou singure.

**D16 — Evenimentele de securitate se văd și se confirmă.**
- Cardul listează, cele mai noi primele, evenimentele de securitate începând cu 15 minute înaintea opririi:
  - Lega a încercat o acțiune interzisă;
  - o propoziție a ocolit filtrul vocal;
  - un autentificator al tău a fost revocat.
- Bifezi „Am verificat cauza” înainte de redeschidere. Bifa e legată de lista afișată: un eveniment nou cere un card nou.

**D17 — Fiecare oprire spune cine a făcut-o.**
- Se înregistrează felul opririi, canalul, ora și referința autentificatorului (doar un prefix de hash, niciodată identificatorul).
- Ordinea de precedență: securitate > Stop All > oprirea Hub-ului > suspendare > pauză. O oprire mai slabă nu șterge una mai puternică.
- Un singur clasificator pentru cockpit, blocaje și pregătire. „Pauză” din paletă nu mai apare ca Stop All.

**D18 — „Continuă” rostit.**
- Reia doar când e vocea ta, verificată local: verificarea vorbitorului și whisper local, într-o sesiune Lega pornită din sesiunea ta, cu filtrul vocal pornit.
- Doar propoziția întreagă („Continuă”, „Lega, continuă”), folosită o singură dată. Rulează același executor ca textul scris.
- Transcrierea providerului nu reia niciodată. Are doar drept de veto: dacă providerul a auzit „Continuă?”, nici varianta locală nu reia.

**D19 — Pauza spusă către Lega e pauza ta.**
- Într-o sesiune Lega pornită din sesiunea ta (aici filtrul vocal nu e necesar, spre deosebire de D18), „Lega, pune totul pe pauză” (adresată) sau „Pune totul pe pauză” (forma explicită) se înregistrează ca pauza ta. „Continuă” o redeschide.
- Doar formele afirmative. „Lega, nu pune totul pe pauză” sau „…dacă pică testele” nu devin pauza ta.

**D20 — O întrebare nu reia.**
- „Continuă?” primește o singură clarificare și nu reia nimic.
- După un plan expirat, „Continuă” îți arată drumul: Reia misiunea „X” (un plan de continuare, confirmat o dată).

**D21 — Corecturile pentru probă.**
- Numele de proiect cu punct („Factory Demo M10.2”) sunt recunoscute.
- Singurul test de acceptanță al proiectului e ales și protejat fără întrebare. Nu și când ceri să scriu sau să adaug un test, ori când numești alt test.
- Cardul planului pomenește preview și E2E doar dacă specificația le are.
- Atestarea automată din Configurare re-atestă doar aceeași amprentă; `environment.attest` transmite amprenta așteptată (`expectFingerprint`). Prima atestare sau o amprentă nouă rămân decizia ta (Sistem → Medii).

**D22 — Ce a oprit Stop All se reia doar după rearmare.**
- Planurile de operare, sesiunea desktop și misiunile oprite chiar de un Stop All (sau de oprirea Hub-ului ori de o oprire de securitate) așteaptă rearmarea. Regula e aceeași pe orice cale: „Continuă” scris sau rostit, butonul de pe cardul planului, reluarea desktopului.
- Ce a fost pus pe pauză din alt motiv (pauza ta, „Preiau eu”, o intervenție a ta) se reia ca înainte.

**D23 — Lega își verifică singură contul la pornire.**
- Dacă verificarea contului Codex e învechită, pornirea Lega din sesiunea ta o reface singură: aceeași verificare fără inferență ca „Verifică contul”, o dată per pornire.
- Previzualizarea rămâne doar citire și arată astfel de verificări ca „verific singur la pornire”. Un eșec e arătat cinstit.

**Reparat în aceeași închidere:**
- O execuție aflată în admitere când cade Stop All nu mai ajunge la model (golul vechi din `runtime/runs.mjs`).
- O trecere de pregătire nu mai reia munca după o rearmare.
- Oprirea Hub-ului în timp ce rulează o execuție (sau una e încă în admitere) închide și ea cardurile de plan care așteptau; o oprire fără execuții în lucru nu înregistrează nicio oprire și nu închide nimic.
- Cardul de rearmare e arătat întotdeauna înaintea deciziei și nu se mai repetă singur la reîncărcarea cockpitului.
- Contract API 12: o pagină construită pentru contractul 11 e refuzată (`UI_STALE`) până la reconstruirea UI-ului.

### 11.3 Ce rămâne o decizie separată

- **Activarea filtrului vocal**, o dată, în sesiunea ta. Fără el, „Continuă” rostit și „Da, execută planul” rostit nu există.
- **Planul propus din nou după rearmare**: cere tot confirmarea ta.
- **Prima atestare WSL sau o amprentă nouă** (Sistem → Medii) și aprobarea (b). Atestarea e invalidă de la codul M09 (o schimbare benignă într-un fișier al Hub-ului), pe aceeași amprentă; re-atestarea e o operație separată, fără model. Proba nu are nevoie de ea (ruta Windows).
- **Înregistrarea unui autentificator**, dacă nu ai niciunul (Lega → Configurare → Identitate). Fără el, cardul nu are cu ce deschide sesiunea.
- **Trei întrebări de produs lăsate ție** (vezi tabelul din §11.4):
  - dacă „stop all” spus imediat după „după” să nu mai fie citit niciodată drept comandă;
  - dacă „Reia”, „Mergi mai departe” și „Poți continua” să rămână forme de „Continuă” rostit;
  - dacă atestarea cerută de un agent delegat să fie limitată la aceeași amprentă.
- **Commitul, upgrade-ul și push-ul**: aprobările tale, după fișa probei (`M10_2_PROBE_SHEET.md`).
- Tot ce era în §5 rămâne neschimbat.

### 11.4 Verificare

**Hartă** (doar citire): oprirea și rearmarea, căile vocale, fișa probei, atestarea WSL.

**Implementare, runda 1:** 4 unități (poarta și rearmarea; intake și „Continuă” rostit; corecturile de probă; interfața), apoi integrarea: 424/424 de două ori.

**Review adversarial:** 6 dimensiuni (autoritate, mașina de stări, voce, interfață, corecturile de probă, regresii). Fiecare constatare a fost contestată de un verificator.

| | Câte |
|---|---|
| Confirmate | 19 |
| Confirmate parțial | 19 |
| Infirmate | 8 |
| **Total** | **46** |

După verificare: 1 gravă (AS-01, defectul vechi din `runs.mjs`), 6 medii, 39 minore.

**Implementare, runda 2:** 4 unități (runtime și poartă; intake și voce; intenții, planificator și configurare; interfață și reluările de plan / desktop), apoi integrarea: 506/506 de două ori.

**Ce s-a reparat:**
- toate cele 19 confirmate, fiecare cu test de regresie;
- 17 dintre cele 19 parțiale, în partea lor reală;
- două dintre cele infirmate au fost totuși întărite: cardul se arată întotdeauna înaintea deciziei (UI-01), iar lista de securitate arată cele mai noi evenimente, cu numărul real (AS-05, împreună cu SM-08).

**Ce a rămas deschis și de ce:**

| Constatare | Stare | De ce |
|---|---|---|
| SM-04 — un lease reținut blochează orice redeschidere | deschis | Defect vechi, în afara P0. Cere un pas nou de reconciliere a lease-urilor în sesiunea ta. |
| REG-06 — un card de plan propus de 2.12.0, rămas neconfirmat peste upgrade | fără schimbare de cod | Cardul se cere din nou. E efectul dorit al D21 (cardul nu mai promite preview / E2E inexistente). |
| VOICE-06, partea veche — o pauză negată spusă către Lega încă pune pauză | deschis | Defect vechi al interpretorului; greșește spre oprire. P0 a reparat doar atribuirea: nu mai e înregistrată ca pauza ta. |
| VOICE-05 — „Reia”, „Mergi mai departe” contează ca „Continuă” rostit | decizia ta | Aceeași gramatică precum textul scris (D18). Îngustarea e o alegere de produs. |
| VOICE-01, limita — veto-ul providerului e așteptat cel mult 2,5 s | acceptat | Așteptarea e mărginită prin proiectare. O transcriere sosită mai târziu nu mai poate opri reluarea. |
| PF-07 (infirmată) — un agent delegat poate atesta o amprentă nouă | decizia ta | Design din M07, cu delegare înregistrată. D21 privește doar atestarea automată. |
| AS-03 (infirmată) — `OPEN GATE` tastat cere doar tokenul paginii | păstrat | D14 îl păstrează ca diagnostic; refuză opririle de lângă un eveniment de securitate. |
| „Ce urmează după Stop All?” | deschis | Apărarea acoperă doar frazele cu verb de redeschidere sau de reluare. |
| SM-02 — una dintre cele două gărzi | apărare în adâncime | E mascată de cealaltă: mutația ei singură nu poate fi prinsă de un test. |

### 11.5 Teste

- **Fișiere noi:** 10 fișiere `v2/tests/m10-2-p0-*.test.mjs`, 119 teste. Ce dovedește fiecare: `M10_TEST_REPORT.md` §8.
- **D23:** `v2/tests/m10-2-p0-lega-autoprobe.test.mjs`. 17 teste; rulările țintite 115 + 154 PASS; inclus în regresia completă de mai jos. Review-ul D23 (2 lentile) a găsit 12 constatări; cea mai importantă (un „Oprește” în timpul verificării nu oprea pornirea) e reparată cu test.
- **Integrarea rundei 2** (toate cele 34 de fișiere `m10-2-*` și 17 suite mai vechi, pe un UI construit separat): **506/506 de două ori**, 0 sărite. În plus, 132/132 pe 20 de suite conexe. Testele de browser au rulat real (Chromium headless, autentificator virtual).
- **Regresia completă V2:** **1246 teste · 1245 PASS · 0 FAIL · 0 anulate · 1 SKIP** (T25, symlink, neschimbat); 128 de fișiere, fără `m11-*`, UI construit separat; 55 min (2026-10-06, 00:21–01:17 UTC)
- **V1:** **552 teste · 551 PASS · 0 FAIL · 1 SKIP** (2026-10-06, 01:17 UTC)
- **Niciun test nu pornește un model.** Furnizorii, vocea, mediul WSL și autentificatorul sunt simulate.

### 11.6 Limite cunoscute

- **Lease reținut.** Blochează orice redeschidere: cardul, „Continuă” și `OPEN GATE`. Cockpitul nu are încă eliberare pentru el. Apare când oprirea unui proces de provider nu a putut fi confirmată sau când Hub-ul a repornit în mijlocul unei execuții.
- **„Ce urmează după Stop All?”** încă înseamnă Stop All.
- **Calea de diagnostic `OPEN GATE`** există încă în Integrări → Avansat. Nu cere sesiunea ta și nici Windows Hello, nu readuce BUILD_SAFE și, spre deosebire de card, poate propune din nou cereri păstrate mai vechi.
- **Filtrul vocal nu era activat pe Hub-ul live** la data hărții (2026-10-05). Până îl pornești, „Continuă” rostit nu poate fi validat live; Lega spune doar fraza cinstită („îl iau scris în cockpit sau cu vocea ta verificată local”).
- **Veto-ul providerului** e așteptat cel mult 2,5 s. O transcriere sosită mai târziu nu mai poate opri reluarea.
- **Cardurile planurilor de operare** (Studio, desktop) nu sunt închise de Stop All. Cer oricum confirmarea lor și expiră singure.
- **Contorul probei:** Windows Hello de la rearmare se numără la „Autentificări suplimentare”.
- **Nimic rulat live.** Windows Hello real, vocea reală, upgrade-ul și proba A–G sunt NOT_RUN pentru 2.12.1.
