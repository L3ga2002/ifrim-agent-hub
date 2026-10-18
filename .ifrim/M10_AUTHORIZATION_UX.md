# M10 — Autorizare fără formulare (zero-form)

Scopul este să conduci munca prin intenție: nu administrezi granturi, porți sau moduri, iar securitatea rămâne în cod.

## Patru clase de acțiune, decise după efect

Implementarea e în `v2/server/policy/action-policy.mjs` → `classifyAction(op, ctx)`. Rezultatul e întotdeauna clasa cea mai strictă produsă de oricare regulă.

| Clasă | Exemple | Ce cere |
|---|---|---|
| **LOCAL_DIRECT** | deschide / adu în față o aplicație autorizată, arată un folder aprobat, stare, Stop | Comanda ta autentică în sesiunea de proprietar. Fără confirmare suplimentară. |
| **PLAN_STEP** | tastează, apasă, salvează, importă, montează, randează, captează, exportă | Rulează doar într-un plan confirmat; autoritatea derivată e verificată din nou la fiecare operație. |
| **SENSITIVE** | aplicație sau folder nou, suprascriere, model, captură live fără MB1 | Diferența exactă + decizia ta. În plan intră doar aplicația nouă și folderul nou, ca decizie în același card, cu Windows Hello. Restul rămâne decizie separată. |
| **REFUSED** | publicare, încărcare, mesaje, plăți, ștergeri externe, administrarea Hub-ului (Hello, granturi, setări), aplicații protejate, scripturi / shell arbitrar | Niciodată de operator. |

Regulile nu depind de `channel=voice`, `actor=owner` sau `isTest`: decide efectul.

## Planul de operare: o singură confirmare

Implementarea e în `v2/server/ops/plans.mjs`, cu executorii în `v2/server/ops/executors.mjs`.

1. **Propunere.** Fiecare pas e descris de executorul lui, fără efecte: aplicații, foldere, ce se citește, ce pleacă din calculator, operații, rezultate, model. Fiecare operație e clasificată:
   - `REFUSED` → nu există plan, iar Lega spune de ce;
   - `SENSITIVE` → decizie în card, dar doar pentru aplicație nouă / folder nou.

   Folderele pe care un pas doar le descrie **nu** devin automat aprobate. Un folder nou e o decizie explicită, cu reautentificare. Acesta a fost un defect găsit și reparat în M10.
2. **Cardul** arată:
   - titlul și pașii;
   - aplicațiile, folderele, ce se citește, ce pleacă din calculator („nimic nu pleacă din calculator”), rezultatul și modelul („fără model”);
   - limitele (durată, număr de operații);
   - ce nu se face niciodată (publicare, încărcare, mesaje, plăți, ștergeri externe, setări de securitate);
   - mențiunea „o singură confirmare”.
3. **Confirmarea** se face în sesiunea de proprietar: click, tastă, „Da” scris sau „Da, execută planul” rostit, cu dovada locală (vocea ta verificată și transcrierea locală a segmentului înregistrat pentru acest plan).
   - Transcrierea providerului, TTS-ul Lega, audio-ul unui clip sau textul unui document nu confirmă niciodată.
   - Planul e reconstruit și trebuie să aibă exact hash-ul celui afișat; altfel e `SUPERSEDED` și îți arată diferența.
   - Deciziile din card cer reautentificare proaspătă (Windows Hello, sub 5 minute).
4. **Autoritatea derivată** e stocată cu consimțământul: aplicații, foldere, operații, expirare, buget de operații.
5. **Rularea:** pașii merg în ordine, iar rezultatul unui pas poate fi folosit de următorul (`$pas:1.assetVersionId`). Fiecare operație cere `authorize()`, care verifică:
   - statusul și termenul;
   - că sesiunea în care ai confirmat e încă deschisă;
   - pasul, operația, aplicația și folderul;
   - bugetul.

   Oricare încălcare oprește pașii noi: `NEEDS_OWNER` sau `FAILED` pentru o operație nedeclarată.
6. **Oprire / reluare:**
   - Pauză, Stop, „Preiau eu” și Stop All funcționează din orice canal (fail-safe).
   - „Continuă” cere aceeași sesiune și reconciliază întâi pașii incerți: întreabă aplicația dacă înregistrarea, salvarea sau importul s-a întâmplat. Nu repetă orbește și nu lărgește limitele.
7. **Repornirea Hub-ului** nu reia niciun plan: cele care rulau trec în `NEEDS_OWNER`, cu pasul curent `UNCERTAIN`.

Secrete tranzitorii (de exemplu parola OBS WebSocket): le scrii în card, la confirmare, și rămân în memorie doar cât rulează planul. Nu intră în plan, în hash, în baza de date, în jurnalul comenzilor sau în evenimente (testul M10-OP-11).

## Ce înseamnă „zero formulare” concret

- **„Deschide CapCut”** cu CapCut neautorizat: un card cu o singură decizie („Autorizezi CapCut 9.3.0.3970, semnătură Bytedance, pentru operator”) și o confirmare. După asta, „Deschide CapCut” merge direct (testele M10-DO-03 și M10-UI-E2E-01).
- **„La secunda 12 mută textul mai sus”**: propunerea pe versiunea curentă plus un card. „Da” aplică (versiune nouă, originalul rămâne), randează ciorna și rulează QA. Revizuirea creativă rămâne a ta (M10-ST-09).
- **„Importă din folderul acesta”**: un card cu ce se importă (fișiere cu hash verificat, versiuni, etichete, ce lipsește). Dacă folderul nu e aprobat, cardul conține decizia de acces o dată (M10-ST-08).
- **„Înregistrează demonstrația cu OBS și pregătește varianta verticală, fără să publici”**: un singur plan (înregistrare → oprire → import → montaj → randare → variantă verticală + QA). Fără MB1, Lega spune exact ce lipsește și nu face niciun plan (M10-ST-11).

- **„Pornește Lega”** (M10.1, `2.11.1-m10`): un click sau fraza „Pornește Lega”. În sesiunea ta de proprietar, cu politica voice-first activă, Hub-ul derivă o autorizare pentru o singură sesiune vocală (grant de voce născut epuizat, revocat la final, legat de sesiunea ta, 6 porniri / 15 min). Nu cere mod, LIVE_VALIDATION sau grant de mână. Poarta de execuție, acordul, declarația Codex și celelalte verificări decid în continuare (`M10_LEGA_ZERO_FORM.md`, testele M10-LEGA-ZF-*).

## Ce rămâne o decizie separată (intenționat)

- **MB1 / MEDIA_B:** captura reală (Hub live, ecran prin OBS).
- **MEDIA_C:** conturi, încărcare, publicare; fiecare postare are confirmarea ei.
- Aprobarea creativă a unui clip.
- Un model nou sau un cost; activarea unei politici.
- Acceptarea pilotului ProDelivery, D6 și Demo B.

## Unde se vede

- **Bara permanentă de activitate** (sus, sub bara principală): „Lucrez în CapCut: aduc fereastra în față”, cu butoanele Stop și Preiau eu; Continuă apare când operatorul te așteaptă.
- **Cardul de plan**, în cockpitul Lega (și fără proiect deschis).
- **Pagina „Operator”** (`#/desktop`): aplicațiile cu stările lor separate, autorizare cu Windows Hello, retragere, foldere de import, planuri, ultimele acțiuni.
