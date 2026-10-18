# M09 · Corecturile de bază (fluxul A)

Data: 2026-10-04. Cod `2.10.0-m09`, contract API 9, migrația 9 `m09-media-growth`. **Necomis** pe `v2-milestone-01` peste `ae3aa48`.

Acest document acoperă ce cerea promptul M09 în §03–§05 și ce cerea §38 sub numele MODEL_BINDING și SKILL_RUNTIME (adaptat: un singur document pentru cele patru corecturi). Contractul tehnic complet e în `M09_ARCHITECTURE.md` §3–§4.

Pe scurt:

| Corectură | Ce era greșit în M08 | Ce e acum | Dovadă |
|---|---|---|---|
| A1 · modelul prezentat = modelul autorizat = modelul trimis | `preparePilot` promitea `sonnet`, dar `factory.prepare` nu primea modelele, iar reviewerul folosea implicitul contului (`claude-opus-5-5`) | O legătură explicită (binding) model + efort pentru fiecare rol, de la propunere până la dispatch, verificată din nou înainte de orice proces și la raportul providerului | `m09-model-binding` 15/15, plus RF-04/RF-05 |
| A2 · facturarea Claude nu se mai deduce din login | O declarație veche „extra usage oprit”, fără cont, fără expirare | Dovezi cu sursă, cont (pseudonim cu sare), dată, expirare 30 de zile. Declarațiile vechi Claude devin `reverify_required`. Inferența Claude e blocată până la o declarație nouă din sesiunea ta de proprietar | `m09-billing-evidence` 12/12, plus RF-01 |
| A3 · skill-urile ajung efectiv în prompt | Versionarea exista, dar corpul skill-ului nu intra în prompt | Un composer alege procedurile aprobate, le fixează versiunea și hash-ul, le pune în prompt și înregistrează ce a trimis | `m09-skill-composer` 12/12 |
| Audio · traseul whisper | whisper-server fără autentificare | Restrângeri verificabile (bind fix pe 127.0.0.1, verificarea proceselor care ascultă pe port, răspuns limitat). Transcrierea media e separată de vocea de comandă | `m09-media-transcribe` 15/15 |

## 1. A1 · legătura model + efort (binding)

**Modulul nou:** `v2/server/policy/model-binding.mjs`.

**Ce se fixează:** pentru fiecare rol (writer pe Codex, reviewer pe Claude) Hub-ul păstrează:
- modelul cerut și aliasul rezolvat;
- efortul cerut și efortul efectiv, cu sursa lui;
- mediul în care rulează;
- dovada rezolvării:
  - Codex: hash-ul listei `model/list`;
  - Claude: versiunea CLI, familia sau id-ul datat.

Hash-ul legăturii (`bindingHash`) exclude marcajele de timp ale dovezii.

**Unde circulă:**

1. **Propunere.** Pachetele, Autopilot, War Room, Sales, Lega și `factory.prepare` manual cer modele explicite. O misiune fără ambele modele e o ciornă (`PLAN_INCOMPLETE`): nu are scope, aprobare sau plic.
2. **Plan și plic.** `buildBody` arată modelele exacte și nu folosește înlocuitori. Granturile derivate dintr-un plic poartă legătura (`binding_json`).
3. **Dispatch.** Modelul și efortul vin din `factory_missions.bindings_json`, fixate la aprobare, niciodată din limitele curente.
4. **Înainte de orice proces.** `runs.start` rezolvă din nou legătura pe aceeași rută și o compară (`compareAtDispatch`). Orice schimbare materială refuză pornirea **înainte de inferență**: nu se ia o încercare din grant și nu contează ca încercare a fabricii. Schimbări materiale:
   - alt model sau alt efort;
   - modelul a dispărut din listă;
   - s-a schimbat versiunea Claude Code;
   - s-a schimbat ruta.
5. **La raportul providerului.** Claude raportează modelul la `system/init`. Dacă e în afara familiei legate, rularea se oprește înainte de model și e înregistrată ca `verified=false`.

**Fără fallback tăcut:**
- o rulare manuală Codex fără model fixează acum implicitul contului ca cerere explicită și îl verifică la `thread/start`;
- o rulare manuală Claude fără model e refuzată.

**Corecturi după review-ul adversarial (2026-10-04):**
- **R35:** marcajul `probedAt` era în hash-ul scope-ului. O reverificare a providerului fără nicio schimbare invalida aprobarea. Acum scope-ul (și deci aprobarea și plicul) poartă legătura fără marcaje de timp. Test: RF-04.
- **R37:** un grant derivat dintr-un plic era legat doar de hash-ul modelului, deci o altă misiune din același proiect, cu același model, l-ar fi putut consuma. Acum grantul poartă și misiunea, iar gate-ul o compară. Test: RF-05.

## 2. A2 · dovada de facturare Claude

**Modulul nou:** `v2/server/policy/billing-evidence.mjs` (pur). Verificarea `provider_side_overage_setting` din `billing.mjs` citește acum starea dovezii. Nu s-a slăbit nicio condiție de blocare existentă.

**Starea dovezii:** `valid`, `reverify_required` sau `missing`, cu motive:
- `expired`, `account_changed`, `identity_unavailable`;
- `text_version_changed`, `latched`, `legacy_unbound`;
- `owner_withdrawn`, `provider_report_overage`.

**Declarația** (`billing.declare`) se face doar din sesiunea ta de proprietar, cu re-autentificare proaspătă (Windows Hello). Condiții:
- textul exact;
- contul afișat trebuie să fie contul verificat de o probă de cel mult 24 h.

Declarația expiră după 30 de zile. **Retragerea** (`billing.withdraw`) e fail-safe și merge de pe orice canal al tău, inclusiv vocea.

**Identitatea contului:** un pseudonim `sha256-salted:v1` (16 hex) cu o sare aleatoare locală. Emailul nu e salvat și nu e logat nicăieri. `settings.update` nu mai întoarce sarea (review R27, test RF-06).

**La pornirea pe M09:** declarațiile vechi Claude devin `reverify_required` (`legacy_unbound`), deci **inferența Claude e blocată până declari din nou**. Codex rămâne valid până la expirare, pentru că Hub-ul îi verifică automat creditele.

**`rate_limit_event` (Claude):** e înregistrat ca raport al providerului. Doar semnalele de depășire cunoscute blochează (latch). Un câmp necunoscut nu confirmă nimic.

**Ce NU face Hub-ul:** nu inventează un contor de credite Claude și nu citește fișiere de autentificare sau endpointuri private.

**Corectură după review (R26):** dovada putea fi retrasă cât timp rularea aștepta backup-ul și starea git. Acum ruta de facturare se verifică încă o dată chiar înainte de prompt: rularea e refuzată, încercarea se returnează și nu pleacă nimic spre provider. Test: RF-01.

## 3. A3 · composerul de skill-uri

**Modulul nou:** `v2/server/domain/skill-composer.mjs`.

**Selecția** se face doar din rândurile Hub-ului: rol, tip de task, tip de lucru, client. Metadatele `hub-task-types` și `hub-clients` sunt opt-in: un skill fără ele nu intră. Un skill e aprobat doar dacă:
- era urmărit de git și curat la import (`core.fsmonitor=false`); sau
- e un candidat aprobat de tine.

Altfel motivul înregistrat e `unapproved`.

**Bugetul:**
- cel mult 2 proceduri pe rulare;
- 4000 de caractere fiecare și 6000 în total;
- o procedură nu se taie niciodată: dacă nu încape, e sărită cu motivul `budget`.

**Secțiunea din prompt** stă după handoff și înainte de AGENTS.md. Spune explicit că un skill nu acordă tooluri, acces, rețea sau buget. Corpul e reverificat la compunere contra tiparelor riscante și a secretelor.

**Înregistrarea:**
- `agent_runs.prompt_sha256`, `prompt_chars`, `skill_context_json`;
- rânduri `run_skill_usage` (ce s-a aplicat și ce nu, cu motivul).

Versiunea înregistrată e versiunea trimisă.

**Skill-urile media noi** (`v2/skills/creative-director|scriptwriter|video-editor|media-qa|distribution-planner|growth-analyst`) devin „aprobate” abia după ce le comiți. Până atunci composerul raportează `unapproved`, intenționat.

**Corecturi după review:**
- **R30:** liga agenților acorda credit skill-urilor listate pe rulările dinainte de M09, deși acolo nu fuseseră injectate. Acum doar rândurile `run_skill_usage` contează, iar rulările vechi apar ca „fără dovadă de utilizare”. Test: LG-06.
- **R31:** monitorul unui candidat număra ca eșecuri oprirea făcută de tine și refuzurile dinainte de model. Acum contează doar rulările încheiate sau eșuate la model. Test: SK-07.

## 4. Audio · whisper și transcrierea media

**Ce poate face whisper-server (whisper.cpp 1.9.4):** nu are autentificare, TLS sau pipe. Răspunde cu `Access-Control-Allow-Origin: *`.

**Ce face acum workerul** (`v2/server/owner/voice-worker-lib.mjs`):
- leagă serverul doar de `127.0.0.1` (o constantă, nu o setare), cu folder `--public` gol și fără `--convert`;
- verifică că **fiecare** proces care ascultă pe port e serverul pornit de el, la pornire și înaintea fiecărei transcrieri, inclusiv la confirmări. Pe Windows, un `netstat` ilizibil înseamnă refuz;
- citește cel mult 256 KiB dintr-un răspuns;
- doar raportează reîncărcări suspecte de model;
- oprește serverul după 5 minute de inactivitate.

**Ce rămâne deschis:**
- calea `--inference-path` aleatoare e implementată, dar **oprită implicit**. Nu a fost verificată pe binarul real: ar cere pornirea whisper-server, deci aprobarea ta;
- un alt proces local poate încă apela portul în fereastra în care serverul rulează. Restrângerea e verificabilă, nu o autentificare.

**Transcrierea media** (`v2/server/media/transcribe.mjs`):
- whisper-cli rulează pe fiecare fișier, cu argumente fixe;
- audio-ul e extras cu ffmpeg (`-protocol_whitelist file,pipe`) și integritatea binarelor e verificată din nou chiar înainte de pornire;
- o singură lucrare rulează odată, cu GPU partajat cu vocea;
- nu scrie niciodată `voice_utterances` și nu emite `voice.*`. Proveniența e `media-local`, deci un „da, execută” dintr-un clip nu poate porni nimic;
- anularea oprește și extragerea ffmpeg (review R2/R14).

`voiceGate.enabled=false` și `VOICE_UX_VERIFIED=NU` rămân neschimbate. M09 nu pornește microfonul și nu activează filtrul.
