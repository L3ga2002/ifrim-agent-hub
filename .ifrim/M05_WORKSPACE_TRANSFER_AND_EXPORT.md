# M05 · Transferul workspace-ului, exportul validat (C14) și proiectele mari

Data: 2026-10-02. Cod:
- `v2/server/environments/workspace.mjs`;
- `tar.mjs`;
- `c14.mjs`;
- `v2/server/factory/snapshot.mjs` (`takeGitSnapshot`);
- `v2/server/tools/git.mjs`.

## Spre mediu (copiere, fără montare)

**Selecția fișierelor**
- Dacă proiectul e repository, se folosește `git ls-files -z --cached --others --exclude-standard`: fișierele urmărite plus cele noi, fără cele ignorate. Altfel, se parcurge folderul.
- Peste selecție se aplică politica proprie a Hub-ului (`transferExclusion`); `.gitignore` nu e politică de securitate. Sunt excluse:
  - dependențele și build-ul (`node_modules`, `dist`, `build` etc.);
  - `.ifrim/`, `.git`, `.ifrim/private`;
  - fișierele de tip secret (`.env*`, chei, `auth.json`, `.npmrc`…);
  - configurațiile de agent (`.codex/`, `.claude/`, `.mcp.json`);
  - legăturile și junction-urile, care nu se urmează;
  - fișierele peste 16 MB.
- **Limite:** 20.000 de fișiere și 256 MB. Un proiect peste ele e refuzat, nu eșantionat.

**Ce înseamnă „modificări necomise”:** se trimite conținutul de pe disc. Nimic nu se comite, nu se pune în stage și nu se resetează (testul M05-EXP-05 verifică `git status` înainte și după).

**Manifestul:** fiecare fișier e citit o singură dată. Ce s-a trimis efectiv (cale, mărime, sha256, bit de execuție) e înregistrat în `<workDir>/environments/wsl-runner/<ws>/manifest.json`.

**Transportul:** un tar (ustar + pax pentru nume lungi sau UTF-8), pe stdin, către `tar -x --no-same-owner --no-same-permissions`. Copia e verificată în mediu: număr de fișiere și total de octeți.

**Git fără programe din repository.** Toate apelurile git ale Hub-ului folosesc:
- `core.fsmonitor=false`, `core.untrackedCache=false`;
- `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`;
- mediul permis al Hub-ului (`buildChildEnv`).

**Măsurat:** un repository care setează `core.fsmonitor` la un program („node.exe script”) **îl făcea pe git să-l ruleze** cu drepturile procesului, inclusiv la `gitState()` al Hub-ului, înainte de M05. Override-ul îl oprește (testul M05-EXP-06 are control pozitiv; verificarea de mutație e prinsă).

## Din mediu (C14 — exportul e input neîncrezător)

**Citirea**
- `tar -c -f - --format=pax --one-file-system --anchored --exclude=./.ifrim-tmp -C <ws>/repo .` rulează **după** oprirea app-server-ului și a proceselor workspace-ului.
- Cititorul (`createTarReader`) nu atinge discul. Verifică pentru fiecare antet checksum-ul și magic-ul ustar.
- Oprește citirea la orice ar face restul arhivei ambiguu:
  - pax global, nume lungi GNU, intrări sparse sau multivolum;
  - o mărime pax invalidă;
  - o legătură sau un director cu mărime nenulă;
  - o arhivă trunchiată;
  - peste 50.000 de intrări sau 512 MB.

**Validatorul (`validateExport`) refuză:**
- căi absolute, segmente `..`, `.` sau goale;
- backslash, `:` (unitate de disc sau ADS), caractere de control, caractere interzise pe Windows;
- nume terminate în punct sau spațiu, nume rezervate (CON, PRN, AUX, NUL, COM*, LPT*, CONIN$, CONOUT$);
- segmente peste 255 de octeți, căi peste 400 de caractere;
- coliziuni de majuscule sau de normalizare Unicode, între intrări sau cu un fișier de bază;
- un fișier sub o cale care e tot fișier;
- duplicate;
- intrări de tip symlink, hardlink, chardev, blockdev sau FIFO;
- fișiere peste limită;
- schimbarea bitului de execuție;
- scrierea, crearea sau ștergerea:
  - testelor de acceptanță protejate (din spec);
  - fișierelor de control (`AGENTS.md`, `CLAUDE.md`, `.ifrim-hub-test.json`, `.codex/`, `.claude/`, `.mcp.json`);
  - fișierelor de tip secret și a căilor Hub-ului;
- binarele noi sau modificate care nu sunt imagini, fonturi sau PDF.

**Adăugat după review-ul adversarial (2026-10-02)**, toate comparate fără majuscule și normalizate NFC, fiindcă pe Windows `.GIT` e tot `.git`:
- **Nume scurte 8.3** (`GIT~1`, `IFRIM~1`…), refuzate oriunde. Pe acest volum `GIT~1` ducea în `.git`, deci un `GIT~1/hooks/pre-commit` ar fi rulat la următorul commit.
- **Foldere de control la orice adâncime:** `.codex`, `.claude`, `.vscode`, `.idea`, `.devcontainer`, `.husky`, `.github`, `.gitlab`, `.circleci`, `.ifrim`.
- **Fișiere de control la orice adâncime:** `.git` ca fișier (redirect gitdir), `AGENTS.md`, `CLAUDE.md`, `.mcp.json`, `.gitmodules`, `.gitattributes`, `.npmrc`, `.yarnrc*`, `desktop.ini`, `autorun.inf`.
- **Fișiere pe care Windows le execută sau le încarcă singur:** `.scf`, `.url`, `.lnk`, `.library-ms`, `.search-ms`….
- **Excepție:** un fișier de control care se întoarce **neschimbat** nu e o schimbare.
- **Mediu → proiect:** un folder `.git` creat de writer în mediu (`git init`) e ignorat, deci nu se aplică niciodată.
- **Proiect → mediu:**
  - fișierele urmărite din foldere de tip `build/` (de exemplu `src/build/index.js`) sunt trimise și pot fi modificate;
  - fișierele **noi** din astfel de foldere sunt ignorate și listate în raport (`ignoredNewFiles`);
  - transferul nu mai urmează un junction aflat în mijlocul căii (realpath trebuie să fie exact calea așteptată), verificat atât la selecție, cât și imediat înainte de citire;
  - un fișier al cărui **conținut** arată ca un secret (cheie privată, token recunoscut de redactare) nu e trimis;
  - lista de nume secrete s-a extins: `*.tfvars`, `*.tfstate`, `*.jks`, `*.keystore`, `*.ppk`, `*.p8`, `*.gpg`, `.git-credentials`, `.htpasswd`, `.dockercfg`, `.dev.vars`, `.vault-token`, `id_dsa`, `service-account*.json`, `*-adminsdk-*.json`, `secrets.*`.
- **Execuție → proiect:**
  - după rulare, mediul e **inspectat din nou** înainte de citirea exportului; o amprentă schimbată înseamnă că nu se aplică nimic;
  - o execuție doar-citire nu aplică niciodată nimic;
  - o comandă care cere permisiuni în plus sau rețea e refuzată automat pe ruta de mediu;
  - când rularea e singură în mediu, reaper-ul oprește toate procesele utilizatorului `runner`.

Ignorate (numărate, niciodată aplicate) sunt doar folderele regenerabile (`node_modules`, `dist`, `.git` creat în mediu, `.ifrim-tmp`), și numai pentru fișiere și directoare obișnuite. O legătură acolo e tot refuzată.

**Limite pe schimbări:** maxim 500 de fișiere, 64 MB și 50 de ștergeri.

**Exportul e acceptat doar întreg.** Un singur refuz pune exportul în carantină: rămâne în staging, nu se aplică nimic, iar misiunea factory trece în NEEDS_OWNER_DECISION.

## Aplicarea (după validare)

1. **Verificarea completă, înainte de orice scriere.** Pentru fiecare cale:
   - fiecare componentă existentă trebuie să fie un director real (fără legătură, junction sau reparse point), iar ținta, dacă există, un fișier obișnuit;
   - conținutul curent trebuie să aibă exact hash-ul din manifestul transferului;
   - un fișier „adăugat” nu trebuie să existe deja, nici cu altă capitalizare.

   Orice abatere e un **conflict**, iar tu primești lista. Nimic nu se scrie și modificările tale nu se suprascriu.
2. **Scrierea.** Originalele sunt păstrate în staging. Fiecare fișier se scrie într-un temporar în același folder și se redenumește peste țintă; folderele părinte se creează pe rând și se reverifică.
3. **Anularea.** Dacă o scriere eșuează, tot ce s-a scris se revine la starea anterioară.
4. **Recitirea.** La final se recitește discul: hash-ul fiecărui fișier trebuie să fie exact cel validat.

**Stările din pipeline:** exportat → validat → aplicat în workspace-ul autorizat → pachet pentru tine → acceptat (decizia ta). Aplicarea nu înseamnă acceptare.

## C14 pe arhive reale (2026-10-02, PASS_LOCAL; 21/21 la prima rulare, 26/26 după review)

Exercițiul (`c14.mjs`) rulează în atestare. Un proiect fictiv e transferat, modificat în distribuție ca un worker, citit cu aceeași comandă tar și validat:

- **Cazul curat:**
  - nume cu diacritice și spații, CRLF păstrat, PNG, o ștergere: acceptat și aplicat octet cu octet pe o copie (C14a–c);
  - o editare umană după transfer dă conflict și nu se scrie nimic (C14d).
- **Arborele ostil:** symlink spre `auth.json`, symlink spre `/etc`, hardlink, FIFO, `.env.local` nou, `AGENTS.md`, testul protejat, `README.MD` lângă `README.md`, `con.txt`, `trail.`, `a:b.txt`, `back\slash.txt`, `tool.exe`, `chmod +x`, `.codex/config.toml`, un fișier de 17 MB. Fiecare caz a fost refuzat cu motivul lui (C14e–t), iar exportul a fost refuzat integral fără să se aplice nimic (C14u).

Arhivele cu `../`, căi absolute, checksum corupt, pax global, nume lungi GNU, coliziuni NFC/NFD și altele pe care un sistem de fișiere Linux nu le poate produce sunt acoperite de teste unitare cu arhive făcute de mână (M05-EXP-01…03).

## Proiecte peste vechea limită (4.000 de fișiere / 64 MB)

**Snapshot-ul factory:** dacă parcurgerea clasică depășește limita **și** proiectul e repository, se trece la `takeGitSnapshot`:
- **fișierele urmărite pe care git le raportează nemodificate:** identificate prin blob-ul din index (`git:<blob>`), fără citire;
- **fișierele modificate sau neurmărite:** citite, hash-uite și păstrate ca în snapshot-ul clasic;
- **conținutul de bază pentru diff:** citit din baza de obiecte (`git cat-file`, doar citire);
- **commit-ul de bază:** înregistrat în `factory_snapshots.git_json`;
- **limite:** 50.000 de fișiere urmărite și maxim 64 MB citiți.

**Test:** un repository cu 4.200 de fișiere, apoi 3 schimbări. Change set-ul conține exact acele 3, iar diff-ul arată baza din git (M05-RT-12).

**Limită cunoscută:** un commit făcut de tine în timpul misiunii schimbă identitatea fișierelor comise, care apar ca modificate. Verificarea de prospețime arată asta; nimic nu se aplică pe ascuns.

## Intrările de tip director (corectat înainte de proba live, 2026-10-02)

`tar -c` emite un director (de exemplu `./.git/` sau `./.github/`) ca intrare separată, înaintea fișierelor din el. Arhivele făcute de mână din testele vechi nu aveau astfel de intrări, iar două cazuri reale refuzau tot exportul:
- **Un folder `.git` creat în mediu** (de exemplu de un `git init` al writer-ului) e acum **ignorat**, ca fișierele din el. Un **fișier** `.git` (redirect gitdir) rămâne refuzat.
- **Un folder protejat trimis și neschimbat** (`./.github/`, al cărui conținut era în manifestul transferului) nu mai e o schimbare. Fără corecție, orice proiect real cu `.github` ar fi avut exportul refuzat.
- **Folderele protejate noi** (`.husky/`, `.vscode/`, `GIT~1/`) rămân refuzate, la fel ca orice fișier nou sau modificat dintr-un folder protejat.

Test: M05-LR-04, cu intrări reale de tip 5. Doi mutanți au fost prinși.
