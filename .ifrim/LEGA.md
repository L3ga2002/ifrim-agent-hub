# Lega — asistentul vocal al Hub-ului

Stare la 2026-09-30:
- **Implementat și testat simulat** (fixture, fără rețea): 17 teste `M03-LEGA-*`, toate trecute, după revizia adversarială de mai jos.
- **Test live: nerulat.** Îl pornește proprietarul, pentru că doar el poate vorbi în microfon.

Lega folosește **GPT-Live** (vocea ChatGPT) prin **abonamentul ChatGPT**, trecând prin Codex-ul instalat (`codex app-server`, metodele `thread/realtime/*`). Nu folosește cheie API și nici OpenAI Realtime API plătit.

## Ce face

| Cum | Ce | Unde e aplicat |
|---|---|---|
| Vorbă directă (deterministic, doar cuvintele tale finale) | „Lega, oprește tot” → Stop All (se oprește și Lega). „Lega, pauză” → poarta suspendată. „Lega, deschide aprobările / misiunile / camera de control”, „intră în Focus” → navigare. „Taci” → microfon oprit. | `runtime/lega.mjs` `onOwnerWords` → magistrala de comenzi, canalul `voice` |
| Prin agentul din spate (Codex, fără shell și fără fișiere) | Unelte `lega.*`: `hub_status`, `navigate`, `pause`, `stop_all`, `propose_run` | `policy/lega-policy.mjs` `legaDynamicTools` + `lega.mjs` `onToolCall` |
| Muncă reală (cod, teste, analiză) | `propose_run` → card „Lega propune o execuție” → **Aprobă și pornește** (click) → execuția trece prin poarta normală (grant de execuție, lease, backup) → rezultatul e spus cu voce | comanda `lega.propose_run` (ALWAYS_ASK, aprobare legată de hash), `runs.start` |
| Niciodată din voce | Aprobări, deschiderea porții, granturi, facturare, deploy, push, ștergeri, mesaje externe, acordul de izolare | canale în `command-catalog.mjs`, `DECISION_CHANNELS = ui`, catalogul de politici |

Textul din fișiere sau din rezultatele agenților este tratat ca **date**. Comenzi pot declanșa doar cuvintele tale finale, trecute prin parserul determinist.

## Arhitectură

- **Browserul** deține conexiunea WebRTC: microfonul și difuzorul vorbesc direct cu OpenAI. Hub-ul doar transmite oferta și răspunsul SDP. Audio nu trece prin Hub și nu se salvează.
- **Proces Codex separat pentru voce** (`providers/codex-realtime.mjs`):
  - API experimental activat **doar aici**;
  - lista proprie de metode: fără `turn/start`, `thread/resume`, `appendText` sau `appendAudio`;
  - același profil de izolare read-only și același mediu fără chei API ca la rulări;
  - fiecare server MCP din config-ul tău (6 azi) e dezactivat pe nume, iar lista activă e verificată înainte de voce;
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
- Cât consumă exact calea din app-server se verifică în testul live (**NEVERIFICAT**).
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
3. Pentru execuții propuse de Lega mai trebuie un grant „Execuție agent” pe proiectul dorit, de exemplu „Ifrim Hub Test”.

## Ce se verifică în primul test live (NEVERIFICAT până atunci)

1. `thread/start` pornește repede cu noile setări (`project_doc_max_bytes=0`, `environments: []`).
2. Serverul ChatGPT acceptă oferta WebRTC a browserului (Chrome/Edge, fără STUN).
3. Calitatea recunoașterii și a vocii în română.
4. Delegările ajung ca apeluri `lega.*`, iar pe thread-ul Lega nu apar comenzi sau fișiere.
5. După Oprește, audio se oprește (conexiunea e închisă de browser).
6. Consumul apare (sau nu) în limitele raportate de `account/rateLimits`.
7. `-c mcp_servers={}` chiar neutralizează serverele MCP.

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

Teste: `m03-lega.test.mjs` (12) + `m03-lega-hardening.test.mjs` (5), toate trecute. Suita V2: 214 teste, 213 trecute + 1 omis de mediu.

## Primul test live (2026-09-30, proprietarul)

- Ambele încercări au fost oprite de verificarea MCP, înainte de orice apel vocal: serverul `cua_repl` (pluginul Computer Use) era activ. Nu era în `mcp_servers`, ci venea dintr-un plugin.
- **Corectat:**
  - procesul Lega rulează cu `features.plugins=false` și `features.remote_plugin=false`;
  - o pornire care eșuează înainte de apelul vocal returnează încercarea din grant (`grant.refunded`).
- Pre-flight fără model (`node v2/tests/manual/lega-mcp-preflight.mjs`): PASS_LOCAL. Cele 6 servere din config (5 Cloudflare + `node_repl`) sunt dezactivate pe nume, iar niciun server de plugin nu mai e prezent.

## Riscuri cunoscute

- Metodele `thread/realtime/*` sunt **experimentale** și nedocumentate public: o actualizare Codex le poate schimba. Testele de contract rulează pe fixture; la fiecare actualizare Codex trebuie regenerată schema și refăcut testul live.
- Delegarea pornește un turn Codex înainte ca Hub-ul s-o vadă. Turnul nu are însă unelte de execuție, doar `lega.*`, iar tot ce are efecte cere click.
