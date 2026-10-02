# M06-B · Experiența Lega 2.0

Data: 2026-10-02. Ecranul de start al Hub-ului este acum **Lega** (`#/lega`). Dashboard-ul complet (Control Room și celelalte) rămâne la un clic, în bara laterală.

## 1. Cum arată o misiune obișnuită

**O singură dată** (Lega → Configurare, `#/lega/setup`):
1. Înregistrezi autentificatorul calculatorului (Windows Hello / PIN / cheie).
2. Activezi politica voice-first (textul exact și Windows Hello).
3. Alegi autonomia pe proiectele tale de test, de exemplu ASSISTED sau TRUSTED.
4. Opțional: profilul vocal local.

**Apoi, la fiecare misiune:**
1. „Hai să lucrăm la Factory Demo A”: cockpitul se deschide din datele Hub-ului; nu pornește nimic.
2. „Arată-mi înainte să faci”: cardul de decizie arată planul uman.
3. „Da, execută planul”: Enter, butonul sau textul tastat; dacă sesiunea e blocată, Windows Hello. **Aceasta e singura ta acțiune.**
4. Hub-ul derivă granturile, intră în LIVE_VALIDATION dacă era în BUILD_SAFE, și rulează baseline → writer → verificări → review → (remedieri în limită) → QA → preview → livrare. Te oprește doar pentru o decizie reală (la ASSISTED, o remediere).
5. „Gata pentru verificare”: verifici livrarea. Hub-ul nu acceptă și nu livrează singur.

Măsurat în UI-ul real (M06-UI-E2E-01, autentificator virtual): după configurare, **1 confirmare, 0 formulare de grant, 0 clicuri în Aprobări**. În proba (c) din M05 erau mod, 2 granturi, misiune, „Aprobă și pornește”, reviewer + „Reia”.

## 2. Ce înțelege Lega (local, fără model)

Resolver-ul de intenții (`v2/server/owner/intents.mjs`): română fără diacritice obligatorii, comenzi înlănțuite (`;`, „apoi”, „după aceea”), negații și condiții, referințe la proiect și misiune, câte o singură întrebare când două variante se potrivesc.

| Spui | Lega face | Efect |
|---|---|---|
| „Hai să lucrăm la ProDelivery” | deschide cockpitul proiectului | citire |
| „Continuă ce făceam ieri” / „Ce s-a schimbat?” | delta de la ultima vizită | citire |
| „Arată-mi ce a schimbat Codex” | cardul Diff | citire |
| „Claude ce a găsit?” | cardul Review | citire |
| „Testele?” | cardul Teste | citire |
| „Doar arată-mi planul, nu porni nimic” | planul, explicit fără pornire | plan |
| „Continuă problema cu comenzile, dar fără deploy” | planul pentru misiunea potrivită; „fără deploy” rămâne o constrângere | plan |
| „Nu porni încă; schimbă ordinea” | nimic nu pornește | — |
| „Da, execută planul” | confirmă **doar** planul afișat, doar tastat în sesiunea ta | efect |
| „Ce face acum?” / „Ce face Codex?” | faza, ultima acțiune confirmată, mediul, timpul, inactivitatea; fără progres inventat | citire |
| „De ce e blocat?” | regula, dependența, cea mai mică acțiune de deblocare | citire |
| „De ce Claude aici?” | ruta și motivul ei | citire |
| „Arată-mi de ce a picat testul” | reluare READ_ONLY până la prima eroare | citire |
| „Arată-mi compania” → „Engineering” → „înapoi” | harta: departamente → misiuni → execuții; „înapoi” urcă un nivel | navigare |
| „Lega, arată-ți fața” / „Revino la nucleu” / „Mai discret” / „Ascunde fața” | morph-ul feței | vizual |
| „Taci” | oprește vocea, nu munca | întrerupere |
| „Pauză” | niciun pas nou; pasul activ e întrerupt și reluat la „Reia” (nu se numără ca încercare) | întrerupere |
| „Oprește Codex” | întrerupe workerul; într-o misiune, pauza ei | întrerupere |
| „Îngheață ProDelivery” | verificarea `project_frozen` în poartă, misiunile pe pauză, planul revocat | întrerupere |
| „Oprește tot” | Stop All local | întrerupere |
| „Preiau eu” | revocă, oprește, confirmă că nimic nu mai rulează, checkpoint, apoi îți predă controlul | întrerupere |
| „Nu mă deranja până termini, decât pentru o decizie” | doar decizii și riscuri te mai întrerup | preferință |

**Reguli ale consimțământului:**
- Un „da” contează doar cât timp cockpitul arată exact un plan care așteaptă (id, nonce, hash).
- „Da” după o întrebare de navigare nu contează.
- Cu două planuri în așteptare, Lega întreabă care.
- O confirmare între ghilimele e citat.
- Textul transcris de provider (vocea GPT-Live) poate deschide, arăta, planifica și opri; nu poate confirma, nu poate ridica autonomia, nu poate dezgheța.

## 3. Cockpitul

Starea proiectului:
- „Context disponibil”;
- „Plan pregătit”;
- „Execuție blocată de izolare” (orice proiect real azi);
- „Autorizat”;
- „În execuție”;
- „Așteaptă decizia ta”;
- „Gata pentru verificare”;
- „Fără context încă”.

Cardurile vin dintr-un catalog sigur (`layout.mjs`) cu referințe validate la datele acestui proiect:
- **ProjectSummary:** terminat cu dovezi, deschis/blocat, ultima sesiune, repository-ul propriu, decizii, ce lipsește;
- **NextStepCard:** recomandarea și alternativele, cu motiv și sursă; fără prioritate comercială inventată;
- **DecisionCard:** planul uman, cu detaliile tehnice extensibile;
- **MissionPlan**;
- **AgentGraph:** etapele cu mediul în care **au rulat**, din dovezi; fără un badge WSL global;
- **EnvironmentCard;**
- **DiffPanel;**
- **TestPanel:** numerele vin din TAP; altfel „nemăsurat”;
- **ReviewPanel;**
- **Replay:** slider, „următoarea eroare”, „Revino la acum”;
- **Preview:** URL-ul din namespace e marcat inaccesibil, intenționat;
- **Briefing;**
- **Explain;**
- **CompanyMap.**

Modelul **nu** scrie React, HTML sau JS. O propunere de layout e validată: tip din catalog, referință la date existente din acest proiect, fără câmpuri în plus, cel mult 8 carduri. Datele le aduce UI-ul din API.

Layout-ul are fixare, ascundere, „Anulează layout” (istoric de 20 de pași) și Focus („doar ce contează”). Textul pe care îl tastezi nu se mută cu cardurile. O schimbare de layout nu aprobă nimic.

## 4. Fața

- **Unde:** `components/face/LegaFace.jsx` + `lib/faceGeometry.js`, WebGL2, fără biblioteci.
- **Particulele:** 2.200 de particule (900 în modul discret). Fiecare particulă are aceeași poziție în index în trei ținte (NUCLEU, FAȚĂ, HARTĂ), deci tranziția e un morph real (sumă ponderată), întreruptibil din poziția curentă (M06-UI-04).
- **Fața:** abstractă, procedurală, cu asimetrie subtilă. ~38% din particule urmăresc trăsăturile (ochi, sprâncene, nas, buze, maxilar, siluetă) și există o plasă de linii (rânduri, meridiane, contururi). **Nu** e chipul tău și nici un avatar de stoc.
- **Harta:** particulele se adună în jurul nodurilor reale ale companiei (departamente, misiuni, execuții, aprobări).
- **Gura și maxilarul:** urmează nivelul audio **redat** de Lega (RMS pe fluxul redat), cu atac și eliberare. Fără sunet sau cu sunetul oprit, gura e închisă. E amplitudine reactivă, **nu** lip-sync fonetic. Ruta GPT-Live prin WebRTC nu oferă viseme.
- **Expresia:** culoarea și energia vin din starea observabilă a Hub-ului (așteaptă aprobarea, execută, eroare…), nu din „gânduri”.
- **Reduced motion:** fără rotație, iar formele se schimbă instant.
- **Fallback:** SVG (fără WebGL sau context pierdut), cu motivul scris în consolă; randarea se oprește când pagina nu e vizibilă.
- **Cost măsurat** (Chromium headless, 1440×900): 0,16–0,17 ms CPU pe cadru, în toate cele trei forme.

## 5. Voce, mobil, accesibilitate

- **Fără microfon:** totul merge și prin text și tastatură.
- **Vocea Lega:** e cea din M02 (GPT-Live). Cuvintele tale transcrise trec prin același resolver, marcate „voice-provider”.
- **Filtrul vocal local** (opțional): vezi `M06_VOICE_TRUST_MODEL.md`.
- **Mobil:** cockpitul pe o coloană; Lega e prima în bara de jos.
- **Ce nu e mobilul:** „responsive” nu înseamnă acces remote. Nu s-au deschis porturi sau tuneluri, iar sesiunea de proprietar e legată de originea `localhost`.
- **Mini-asistent:** rămâne un panou în aplicație. Un always-on-top la nivel de OS nu există și nu e simulat.
- **Accesibilitate:** etichete ARIA pe toate controalele, focus vizibil, `aria-live` pentru conversație, alternativă 2D (listă) pentru hartă.

## 6. Proactiv, dar liniștit

- **Motive:** fiecare element de atenție are motiv (USER_REQUESTED, DECISION_REQUIRED, BLOCKED, RISK, MISSION_COMPLETE).
- **Agregare:** un rând per misiune sau aprobare.
- **Preferințe:** „doar decizii”, ore de liniște (RISK trece oricum), notificări vocale oprite implicit.
- **Briefing:** delta de la ultima vizită per proiect („companie” pentru tot), calculat local, fără inferență.
- **Toast-uri:** o aprobare cerută de propriul tău plan e decisă imediat și nu mai declanșează alarma „Aprobare necesară”.
- **Recomandări** (`/api/owner/recommendations`): din deciziile tale înregistrate (aprobări repetate fără refuz; remedieri confirmate mereu), cu dovezi și schimbarea exactă. Nu se aplică automat.
- **Shadow Mode:** un al doilea review doar-citire pe același change set, stocat separat (`shadow_evaluations`), comparat cu cel principal. Cere un grant, deci nu e inferență gratuită, și nu mișcă misiunea (M06-CK-10).
