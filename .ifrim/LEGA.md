# Lega — asistentul vocal al Hub-ului

## M03 (2026-10-01, Hub `2.4.0-m03`): intrarea vocală în departamentul Engineering

- „Lega, pregătește repararea bugului din proiectul X” → `lega.propose_mission` cu tipul `eng_bugfix`, `eng_feature` sau `eng_refactor`.
- Click-ul tău creează misiunea Software Factory cu specificația v1, ca **ciornă**. O propoziție nu e o specificație aprobabilă: lipsesc testele de acceptanță și comenzile, iar Hub-ul le listează.
- Specificația o completezi și o aprobi tu, în Misiuni.
- `lega.mission_detail` raportează etapa fabricii și pe cine așteaptă misiunea. Lega nu spune că s-a scris, revizuit sau testat cod dacă `mission_detail` nu arată asta.
- **Din voce nu se pot face:** pornirea misiunii, aprobarea scope-ului, acceptarea sau respingerea, reluarea, ciclurile suplimentare, marcarea findings, acceptarea riscului R2.
- **Din voce se poate face:** pauză sau oprire (`factory.pause` / `factory.stop`) și retragerea acceptării R2.
- **How-to nou:** `engineering`, cu săgeată pe butonul „Lucrare de engineering”.
- **Consumul vocii:** `planUsage.status = "UNKNOWN"`. Protocolul nu raportează consumul real; suma afișată e doar o estimare după prețul publicat.
- **Teste:** M03-FI-03 (propunere → click → ciornă; fiecare decizie e refuzată pe canalul voce), M03-GRD-03 (UNKNOWN). Ambele PASS_SIMULATED. Live: NOT_RUN.

Stare la 2026-10-01 (Hub `2.3.0-m03`):
- **Implementat și testat simulat** (fixture, fără rețea): 17 teste `M03-LEGA-*` + 8 teste `M03-ACCESS-*` (acces complet sub control, căutare web) + 2 teste `m03-stage`, toate trecute.
- **Test live: PASS_LIVE** (proprietarul, 2026-09-30, 18:18–19:49 UTC): mai multe sesiuni, română în ambele sensuri, inclusiv versiunea cu acces complet (sesiunea `lega_muoic63s_69b4539e26`, 11,4 min, vocea `sol`, căutare web `cached`). Detalii în „Sesiuni live” mai jos.
- **Încă netestate live:** căutarea web, `propose_mission`, `mission_detail`.
- Comis: `30bfbef` (voce), `dac2db4` (Modul Lega), `ce819b9` (pluginuri oprite, încercare returnată), `bbe8757` (acces complet, căutare web).

Lega folosește **GPT-Live** (vocea ChatGPT) prin **abonamentul ChatGPT**, trecând prin Codex-ul instalat (`codex app-server`, metodele `thread/realtime/*`). Nu folosește cheie API și nici OpenAI Realtime API plătit.

## Ce face

| Cum | Ce | Unde e aplicat |
|---|---|---|
| Vorbă directă (deterministic, doar cuvintele tale finale) | „Lega, oprește tot” → Stop All (se oprește și Lega). „Lega, pauză” → poarta suspendată. „Lega, deschide aprobările / misiunile / camera de control”, „intră în Focus” → navigare. „Taci” → microfon oprit. | `runtime/lega.mjs` `onOwnerWords` → magistrala de comenzi, canalul `voice` |
| Prin agentul din spate (Codex, fără shell și fără fișiere) | Unelte `lega.*` — VEDE: `hub_status`, `company_briefing`, `list_projects`, `project_brief`, `list_missions`, `mission_detail`, `pending_approvals`, `recent_runs`; ARATĂ: `navigate`, `point`, `how_to`; PREGĂTEȘTE: `propose_run`, `propose_mission`, `prepare_grant`; SIGURANȚĂ: `pause`, `stop_all` | `policy/lega-policy.mjs` `legaDynamicTools` + `lega.mjs` `onToolCall` |
| Muncă reală (cod, teste, analiză) | `propose_run` → card „Lega propune o execuție” → **Aprobă și pornește** (click) → execuția trece prin poarta normală (grant de execuție, lease, backup) → rezultatul e spus cu voce | comanda `lega.propose_run` (ALWAYS_ASK, aprobare legată de hash), `runs.start` |
| Niciodată din voce | Aprobări, deschiderea porții, granturi, facturare, deploy, push, ștergeri, mesaje externe, acordul de izolare | canale în `command-catalog.mjs`, `DECISION_CHANNELS = ui`, catalogul de politici |

Textul din fișiere sau din rezultatele agenților este tratat ca **date**. Comenzi pot declanșa doar cuvintele tale finale, trecute prin parserul determinist.

## Acces complet, sub controlul tău (2026-09-30)

Cerința proprietarului: „încă nu are acces complet… va trebui să îi dăm”, apoi „nu are acces la căutare pe internet”. Lega vede acum toată compania și arată unde e fiecare lucru. Tot ce are efecte rămâne la click-ul tău.

| Ce | Cum | Limită |
|---|---|---|
| **Vede** | Briefing zilnic (terminate, blocate, aprobări, misiuni, eșecuri, backup), lista proiectelor, notițele unui proiect, misiuni și sarcini, aprobări în așteptare, ultimele execuții | Doar citire. Notițele proiectului sunt 4 fișiere fixe (`README.md`, `.ifrim/PROJECT_STATE.md`, `NEXT_SESSION.md`, `OPEN_ISSUES.md`), citite prin `resolveInScope`: niciun link sau junction care iese din proiect, niciodată `.ifrim/private`. Maximum 64 KB citiți din fiecare fișier și 5000 de caractere trimise, redactate și prezentate ca informație, nu ca instrucțiuni (`domain/project-notes.mjs`). |
| **Arată** | `point` deschide ecranul potrivit și desenează un contur, o săgeată și eticheta „Lega arată” pe buton sau panou. `how_to` dă pașii exacți dintr-o hartă fixă (`LEGA_HOWTO`). | Ținte doar din `LEGA_TARGETS` (fiecare are `data-lega-target` în UI; un test verifică). Săgeata doar desenează: nu primește click-uri și dispare după 12 s, la Esc sau la următorul click. |
| **Pregătește** | `propose_mission` → card „Lega propune o misiune” → **Aprobă și creează**. Misiunea se creează ca ciornă, fără nicio execuție. `prepare_grant` completează formularul „Grant nou” și arată butonul. `propose_run` rămâne ca înainte. | Misiunea: aprobare `lega.mission_request` (ALWAYS_ASK, legată de hash). Vocea nu poate aproba. Grantul **nu e creat niciodată de Lega**: doar valorile ajung în formular, iar tu apeși „Creează grant”. |
| **Proiecte noi pentru agenți** | Pe pagina proiectului, panoul „Execuții pe acest proiect”: tastezi numele exact și apeși „Permite execuții”. „Retrage execuțiile” e un singur click (merge și din voce) și revocă grant-urile de execuție ale proiectului. | Activarea se face doar din UI (comanda `project.execution.enable`). Proiectul trebuie să fie un folder real în folderul de proiecte, fără link sau junction pe drum și în afara Hub-ului. Hub-ul nu se comută. Fiecare execuție cere în continuare grant, poarta deschisă și backup verificat (scris în `.ifrim/BACKUPS/v2` al proiectului). |
| **Căutare pe internet** | Setarea „Căutare pe internet” din panoul Lega. `cached` (implicit, recomandat) dă rezultate din indexul întreținut de OpenAI, fără să deschidă pagini live. `indexed` face căutare actuală, dar accesul la pagini trece doar prin index. `live` deschide orice pagină și e cu risc mai mare, deci panoul afișează un avertisment. A patra opțiune e `Oprită`. Setarea se aplică la următoarea pornire. | Doar procesul Lega primește `web_search="cached|indexed|live"` (`codexBaseOverrides`). Execuțiile agenților rămân cu `web_search="disabled"`. Agentul Lega nu are fișiere și nici shell, deci căutarea nu atinge nimic local. Fiecare căutare apare în transcriere („Caut pe internet: …”), redactată, și e jurnalizată (`lega.web_search`). Cu setarea oprită, o căutare e o încălcare și oprește sesiunea. Instrucțiunile îi interzic agentului să pună conținut de proiect sau date private în interogări (regulă de prompt, nu de cod). |

## Arhitectură

- **Browserul** deține conexiunea WebRTC: microfonul și difuzorul vorbesc direct cu OpenAI. Hub-ul doar transmite oferta și răspunsul SDP. Audio nu trece prin Hub și nu se salvează.
- **Proces Codex separat pentru voce** (`providers/codex-realtime.mjs`):
  - API experimental activat **doar aici**;
  - lista proprie de metode: fără `turn/start`, `thread/resume`, `appendText` sau `appendAudio`;
  - același profil de izolare read-only și același mediu fără chei API ca la rulări;
  - pluginurile sunt oprite (`features.plugins=false`, `features.remote_plugin=false`), fiecare server MCP din config-ul tău (6 azi) e dezactivat pe nume, iar lista activă e verificată înainte de voce (aceeași regulă se aplică acum oricărui proces Codex al Hub-ului);
  - `-c experimental_realtime_ws_backend_prompt=""` (config-ul nu poate înlocui persona).
- **Thread-ul Lega:**
  - `ephemeral: true`;
  - `environments: []` (fără shell, fișiere sau patch);
  - director de lucru gol în `%TEMP%`;
  - aprobările cerute de model sunt refuzate automat. Dacă apare totuși o comandă, o modificare de fișier sau un apel MCP, sesiunea se oprește și se înregistrează o „violare”.
- **Pornirea vocii:**
  - mereu WebRTC v3 (varianta implicită, websocket, ar cere cheie API);
  - vocea e aleasă din lista v3 (cove implicit);
  - `clientManagedHandoffs: true`.
- **Oprire în ordine:**
  1. browserul închide conexiunea (singurul mod sigur de a opri audio);
  2. `thread/realtime/stop`;
  3. se întrerup turnurile delegate;
  4. se oprește procesul.

  Stop All, retragerea acordului, durata maximă, liniștea prelungită, pierderea fluxului SSE timp de 10 s și închiderea paginii opresc toate sesiunea.

## Modul Lega (ecran complet, „JARVIS”)

Se deschide cu **Alt+J**, cu butonul **Modul Lega** din Control Room sau cu **Ecran complet** din panoul Lega. Se închide cu Esc.

- **Rețeaua vie** e desenată din starea reală a Hub-ului (`lib/stageGraph.js`, testat în `m03-stage.test.mjs`):
  - Lega în centru;
  - departamentele și rolurile lor (cele planificate apar estompate);
  - misiunile (ambră dacă cer atenție);
  - execuțiile active (luminoase);
  - aprobările în așteptare (ambră).

  Particulele ambientale sunt decorative și nu au etichete: nu inventează agenți care lucrează.
- **Reacții:** energia rețelei urmează nivelurile audio reale (microfonul tău și vocea Lega) și starea (execuție, aprobare).
- **Subtitrări:** subtitrări mari cu ce spui tu și ce spune Lega, plus ultimul cuvânt mare, ca în video.
- **Panouri:** în stânga compania; în dreapta deciziile și execuțiile, cu click spre ecranele lor. Jos: pornire/oprire Lega; sus: Stop All.
- **Motion:** reduced motion înseamnă cadre calme, fără rotație. Randarea se oprește când tab-ul e ascuns.

Capturi în `.ifrim/LEGA_EVIDENCE/`.

## Poarta pentru o sesiune (`gate.evaluateVoice`)

O sesiune pornește doar dacă toate verificările trec:
- mod LIVE_VALIDATION;
- poartă deschisă;
- **grant „Lega (voce)”** (Codex, doar citire; încercări = sesiuni; durată = plafonul sesiunii, ≤30 min);
- **acordul Lega** (text exact, versionat);
- ruta de abonament verificată (fără credite, rezerva de 20%);
- config Codex fără redirecționări de voce (`*_base_url`, `realtime.session_type`);
- izolarea Codex (sandbox „ready” + acordul ACL);
- circuit breaker închis;
- o singură sesiune activă;
- concurență (sesiunea Lega contează ca execuție AI).

## Cost

- Documentat pentru vocea din desktop: 0,05 $/minut din bugetul Codex al abonamentului. Panoul afișează estimarea.
- Cât consumă exact calea din app-server nu a fost măsurat nici în sesiunile live din 2026-09-30 (**NEVERIFICAT**).
- Cu soldul de credite 0 (atestat), nu se poate taxa nimic peste abonament.

## Pornire (proprietarul)

1. Integrări → Validare live:
   1. tastează `LIVE_VALIDATION` → Activează;
   2. tastează `OPEN GATE` → Deschide poarta;
   3. Grant nou → Tip „Lega (voce)”, 3 sesiuni, 1200 s → Creează.
2. Butonul **Lega** din bara de sus (sau Alt+L):
   1. înregistrează acordul (textul exact);
   2. alege vocea;
   3. **Pornește Lega** și permite microfonul.
3. Pentru execuții propuse de Lega mai trebuie un grant „Execuție agent” pe proiectul dorit, de exemplu „Ifrim Hub Test”. Un proiect nou trebuie întâi activat pe pagina lui cu „Permite execuții”.
4. O propunere de execuție pornește cu un singur click: **Aprobă și pornește** (pe card sau în ecranul Aprobări). Dacă o aprobare nu a pornit, o găsești în „Aprobate, încă nepornite”, cu butonul „Pornește acum”.

## Ce s-a verificat live (2026-09-30)

Lista de dinainte de primul test, cu rezultatul:

1. `thread/start` pornește cu noile setări (`project_doc_max_bytes=0`, `environments: []`): **PASS_LIVE** (sesiunile au pornit; pentru execuțiile Codex, corecția e confirmată de două execuții PASS_LIVE).
2. Serverul ChatGPT acceptă oferta WebRTC a browserului: **PASS_LIVE**.
3. Calitatea recunoașterii și a vocii în română: **PASS_LIVE** (română în ambele sensuri; verdictul tău: „pare să fie bine pentru început”).
4. Delegările ajung ca apeluri `lega.*`: **PASS_LIVE** (vezi „Sesiuni live”). Lipsa comenzilor și a fișierelor pe thread-ul Lega nu a fost verificată separat în jurnal (NEVERIFICAT; o violare ar fi oprit sesiunea).
5. După Oprește, audio se oprește: NEVERIFICAT separat.
6. Consumul în limitele raportate de `account/rateLimits`: nemăsurat (NEVERIFICAT).
7. `-c mcp_servers={}` neutralizează serverele MCP: **nu** (găsit în revizia adversarială). Înlocuit cu dezactivarea pe nume + pluginuri oprite; verificarea MCP a trecut în sesiunile live.

## Sesiuni live (2026-09-30, proprietarul)

- În sesiunea cu acces complet ai folosit: `hub_status` 6, `how_to` 5, `recent_runs` 5, `propose_run` 4, `point` 3, `navigate` 3, `project_brief` 3, `company_briefing` 2, `pending_approvals` 2, `prepare_grant` 1 (apoi ai creat grantul prin click), `list_missions` 1, `list_projects` 1.
- Nefolosite live: căutarea web, `propose_mission`, `mission_detail`.
- **Bug găsit live – aprobările nu porneau nimic:** la 19:45 și 19:46 ai aprobat două propuneri Lega în ecranul Aprobări și nu a rulat nimic. Aprobarea doar decidea, iar butonul de pornire apărea numai sub filtrul „Aprobate”. **Corectat:**
  - „Aprobă și pornește” într-un singur click pentru comenzile propuse;
  - secțiunea vizibilă „Aprobate, încă nepornite” (și pentru scripturi npm și verificări de browser);
  - un toast dacă pornirea eșuează;
  - Lega îți spune ce e aprobat, dar încă nepornit.
- La instrucțiunea ta „fă tu tot”, Claude a pornit a doua propunere aprobată (cea mai recentă): execuția Codex `run_muojnivb_b113ce0591` (formular de contact pe „Ifrim Hub Test”), PASS_LIVE, `npm test` 4/4. Execuția a apelat de 3 ori serverul MCP `cua_repl/js` (pluginul Computer Use), care rulează în afara sandbox-ului Codex. **Corectat** pentru fiecare proces Codex al Hub-ului (pluginuri oprite, servere dezactivate pe nume, verificare înainte de turn, oprire la un apel MCP). O execuție read-only ulterioară (`run_muomogfu_f3b3dcccd7`) a trecut fără niciun apel MCP.

## Revizie adversarială (2026-09-30)

Au fost 4 dimensiuni (securitate, protocol, client browser, ciclu de viață), cu verificare independentă a fiecărei constatări: 43 de constatări, dintre care **40 confirmate** (2 grave, 10 medii, 27 mici, 1 neutră). Toate au fost corectate. Cele importante:

- **MCP (grav):** `-c mcp_servers={}` nu dezactiva nimic, pentru că Codex combină straturile de config. Acum:
  - fiecare server e dezactivat pe nume (`mcp_servers.<nume>.enabled=false`);
  - `mcpServerStatus/list` trebuie să nu raporteze niciun server activ înainte de voce;
  - un nume neadresabil blochează poarta.
- **Oprire în timpul pornirii:** pornirea e anulabilă (AbortSignal). Procesul e oprit și nu se creează apel audio după Stop. Browserul anulează încercarea (număr de generație) și nu lasă microfonul deschis.
- **Microfon deschis permanent:**
  - un „stop”/„oprește” simplu doar oprește vocea Lega;
  - Stop All din voce cere numele („Lega, oprește tot”) sau forma explicită („oprește tot”);
  - uneltele `stop_all`/`pause` ale agentului acționează doar dacă tu ai spus-o în ultimele 20 s.
- **Rezultate spuse:** rezumatul e redactat și încadrat ca informație, nu instrucțiune.
- **Propuneri:**
  - sarcina e limitată la 1000 de caractere și afișată integral;
  - propunerea e refuzată dacă textul conține ceva ce pare secret;
  - propunerile rămân aprobări (supraviețuiesc sesiunii și reîncărcării);
  - ecranul Aprobări poate executa acțiunea aprobată;
  - poarta e pre-evaluată ca să nu ceară un click inutil.
- **Ciclu de viață:**
  - o singură oprire în curs, pe care o așteaptă toți apelanții;
  - inactivitatea nu oprește sesiunea cât timp agentul lucrează;
  - sesiunea se oprește la BUILD_SAFE și la revocarea grant-ului;
  - Stop All oprește întâi vocea.
- **Robustețe:**
  - peer-ul JSON-RPC închis respinge imediat cererile;
  - scrierile în pipe-uri moarte sunt ignorate, iar supervisorul ascultă erorile de pipe;
  - tipurile de itemi permise pe thread-ul Lega sunt o listă albă, iar activitatea pe alte thread-uri e violare;
  - la violare procesul e oprit imediat;
  - thread-ul trebuie să confirme `environments: []`.
- **Protocol:**
  - forme corecte de refuz pentru aprobări (v2, legacy, permissions);
  - `realtime.type` (cheia reală);
  - `experimental_realtime_start_instructions` blochează poarta;
  - `agents.enabled=false`.
- **Confidențialitate:**
  - răspunsul SDP nu se mai salvează în jurnalul de comenzi;
  - transcrierile parțiale se publică redactate și cumulate;
  - erorile se redactează.
- **Execuții normale:** `AGENTS.md` din proiect intră din nou în context, citit de Hub (limitat, redactat), pentru că `project_doc_max_bytes=0` îl scotea.

Teste: `m03-lega.test.mjs` (12) + `m03-lega-hardening.test.mjs` (5), toate trecute. Suita V2 la momentul reviziei: 214 teste, 213 trecute + 1 omis de mediu. Acum (2026-10-01): 249 de teste, 248 PASS, 0 FAIL, 1 SKIPPED_ENV.

## Primul test live (2026-09-30, proprietarul)

- Ambele încercări au fost oprite de verificarea MCP, înainte de orice apel vocal: serverul `cua_repl` (pluginul Computer Use) era activ. Nu era în `mcp_servers`, ci venea dintr-un plugin.
- **Corectat:**
  - procesul Lega rulează cu `features.plugins=false` și `features.remote_plugin=false`;
  - o pornire care eșuează înainte de apelul vocal returnează încercarea din grant (`grant.refunded`).
- Pre-flight fără model (`node v2/tests/manual/lega-mcp-preflight.mjs`): PASS_LOCAL. Cele 6 servere din config (5 Cloudflare + `node_repl`) sunt dezactivate pe nume, iar niciun server de plugin nu mai e prezent.

## Riscuri cunoscute

- Căutarea web aduce text de pe internet în contextul agentului Lega, iar o pagină poate încerca să-i dea instrucțiuni. Efectele posibile rămân cele de mai sus: propuneri pe care le aprobi tu, săgeți și ecrane. Nimic nu se execută fără click.
- În modul `live` rămâne o cale de scurgere: agentul citește notițele proiectelor și poate deschide orice adresă. O instrucțiune ascunsă l-ar putea face să pună text din Hub într-o adresă web. Secretele sunt redactate, dar textul obișnuit nu. Hub-ul vede căutarea abia după ce s-a făcut. De aceea implicit e `cached`, care nu deschide pagini live (documentația Codex: „returns pre-indexed results instead of fetching live pages”).

## Revizia accesului complet (2026-09-30)

Două revizii independente (securitate, apoi corectitudine și UI) nu au găsit nicio cale de a ocoli click-ul proprietarului. Constatările corectate, toate cu teste (`M03-ACCESS-06..08`):
- Căutarea web era `live` implicit: acum e `cached`, iar `live` e opțiune explicită, cu avertisment.
- Unele texte ale companiei ajungeau la model neredactate: motive de blocare, titluri, stack, motivul porții. Acum tot textul trimis modelului trece prin `redactText` și nu mai conține caractere de control.
- Un proiect activat rămânea activat dacă PROJECTS.md îi schimba calea. Acum sincronizarea retrage execuțiile, iar poarta verifică din nou folderul (folder real, fără link sau junction, în afara Hub-ului) la fiecare execuție.
- `how_to` răspundea la o cheie de prototip (`__proto__`): acum folosește `Object.hasOwn`.
- Argumentele uneltelor nu aveau limită pe server: acum sunt limitate la 1500 de caractere și 20 de elemente într-o listă. Numele de proiect din instrucțiuni sunt curățate.
- Cererile de la Lega nu aveau limită: acum sunt cel mult 5 propuneri Lega în așteptare.
- Briefing-ul număra și aprobările expirate: acum le exclude.
- Retragerea execuțiilor vedea doar ultimele 50 de grant-uri: acum revocă toate grant-urile active ale proiectului.
- Săgeata putea marca o clipă elementul de pe ecranul vechi: acum prima căutare așteaptă 150 ms.
- Metodele `thread/realtime/*` sunt **experimentale** și nedocumentate public: o actualizare Codex le poate schimba. Testele de contract rulează pe fixture; la fiecare actualizare Codex trebuie regenerată schema și refăcut testul live.
- Delegarea pornește un turn Codex înainte ca Hub-ul s-o vadă. Turnul nu are însă unelte de execuție, doar `lega.*`, iar tot ce are efecte cere click.
