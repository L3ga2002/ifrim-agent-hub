# Proba ghidată M10.2 (A–G): fișa de autorizare

Stare: **aprobată de proprietar pe 2026-10-05 (~16:30 UTC)**, cu mesajul „ok continua ai toate aprobaRILE MELE”, dat ca răspuns la această fișă. O tratez ca aprobarea fișei cu toate opțiunile ei și nimic mai larg. Până la terminarea corecturilor P0 nu s-a pornit niciun model, nicio sesiune Lega și nicio operație live.
Codul probei: `2.12.1-m10.2` (închiderea P0), contract API 12, schema 11 (fără migrare). Hub-ul live rulează încă `2.12.0-m10.2`.

## 1. Ce aprobi

O singură formulă acoperă tot ce e mai jos, în limitele scrise aici:

> **„Aprob proba M10.2 după fișa 2.12.1”**

Opțiunile se adaugă la aceeași frază, de exemplu: „…, cu commit local, cu filtrul vocal, căutare cached”.

| Cod | Ce face | Inclus implicit |
|---|---|---|
| U | Upgrade-ul Hub-ului live la `2.12.1-m10.2` | da (proba cere codul nou) |
| P | Proiectul de test „Factory Demo M10.2” | da |
| L | O sesiune Lega, cel mult 20 de minute | da |
| E | Un singur plan Engineering pe proiectul de test | da |
| S | Importul proiectului video M09 în Studio și o editare locală | da |
| C | Commit local M10.2 + P0 (fără push) | aprobat; îl fac eu după regresia completă |
| V | Activarea filtrului vocal | aprobat; o faci tu, în sesiunea ta (nu o pot face în locul tău) |
| W | Căutarea Lega trece pe `cached` pentru probă | setarea ta: nu o schimb eu. O schimbi tu din setările Lega, dacă vrei |

Fără V, „Da, execută planul” și „Continuă” se dau prin click, Enter sau text. Atunci rămâne NOT_RUN doar „Continuă” rostit de la pasul F1; pauza rostită către Lega merge și fără V și rămâne pauza ta.

## 2. Pregătirea (numărată separat, înainte de marcaj)

1. **C.** Un singur commit local pe `v2-milestone-01`, fără push: M10.2 împreună cu închiderea P0 (`2.12.1-m10.2`). Corecturile P0 sunt în aceleași fișiere ca M10.2, care era necomis, deci cele două nu se mai pot despărți cinstit în două commituri.

   Așa proba rulează pe o versiune identificată, iar M11 poate continua fără să o atingă. Push-ul îl faci tu: `git push origin v2-milestone-01`.
2. **U. Upgrade-ul:**
   - întâi `node v2/scripts/upgrade.mjs --plan` (doar citire);
   - apoi `--apply`, care oprește Hub-ul, reconstruiește UI-ul pentru contractul 12, pornește Hub-ul și verifică versiunea (`2.12.1-m10.2`) și contractul (12). BUILD_SAFE și starea porții le confirm eu prin citire, cu `node v2/scripts/status.mjs`.

   Nu există migrare, deci nici backup automat. Un tab deschis dinainte arată „Interfață veche”: îl reîncarci. Rollback: codul `2.12.0` nu mai există separat pe disc. Revenirea se face prin corectură înainte, sau cu fanionul M10.2 `envelopeScopedLive=false`. Cu C nu apare un commit separat pentru `2.12.0`: C conține M10.2 și P0 împreună, deci la el se poate reveni doar ca stare `2.12.1`.
3. **P. Proiectul de test:**
   - `node v2/scripts/create-factory-fixture.mjs bug-demo --dir ifrim-factory-demo-m10-2 --name "Factory Demo M10.2" --no-register`;
   - creează `C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\ifrim-factory-demo-m10-2`, face `git init` și un commit în acel folder;
   - înregistrarea în Hub (proiect de test, ruta Windows) o fac pe canalul `agent`, cu referința acestei aprobări, ca să apară în jurnal ca acțiune a agentului, nu ca un click al tău.
4. **V, dacă e ales.** O interacțiune în sesiunea ta: Lega → Configurare → Voce → pornește filtrul (profilul tău există). Apoi rostești o mostră de verificare.
5. **W, dacă e ales.** Setarea căutării Lega devine `cached`. Altfel rămâne `live`, iar la pornire confirmi o dată căutarea live (garda serverului).
6. **Conturile.** Dacă proba începe după 18:29 UTC (2026-10-05) și nimeni nu le-a refăcut între timp, verificările de cont au peste 24 h. Din 2.12.1 nu mai apeși nimic pentru ele:
   - **Codex:** pornirea Lega din sesiunea ta (pasul A) reface singură verificarea învechită, o dată per pornire. E aceeași verificare fără inferență ca „Verifică contul” (D23).
   - **Claude:** când ceri planul (pasul D), pregătirea automată reface verificările de cont mai vechi de 24 h (`provider.probe`, fără inferență, pe ruta Windows), înainte să-ți arate cardul. Rulează doar dacă pașii automați sunt singurul lucru care mai blochează planul.
   - **Ce nu e automat:** declarația ta de facturare. Dacă lipsește sau a expirat, rămâne decizia ta, în Integrări.
   - Dacă o verificare eșuează, e arătată cinstit. Atunci „Verifică contul” rămâne calea manuală și o notez ca abatere de la traseul normal.
7. **Notepad** trebuie închis, ca pasul B să dovedească o fereastră nouă.
8. **Marcajul**, făcut de mine, doar citire:
   - `node v2/scripts/probe-m10-2.mjs --mark` dă `S0`;
   - imediat după, `--since S0 --until S0`, ca bază pentru deriva setărilor.

## 3. Bugetul și limitele (fixe, afișate și legate în plan)

**Lega (L)**
- O sesiune, de cel mult `min(30 min, 20 min setați, timpul rămas al sesiunii tale − 20 s)`. Se oprește singură după 120 s de inactivitate.
- O repornire după o oprire pentru inactivitate e acoperită doar dacă totalul vocal rămâne ≤ 20 min și sunt cel mult 3 porniri.
- Vocea ta merge la OpenAI (GPT realtime), din bugetul Codex al abonamentului; estimarea e de ~1 USD la 20 min, iar consumul real nu e raportat.

**Planul Engineering (E)**
- **Modelele:**
  - writer: Codex `gpt-6.1-sol` · `medium`, scriere doar în proiectul de test, în sandbox Windows (profil `ifrim_hub_rw`, rețea oprită);
  - reviewer: Claude `sonnet` · `medium`, doar citire.

  Modelele sunt legate în plan, niciodată cele implicite ale contului.
- **Limitele per execuție și per încercare:**

  | Limită | Valoare |
  |---|---|
  | Cicluri de remediere incluse | 2 |
  | Încercări pe etapă (contează doar cele ajunse la model) | 2 |
  | Ture de model per rol (granturi derivate 5 + 1) | ≤ 6, deci ≤ 12 în total |
  | Termenul misiunii | 120 min de la start |
  | Autoritatea planului | 150 min de la confirmare |
  | Confirmarea | în 15 min de la propunere |
  | Timeout per tură | **niciunul**; limita efectivă e termenul de 120 min sau Stop. Marcajul „stale” apare după 10 min fără evenimente de la provider |
  | Codex `initialize` / `thread/start` | 30 s / 120 s |
  | Verificările runner-ului (`node --test`) | 180 s pe comandă |
  | Concurență | o misiune activă; `maxConcurrentAiRuns` 2 (Lega numără 1) |
  | Încercări întrerupte iertate | ≤ 3 |
- **Estimare:** drumul curat înseamnă 2 ture (1 Codex + 1 Claude); cu o remediere, 4.
- **Neacoperit (decizie separată):** un ciclu sau o încercare în plus (delta), alt proiect, alte modele.
- **Interzis:**
  - commit, push sau deploy, acceptarea pachetului, publicarea;
  - orice modificare în ProDelivery, în repo-ul Hub-ului sau în V1;
  - mesaje externe, bani, instalări.

**Studio (S)**
- Importul copiei proiectului M09 (originalele rămân neatinse).
- O editare: versiune nouă, randare locală draft cu ffmpeg (fixat), QA.
- Nimic publicat; aprobarea creativă rămâne a ta.

## 4. Pașii A–G (îi faci tu; eu doar citesc contoarele)

**A. Pornești Lega dintr-un click.**
- Fără formular și fără grant: Hub-ul derivă autoritatea vocală din sesiunea ta.
- Dacă verificarea contului Codex e învechită, Hub-ul o reface singur la pornire (D23). Previzualizarea o arată ca „verific singur la pornire”.
- Dovezi: `lega.authority_derived`, `lega.session.connected`.

**B. „Deschide Notepad”.**
- Hub-ul lansează Notepad și așteaptă fereastra nouă (20 s), apoi o aduce în față.
- Dovadă: rândurile `desktop_actions` (`waitWindow` cu `hwnd`, `focus` cu `foreground=true`). Dacă Windows refuză aducerea în față, se spune cinstit.

**C. „Hai să lucrăm la Factory Demo M10.2”.**
- Se deschide cockpitul proiectului; nu pornește niciun writer.
- Numele cu punct e recunoscut din 2.12.1.

**D. „Repară testul de acceptanță din Factory Demo M10.2”.**
- Apare cardul planului, fără întrebare: singurul test de acceptanță al proiectului e ales și protejat. Writer-ul repară implementarea (numele format doar din spații trebuie refuzat), nu testul.
- Cardul nu mai promite preview sau E2E, fiindcă spec-ul nu le are.
- Spui „Da, execută planul” (cu V) sau confirmi prin click, Enter ori text.

**E. Hub-ul lucrează singur, în BUILD_SAFE, cu drepturi derivate.**
- Etapele: baseline (testul pică din motivul așteptat) → writer → `node --test` → review → remedieri incluse → QA (hash-ul testului protejat verificat) → pachet DELIVERY_READY.
- Acceptarea pachetului rămâne decizia ta, separată.

**F1. Pauză și Continuă, cu vocea, cât timp misiunea rulează (pauza merge și fără V; „Continuă” rostit cere V).**
- „Lega, pune totul pe pauză” devine pauza ta, cu autentificatorul înregistrat.
- „Lega, continuă” e verificat local (filtru + whisper) și reia exact ca textul scris. Fraza contează o singură dată.
- Transcrierea providerului nu reia nimic; poate doar opri reluarea. Un „Continuă?” spus ca întrebare nu reia.

**F2. „Oprește tot” și rearmarea, după DELIVERY_READY.**
- De ce după: Stop All anulează o misiune activă.
- „Oprește tot” închide Lega și suspendă poarta. Închide și cardurile de plan care încă așteptau confirmarea.
- Scrii „Redeschide poarta” (sau orice cerere nouă), ori apeși „Arată cardul de redeschidere” din bannerul cockpitului. **Primul click doar arată cardul**: ce s-a oprit, ce rămâne oprit, eventualele evenimente de securitate. Nu confirmă nimic.
- **Decizia e butonul cardului**, „Redeschide poarta (Windows Hello)”, sau Enter cu cardul selectat. Apoi Windows Hello, dacă ultima ta verificare e mai veche de 5 minute (cazul obișnuit aici). Cu evenimente de securitate pe card, bifezi întâi „Am verificat cauza”.
- Rezultatul: poarta se redeschide, modul rămâne BUILD_SAFE, nimic vechi nu repornește. Lega nu repornește singură.
- **Ce înseamnă D22 pentru un plan pe pauză.** Dacă la „Oprește tot” rula un plan de operare sau o sesiune desktop, Stop All le pune pe pauză. „Continuă” pentru ele (scris, rostit, butonul de pe cardul planului, reluarea desktopului) e refuzat până la rearmare și îți arată același card („Întâi redeschiderea porții”). După rearmare nu pornesc singure: spui „Continuă”. Ce era pe pauză din alt motiv se reia ca înainte. La F2, făcut după DELIVERY_READY și înaintea pasului G, nu ar trebui să existe niciun astfel de plan.

**G. Studio (text sau voce).**
- „Importă proiectul din folderul C:\Users\mihai\Videos\Ifrim Studio\M09 - Un plan, o confirmare”: un card, apoi confirmarea.
- „Arată-mi clipul”.
- „La secunda 12 mută textul mai sus”: un card, apoi confirmarea; rezultă o versiune nouă, randare locală și QA.

## 5. Ce măsor (`node v2/scripts/probe-m10-2.mjs --since S0 --json`)

| Contor | Așteptat pe traseul normal |
|---|---|
| Formulare de grant / granturi manuale | 0 / 0 |
| Schimbări manuale de mod / OPEN GATE | 0 |
| Navigări la Aprobări | 0 |
| Indicații Lega spre fluxul vechi | 0 |
| Intervenții de dezvoltator (agent, cli, test, drift) | 0 |
| Confirmări de scope | 3 (planul E, importul, editarea) |
| Clarificări | 0 (+1 dacă la G sunt două texte plauzibile la 12 s) |
| Redeschideri ale porții din cockpit (Windows Hello), `gateRearms` | 1 (F2). Nu se numără ca schimbare manuală de mod |
| Autentificări suplimentare | 1 (Windows Hello la rearmare, dacă ultima verificare e mai veche de 5 minute), plus una pentru fiecare redeschidere a sesiunii după 30 min de inactivitate |
| Pași automați de pregătire | 0, sau pașii fără model rulați singur de Hub la cererea planului, de exemplu o verificare de cont refăcută (nu sunt intervenții ale tale) |

În afișarea scriptului, rearmarea apare ca „Redeschideri ale porții din cockpit (Windows Hello)”.

Separat raportez:
- timpii fiecărei etape, versiunea servită și etichetele (PASS_LIVE / FAIL / BLOCKED / NOT_RUN);
- orice intervenție făcută de mine în locul tău (țintă: niciuna).

**P0 e închis** doar dacă traseul normal are:
- zero formulare de grant;
- zero schimbări manuale de mod;
- o confirmare pentru planul E;
- niciun subpas administrativ neanunțat.

## 6. Ce nu acoperă fișa

- M11 (are aprobarea lui);
- acceptarea pachetelor istorice (ProDelivery, D6, Demo B);
- a doua sesiune Lega peste 20 de minute;
- atestarea WSL (proba rulează pe ruta Windows; re-atestarea pe aceeași amprentă e o operație separată, fără model);
- publicarea, MB1, MEDIA_B și MEDIA_C.
