# M06-A · Pregătirea pipeline-ului: preview, E2E și review izolate

Data: 2026-10-02. Cod:
- `v2/server/environments/wsl-factory-runner.mjs` (`localOnlyArgs`, `startPreview`, `e2eReadiness`);
- `scripts/preview-host.mjs`, `scripts/canary.sh` (C18), `canary.mjs` (C18 opțional), `wsl-runner.mjs` (acoperirea `preview-local-only`);
- `scripts/inspect.sh` (`pw_chromium`, `claude_cli`);
- `factory/routed-runner.mjs` (rutarea preview-ului și a E2E, harta etapelor), `factory/factory.mjs` (E2E în mediu).

## 1. Ce am măsurat (fără instalări, fără model)

| Măsurătoare | Rezultat | Status |
|---|---|---|
| Inventar `ifrim-runner` (doar citire) | Ubuntu 24.04.5, kernel 6.6.114.1-microsoft-standard-WSL2, Node v24.21.0, codex-cli 0.159.2, **bwrap 0.9.0 instalat**, `unshare` prezent; **lipsesc** Chromium, Claude, slirp4netns/pasta; 12 CPU, 15,8 GB RAM | PASS_LOCAL |
| bwrap neprivilegiat, ca `runner` | pornește; `--unshare-all` (user/pid/ipc/uts/cgroup/**net**) | PASS_LOCAL |
| Profilul doar-local, proba manuală | loopback: un server pe 127.0.0.1 răspunde din același namespace; internet `ENETUNREACH`; DNS `EAI_AGAIN`; API-ul Hub de pe Windows `ENETUNREACH`; `~/.codex`, `/mnt/c` `ENOENT`; `/usr` `EROFS`; copia proiectului scriere OK | PASS_LOCAL |
| **Canary C18a–C18i**, secțiunea exactă din `canary.sh` | 9/9 PASS (loopback, internet, DNS, gazda Windows, `~/.codex`, `/mnt/c`, alte workspace-uri, `/usr` doar-citire, copia scriere) | **PASS_LOCAL** |
| Calea reală de preview: `preview-host.mjs` + `localOnlyArgs()` exacte + un server de probă | izolarea măsurată din namespace `ok: true`; `ready` HTTP 200 „Probe M06” în 84 ms după pornire (~1,1 s total); după oprire `leftover=0` procese | **PASS_LOCAL** |

## 2. Decizia: profilul doar-local prin bwrap, nu „rețea în sandbox-ul Codex”

- **Sandbox-ul Codex** (`codex sandbox -P ifrim_runner_rw`, rețea oprită) refuză orice socket, deci un preview nu poate asculta (EPERM, M05).
- **A relaxa profilul Codex cu rețea** ar deschide rețeaua generală. Specificația interzice asta.
- **bwrap** creează un namespace de rețea propriu, cu **doar loopback**: serverul ascultă, iar browserul și sonda din același namespace îl pot accesa, dar nimic din afară. E exact „rețeaua către preview, delimitată”, fără interop, fără montări Windows, fără root, fără `--share-net`.

Alegerea vine din comportamentul măsurat de mai sus, nu din eticheta tehnologiei. Codex rămâne sandbox-ul writer-ului, al verificărilor și al QA (C7–C13). bwrap e folosit **doar** pentru preview.

**Argumentele exacte** (`localOnlyArgs`, o intrare argv per element, fără shell): `--unshare-all --die-with-parent --new-session --clearenv`; `--ro-bind /usr /usr` + symlink-uri; `--proc /proc --dev /dev --tmpfs /tmp --tmpfs /home`; `--bind <copie>/repo /work --ro-bind <ws>/host /hub --chdir /work`; variabile explicite (PATH, HOME=/tmp, IFRIM_RUN=<marcaj> pentru curățare). Testul static M06-PL-01 verifică că aceleași flag-uri sunt în C18; mutantul MU-13 (`--share-net`) e prins.

## 3. Ce face Hub-ul acum

- **Preview:**
  - Un proiect pe ruta `wsl-runner`, cu **C18 în atestare**, pornește preview-ul în mediu: copie nouă, gazda scrisă de un script versionat, bwrap.
  - Sonda din namespace dă dovada (status HTTP, titlu); izolarea e măsurată la fiecare pornire, iar dacă diferă de profil rezultatul e BLOCKED.
  - Stop curăță procesele workspace-ului (marcajul `IFRIM_RUN`) și șterge workspace-ul.
  - Fără C18, rămâne comportamentul M05 (preview pe Windows), declarat explicit în harta etapelor.
- **E2E:** cât timp preview-ul e în mediu, E2E-ul trebuie să ruleze **în același namespace**; browserul Windows nu îl poate atinge, intenționat. Fără Chromium Linux, rezultatul e **BLOCKED** („infrastructura browserului, nu codul”): nu e finding și nu pornește remedieri (M06-PL-05). Nu trece niciodată pe browserul Windows.
- **Review:** rămâne Claude pe Windows, graniță de unealtă (Read/Glob/Grep, dontAsk). Mutarea în mediu cere Claude Linux plus loginul tău în distribuție.
- **Atestare:**
  - C18 doar **adaugă** acoperirea `preview-local-only`. Un C18 picat sau nerulat nu invalidează C1–C17 (writer, verificări, QA, export), testat M06-PL-03.
  - `CANARY_VERSION` s-a schimbat (canary v2), deci atestarea live din 06:59 UTC nu mai e valabilă după repornirea Hub-ului pe M06. O refaci din Sistem → Medii.
  - Amprenta (`7b3afa6ae2a7d1f3`) nu se schimbă (bwrap era deja în câmpurile ei); atestarea nouă se leagă de ea.

## 4. Nivelurile M06-A

| Nivel | Stare |
|---|---|
| Preview izolat în mediu | **BUILD_READY + PASS_LOCAL** (C18 real și calea gazdei reală, fără Hub); PASS_SIMULATED prin Hub (fake-wsl, M06-PL-04/05). Rularea prin Hub-ul live așteaptă repornirea pe M06 și reatestarea |
| E2E izolat | **BLOCKED**: Chromium pentru Linux lipsește; pornirea lui în bwrap fără `--no-sandbox` trebuie măsurată după instalare |
| Review izolat | **BLOCKED**: Claude Linux și loginul tău în distribuție lipsesc |
| C3 (Stop într-un turn real WSL) | **NOT_RUN**: cere o probă live aprobată |
| `PIPELINE_ISOLATION_VERIFIED` | **neatins** (E2E și review) |
| Aprobarea (b) | **neacordată**; se cere după închiderea E2E și a review-ului |
| `M06_A_PIPELINE_READY` | **neatins**: preview gata; E2E, review și C3 depind de pachetul de mai jos |

## 5. Pachetul de instalări și probe: o singură decizie

Nimic de mai jos nu a fost instalat sau pornit. Fiecare componentă se poate accepta sau refuza separat.

| # | Componentă | Scop | Resurse | Efecte | Revenire |
|---|---|---|---|---|---|
| A1 | Biblioteci de sistem pentru Chromium în `ifrim-runner` (libnss3, libnspr4, libatk-bridge2.0-0t64, libxkbcommon0, libxcomposite1, libxdamage1, libxrandr2, libasound2t64, libpango-1.0-0, libcairo2) | E2E în namespace-ul preview-ului | ~60 MB, apt din Ubuntu | **cere root**, deci rulezi tu o comandă `sudo apt-get install …` în distribuție; eu nu rulez nimic ca root | `sudo apt-get remove …` |
| A2 | Playwright 1.61.0 (aceeași versiune ca pe Windows) + Chromium headless shell pentru Linux, ca `runner`, în `~/tools/pw` și `~/.cache/ms-playwright` | idem | ~8 MB npm + ~110 MB browser (CDN Playwright) | apare `pw_chromium` în inspecție; un canary C19 măsoară dacă Chromium pornește în bwrap **cu** sandbox-ul lui; dacă nu, E2E rămâne BLOCKED (fără `--no-sandbox`) | `rm -rf ~/tools/pw ~/.cache/ms-playwright` |
| A3 | Claude Code pentru Linux în `ifrim-runner` (`npm i -g` cu prefix utilizator, ca `runner`) + **loginul tău** în distribuție (`claude` → /login, OAuth în browserul tău) | review-ul pe o copie, în mediu (Read/Glob/Grep), separat de Windows | ~60 MB; rețea doar spre Anthropic | fără copiere de token Windows → WSL; un canary pentru granița reviewer-ului; harta etapelor arată „review: environment” doar după probă | `npm uninstall -g`, `rm -rf ~/.claude` în distribuție |
| B1 | Transcriere locală în browser: transformers.js (Apache-2.0) + model Whisper base/tiny (greutăți MIT), servite de Hub | confirmarea vocală „Da, execută planul” verificată local; provocarea cu frază aleatorie | ~80–150 MB; CPU cât asculți | audio-ul nu pleacă; modelele nu sunt date private | ștergi fișierele modelului; confirmarea vocală redevine BLOCKED |
| B2 | Verificator de vorbitor local: onnxruntime-web (MIT) + un model ECAPA/WeSpeaker ONNX (**licența greutăților se verifică înainte de descărcare**) | filtrul vocal cu calibrare reală (mostrele tale + voci impostor pe care le furnizezi tu) | ~25–40 MB | rămâne doar filtru, nu autentificare | revine verificatorul de bază |
| C | Proba live **C3**: o încercare Codex RW pe un proiect de test (copie Demo A), prin `codex@wsl-runner`; apeși Stop la ~20 s | dovada Stop în mediu în timpul unui turn real | un turn scurt din abonament | verifică întreruperea, curățarea (`remaining=0`) și că exportul nu se aplică | — |
| D | Aprobarea (b) pentru proiectele reale | doar după A1–A3 + C, verificate | — | — | revocabilă |

**Recomandare:** A1 + A2 + A3 + C, într-o singură sesiune, apoi (b). B1 + B2 separat, când vrei confirmarea vocală.
