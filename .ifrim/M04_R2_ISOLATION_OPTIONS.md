# M04 · R2: opțiuni pentru un mediu de execuție izolat

Data: 2026-10-01. Document de evaluare: **nimic nu a fost instalat, configurat sau pornit**. Statusuri: PASS_LOCAL, PASS_LIVE, NEVERIFICAT, NOT_RUN.

**R2 rămâne DESCHIS.** Se închide doar după ce canary-ul din §6 trece în mediul nou, poarta e schimbată cu acordul tău și o probă live pe un proiect `hub-test` trece prin noul traseu. Până atunci, Codex pe un proiect real rămâne „risc acceptat (nu este o izolare)”, ca în `M03_RUNTIME_READINESS.md` §3.

## 0. Pe scurt

- **Problema (M03 §3):** comenzile modelului Codex rulează în sandbox-ul Windows elevated, care cere citire pe `:root`. Orice cale nenegată e citibilă. Canary-ul din 2026-10-01 a confirmat asta: 4 citiri ALLOWED (`KNOWN_GAP_R2`).
- **Pe această mașină (Windows 11 Home), Hyper-V și Windows Sandbox nu sunt disponibile** [S7][S9]. Rămân WSL2 și Docker Desktop (care rulează tot peste WSL2).
- **Recomandare:** o distribuție WSL2 **dedicată** (`ifrim-runner`). În ea:
  - nu se montează discurile Windows și interop-ul e oprit;
  - rulează un utilizator fără root;
  - Codex are propriul login ChatGPT;
  - profilul de permisiuni Codex are `":root"="deny"` și `":minimal"="read"`, deci al doilea strat (bubblewrap) ascunde restul distribuției [S1][S16].
- Workspace-ul se **copiază** în distribuție și rezultatul iese ca patch, verificat de Hub pe Windows. Nu se montează nimic din Windows.

## 1. Criteriile (ce trebuie să ofere mediul)

| # | Criteriu |
|---|---|
| K1 | Acces limitat la workspace-ul aprobat |
| K2 | Fără acces la discurile și folderele gazdei (alte proiecte, `.env`-uri, documente) |
| K3 | Configurări și credențiale protejate: `~/.codex` Windows, `.ifrim/private`, `auth.json`-ul din mediu |
| K4 | Interop și punți controlate: procese Windows, PATH, variabile, socket-uri, clipboard |
| K5 | Rețea limitată: comenzile modelului fără rețea; serviciile Windows de pe 127.0.0.1 (Hub-ul pe 8011) inaccesibile |
| K6 | Export verificat al rezultatelor (căi, mărime, fișiere de control) înainte de a atinge proiectul de pe Windows |
| K7 | Autentificare oficială prin abonament (login ChatGPT în mediu, fără cheie API) |
| K8 | Disponibil pe Windows 11 Home, fără upgrade de licență |

## 2. Faptele mașinii (citite 2026-10-01, doar citire)

- **Sistem:** Windows 11 Home, build 26300. 31,7 GB RAM, 12 procesoare logice.
- **WSL:** 2.7.3.0, kernel 6.6.114.1-1.
- **Distribuții existente (WSL2, oprite):** `Ubuntu` (implicită) și `docker-desktop`. Docker Desktop e deci instalat; versiunea nu e verificată aici.
- **`%UserProfile%\.wslconfig`:** nu există, deci totul e pe implicit: rețea NAT, 50% din RAM, toate procesoarele [S1].
- **Codex CLI pe Windows:** 0.159.2 (canary-ul M03).
- **`wsl --help` local** listează `--install <Distro> --name <Name> --location <Location> --no-launch --vhd-size`.

## 3. Comparație

| Criteriu | A. WSL2 dedicat (recomandat) | A0. Distribuția `Ubuntu` existentă + profil | B. VM Hyper-V | C. Windows Sandbox (.wsb) | D. Docker Desktop (WSL2) |
|---|---|---|---|---|---|
| K1 workspace | da: copie în ext4, plus profilul Codex | doar profilul Codex (un strat) | da: copie/partajare explicită | MappedFolders, opțional ReadOnly [S8] | bind mount sau copie |
| K2 gazda | da: `automount enabled=false` [S1] | **nu**: `/mnt/c` montat implicit [S1] | da: VM separat | da, în afara folderelor mapate | da, în afara mount-urilor |
| K3 credențiale | `~/.codex` propriu [S18], negat modelului prin profil [S16] | `~/.codex` propriu, dar și `/mnt/c/Users/...` | propriu | se pierde la închidere; login la fiecare sesiune | `auth.json` copiat în container [S17] |
| K4 interop | `[interop] enabled=false`, `appendWindowsPath=false` [S1] | activ implicit [S1] | fără (dacă nu activezi partajări) | clipboard activ implicit, se poate opri [S8] | fără, dacă nu montezi socket-ul Docker |
| K5 rețea | comenzi offline (profil); NAT nu vede 127.0.0.1 de pe Windows [S3] | la fel | switch NAT | rețea necesară pentru Codex, „poate expune rețeaua internă” [S8] | rețea necesară pentru client |
| K6 export | patch prin stdout, validat de Hub | patch | git/partajare | folder mapat cu scriere (persistă) [S8] | patch / `docker cp` |
| K7 login | `codex login --device-auth` [S17] | da | da | la fiecare pornire | device code sau `auth.json` copiat [S17] |
| K8 Home | **da** | da | **nu** [S9] | **nu** [S7] | neclar în documentație [S10] |
| Graniță | containere izolate în același VM WSL [S4] | aceeași | VM complet | VM de unică folosință [S7] | container în distribuția `docker-desktop` [S11] |

## 4. Opțiunea A: distribuție WSL2 dedicată `ifrim-runner` (recomandată)

**Arhitectura propusă:**
- **Pornirea:** Hub-ul (pe Windows) pornește `wsl.exe -d ifrim-runner -u runner --cd /home/runner/ws/<misiune> -- codex app-server`. Protocolul rămâne JSON-RPC pe stdio, ca acum, iar Hub-ul pornește procesul cu un mediu curat (fără `WSLENV`).
- **Workspace-ul intră prin copiere:** Hub-ul trimite un `git bundle` sau tar pe stdin. Nimic de pe Windows nu e montat.
- **Rezultatul iese ca patch** (`git diff --binary`) pe stdout. Hub-ul îl validează pe Windows și îl aplică abia după acceptarea ta.
- **Două straturi:**
  1. distribuția: fără discurile Windows și fără interop;
  2. profilul Codex: `":root"="deny"`, `":minimal"="read"`, workspace-ul cu scriere, `~/.codex` și `**/.env*` negate, rețeaua oprită. Pe Linux/WSL, bubblewrap ascunde căile negate [S16].

**Ce garantează:**
- Discurile Windows nu se mai montează automat (`[automount] enabled=false`), iar `/etc/fstab` nu e procesat (`mountFsTab=false`) [S1].
- Nu se pot lansa procese Windows și PATH-ul nu primește căi Windows (`[interop] enabled=false`, `appendWindowsPath=false`) [S1]. Reactivarea la runtime prin `/proc/sys/fs/binfmt_misc/WSLInterop` cere root [S2], pe care `runner` nu îl are.
- Comenzile modelului citesc doar workspace-ul și setul `:minimal`. Exemplul oficial „File access limited to workspace” folosește exact `":root"="deny"` + `":minimal"="read"` [S16].
- `~/.codex` Windows, `.ifrim/private`, celelalte proiecte și `.env`-urile lor **nu există** în distribuție (K2, K3).
- Rețeaua:
  - comenzile modelului rulează offline (`network.enabled` e implicit `false` [S16]);
  - în modul NAT implicit, distribuția ajunge la Windows doar prin IP-ul gazdei [S3], deci Hub-ul legat la 127.0.0.1 nu ar trebui să fie accesibil (deducție, verificată de C6);
  - **modul `mirrored` nu se activează**: în el, Linux ajunge la serverele Windows prin 127.0.0.1 [S3].
- Login oficial ChatGPT în distribuție, cu `~/.codex` separat de cel Windows (implicit, la CLI-ul din WSL) [S17][S18].

**Ce NU garantează (rămâne de știut):**
- **Root-ul din distribuție poate monta discurile manual** („you could still mount them manually” [S1]). De aceea `runner` nu are root și nici sudo. `wsl.exe -u root` de pe Windows rămâne posibil, dar e partea ta (gazdă → oaspete).
- **Distribuțiile nu sunt VM-uri separate:** WSL2 le rulează „as isolated containers inside the managed VM” [S4]. Același kernel e folosit și de `Ubuntu` (care are `/mnt/c`) și de `docker-desktop`, deci o evadare din kernel ar trece de graniță. Graniță VM per mediu există doar la B și C, indisponibile aici.
- **`.wslconfig` e global** [S1]: orice limită de RAM, rețea sau firewall afectează și `Ubuntu` și Docker Desktop.
- **Procesul client Codex** (nesandboxat) are nevoie de rețea spre OpenAI. Mediul nu îl limitează pe domenii. Regulile firewall Hyper-V se aplică pe tot WSL-ul (VMCreatorId `{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}`) [S6].
- **Windows poate citi și modifica fișierele distribuției** prin `\\wsl$` [S2][S11]. E direcția gazdă → oaspete: utilă pentru export, dar orice proces de pe Windows poate atinge runner-ul.
- **Montări speciale prezente în orice distribuție** (`/mnt/wsl`, `/mnt/wslg`, `/usr/lib/wsl`) nu sunt descrise în paginile citite: NEVERIFICAT. Profilul cu `":root"="deny"` le ascunde comenzilor modelului; canary-ul le inventariază.
- **Conținutul `:minimal` e decis de Codex** și nu e listat [S16]: NEVERIFICAT, inventariat de canary.
- **Bubblewrap cere user namespaces neprivilegiate.** Altfel Codex trece pe căi de compatibilitate [S15][S16]. Canary-ul verifică avertismentul.
- **Profilurile de permisiuni și login-ul cu device code sunt Beta** [S16][S17].

**Pași de instalare** (descriși, neexecutați; fiecare cu aprobarea ta):
1. În PowerShell rulezi `wsl --list --online` și alegi un Ubuntu LTS.
2. Instalezi distribuția: `wsl --install <Ubuntu-LTS> --name ifrim-runner --location <cale în afara OneDrive> --no-launch --vhd-size <ex. 40GB>` [S5] (+ `wsl --help` local).
3. Pornești ca root: `wsl -d ifrim-runner -u root`. Creezi utilizatorul `runner` (`useradd -m -s /bin/bash runner`, fără grupul sudo) și scrii `/etc/wsl.conf` [S1]:
   ```ini
   [automount]
   enabled=false
   mountFsTab=false
   [interop]
   enabled=false
   appendWindowsPath=false
   [user]
   default=runner
   [gpu]
   enabled=false
   ```
4. Rulezi `wsl --terminate ifrim-runner`, apoi aștepți să se oprească (regula celor 8 secunde, `wsl --list --running`) [S1].
5. Ca root instalezi `bubblewrap`, `git` și Node 24 [S15]. Ca `runner` instalezi Codex CLI cu instalatorul oficial (`curl -fsSL https://chatgpt.com/codex/install.sh | sh`) [S14], fixat pe versiunea validată.
6. `~runner/.codex/config.toml` are:
   - niciun server MCP și niciun plugin;
   - `cli_auth_credentials_store = "file"`, pentru că `keyring` eșuează când nu există un credential store [S17].

   Fișierul nu se partajează cu Windows: **nu** se setează `CODEX_HOME=/mnt/c/...` [S18].
7. Activezi login-ul cu device code în setările de securitate ChatGPT, apoi rulezi `wsl -d ifrim-runner -- codex login --device-auth` și introduci codul în browserul de pe Windows [S17].
8. Codul Hub-ului (aprobare separată de implementare):
   - suprafața `wsl-runner`: pornire, copiere în mediu și export;
   - profilul Linux;
   - aceleași gărzi: pluginuri oprite, `mcpServerStatus/list` fail-closed, `model/list`, garda de facturare;
   - nivelul `host_isolation = environment`, acordat doar pentru amprenta mediului validată de canary (nume distribuție + hash `wsl.conf` + versiunea Codex + hash-ul profilului).
9. Canary-ul din §6 (PASS_LOCAL), apoi o probă live pe un proiect `hub-test` prin `wsl-runner`.

**Resurse:**
- **Memorie și procesoare:** VM-ul WSL ia implicit 50% din RAM (≈ 15,8 GB aici) și toate cele 12 procesoare, împărțite între toate distribuțiile [S1]. Le poți limita din `.wslconfig` (`memory`, `processors`), dar limita e globală.
- **Disc:** VHD-ul crește odată cu folosirea; se plafonează cu `--vhd-size` sau `defaultVhdSize` [S1]. Câțiva GB pentru Ubuntu, Node și Codex (estimare, NEVERIFICAT).
- **Timp:** pornirea distribuției, copierea workspace-ului și sandbox-ul adaugă secunde. Cât anume: NEVERIFICAT, măsurat de canary.

**Impact:**
- Nu se schimbă ACL-uri pe Windows. Codex desktop și distribuția `Ubuntu` rămân neatinse (`wsl.conf` e per distribuție [S1]).
- Al doilea login ChatGPT (în mediu), pe același cont.
- Proiectul de pe Windows se schimbă doar prin exportul verificat.

**Aprobări necesare (separate):**
1. instalarea distribuției;
2. conținutul `wsl.conf`;
3. activarea device code în contul ChatGPT (o faci tu);
4. login-ul (îl faci tu);
5. implementarea în Hub, cu testele ei;
6. rularea canary-ului;
7. schimbarea porții R2;
8. prima probă live;
9. opțional, `.wslconfig` (global).

**Revenire:**
1. `codex logout` în distribuție;
2. `wsl --terminate ifrim-runner`;
3. `wsl --unregister ifrim-runner`: **șterge definitiv** sistemul de fișiere al distribuției [S5], deci cere aprobare și export înainte;
4. în Hub, suprafața se dezactivează, iar poarta revine la regula R2 actuală;
5. opțional, dezactivezi device code în ChatGPT și ștergi `.wslconfig`, dacă a fost creat.

## 5. Celelalte opțiuni

**A0. Distribuția `Ubuntu` existentă + profilul Codex:** nerecomandată.
- Are un singur strat (bubblewrap).
- `/mnt/c` e montat implicit și interop-ul e activ [S1].
- E distribuția ta personală; schimbarea `wsl.conf` acolo ți-ar strica fluxul.
- Dacă profilul e greșit sau bubblewrap cade pe compatibilitate, tot discul C: e din nou citibil.

**B. VM Hyper-V:** imposibilă fără upgrade.
- „The Hyper-V role **can't** be installed on … Windows 11 Home” [S9]. Ar cere upgrade la Pro (licență), activarea funcției și restart.
- **Garantează:** kernel separat per VM; nimic din gazdă fără partajare explicită.
- **Nu garantează:** limitarea pe domenii a clientului Codex; are nevoie de același login și de același export.
- **Resurse:** un OS complet (minim 4 GB pentru gazdă [S9], plus RAM și disc dedicate VM-ului).
- **Revenire:** ștergerea VM-ului; Hyper-V se poate dezactiva.

**C. Windows Sandbox:** imposibil pe Home și nepotrivit ca runner.
- „Windows Sandbox is currently not supported on Windows Home edition” [S7].
- E de unică folosință: totul se pierde la închidere [S7], deci ar cere un login nou la fiecare sesiune sau un `auth.json` copiat într-un folder mapat.
- Rulează o singură instanță odată [S7].
- Rețeaua (necesară pentru Codex) „can expose untrusted applications to the internal network” [S8].
- Clipboard-ul e partajat implicit [S8].
- Folderele mapate cu scriere persistă după închidere [S8].
- În interior, Codex ar folosi din nou sandbox-ul Windows.

**D. Docker Desktop cu WSL2:** posibil, nu ca primă cale.
- **Garantează:** containerul vede doar ce montezi sau copiezi; imagini fixate; un mediu de unică folosință per misiune.
- **Nu garantează:**
  - graniță VM: rulează în distribuția `docker-desktop`, „isolated … in the same way any two WSL distributions are isolated” [S11];
  - bubblewrap în container poate cere căi de compatibilitate („restricted container hosts can force compatibility paths” [S16]);
  - `docker-users` echivalează cu drepturi de administrator pe gazdă [S10];
  - Enhanced Container Isolation, care blochează montarea socket-ului Docker, cere abonamentul **Business** [S12];
  - credențialele: documentația Codex arată copierea `auth.json` în container cu `docker cp` [S17], adică un token copiat la fiecare mediu.
- **Licență:** gratuit pentru firme mici (sub 250 de angajați **și** sub 10 milioane USD venit anual) [S10]. Eligibilitatea o confirmi tu.
- **Pe Home:** cerințele listate sunt Pro, Enterprise sau Education. O notă spune că Home poate rula doar containere Linux [S10]. Neclar, deci NEVERIFICAT pe această mașină.
- **Revenire:** ștergerea containerelor și a imaginilor; Docker Desktop rămâne cum e.

**Starea actuală (Windows nativ, `:root` citibil):** e evaluată în M03 §3. Documentația Codex trimite la WSL „when you need the Linux sandbox model” [S16]. Pagina sandbox-ului Windows descrie `/sandbox-add-read-dir` pentru a **adăuga** citire, nu pentru a o restrânge [S13].

## 6. Planul canary (doar fișiere fictive; rulează după instalare, cu aprobarea ta)

**Pregătire:**
- La început se generează un token aleator `CANARY_<rand>` cu sufixe A–F. Tokenul apare doar în fișierele fictive. Conținutul real al `auth.json` nu se citește niciodată (doar `test -r`).
- **Pe Windows:** `%TEMP%\ifrim-r2-canary-<rand>\`:
  - `alt-client\.env` (A);
  - `alt-client\src\client.txt` (B);
  - `fake-home\.codex\config.toml` (fictiv);
  - un listener fictiv pe `127.0.0.1:<port liber>` care răspunde cu C. **Nu** se folosește Hub-ul.
- **În distribuție:**
  - `/home/runner/ws/canary-ws/` (workspace fictiv, cu `.env` = D);
  - `/home/runner/ws/alt-ws/secret.txt` (E, „alt client” în mediu);
  - `~/.codex/canary-marker` (F).
- **Rulare:**
  - verificările „runner” rulează în shell-ul `runner`;
  - verificările „sandbox” rulează prin `codex sandbox -P <profil> -C <ws> -- <cmd>`, fără model. E forma folosită azi de `v2/server/factory/runner.mjs`; pe Linux e NEVERIFICAT;
  - se poate porni de la `v2/tests/manual/codex-sandbox-canary.mjs`.

| # | Unde | Verificare | Așteptat |
|---|---|---|---|
| C1 | runner | `ls /mnt`, `mount` | fără `c`/`d`; fără montări drvfs ale discurilor Windows |
| C2 | runner | căile Windows ghicite (`/mnt/c/Users/...`, arborele fictiv) | ENOENT |
| C3 | runner | `mount -t drvfs C: /tmp/x`, `sudo -n true` | refuzat (fără root) |
| C4 | runner | `cmd.exe /c ver`, `powershell.exe`, `echo $PATH` | negăsite; PATH fără căi Windows |
| C5 | runner | inventarul `/mnt/wsl`, `/mnt/wslg`, `/usr/lib/wsl` | înregistrat; orice dată de utilizator Windows → FAIL |
| C6 | runner | conexiune la IP-ul gazdei:port (listenerul fictiv) | refuzată (listener pe loopback, NAT) |
| C7 | sandbox RW | citire și scriere în workspace; scriere în afara lui | ALLOWED / ALLOWED / DENIED |
| C8 | sandbox RO | scriere în workspace | DENIED |
| C9 | sandbox | `alt-ws/secret.txt` (E) | DENIED (analogul R2 în mediu) |
| C10 | sandbox | `~/.codex/canary-marker` (F), `~/.codex/config.toml`, `test -r ~/.codex/auth.json` | DENIED |
| C11 | sandbox | `.env` din workspace (D) | DENIED |
| C12 | sandbox | DNS și TCP spre un host public și spre gazdă | eșec (fără rețea) |
| C13 | sandbox | `env`, `ls /proc` | fără variabile Windows; înregistrat |
| C14 | Hub | validatorul de export pe patch-uri: normal, cu `../`, cu symlink în afară, `.codex/config.toml`, peste limită | acceptat / respins / respins / finding critic / respins |
| C15 | gazdă | `wsl --terminate`, aștepți, repeți C1–C4 | identic (config persistent) |
| C16 | Hub | „Verifică contul” prin `wsl-runner` (`model/list`, fără inferență) | autentificare ChatGPT, fără cheie API |
| C17 | toate | căutarea tokenurilor A, B, C, E, F (și D) în toate ieșirile | 0 potriviri |

**Rezultat:**
- PASS_LOCAL = toate rândurile ca în coloana „Așteptat”, 0 potriviri ale tokenurilor, 0 `KNOWN_GAP_R2`.
- Înregistrarea leagă rezultatul de amprenta mediului. Orice schimbare a mediului invalidează canary-ul.

**Curățenie:** se șterg arborele fictiv de pe Windows și folderele `canary-ws`, `alt-ws` și `canary-marker`; listenerul se oprește.

**Ce închide R2:**
1. canary-ul PASS_LOCAL în `ifrim-runner`;
2. schimbarea porții, aprobată de tine;
3. o probă live PASS_LIVE pe `hub-test` prin `wsl-runner`.

Până atunci: **R2 DESCHIS**, iar REAL_PROJECT_READY rămâne neatins.

## 7. Recomandarea, pe scurt

**Opțiunea A** e singura care pe această mașină (Home) îndeplinește K1–K8 fără upgrade de licență:
- are două straturi independente: distribuția fără gazdă și profilul Codex cu `":root"="deny"`;
- autentificarea e oficială, prin abonament;
- nu atinge ACL-urile Windows, Codex desktop sau distribuția ta `Ubuntu`;
- revenirea e curată (`--unregister`).

**Limita principală:** kernelul e comun cu celelalte distribuții WSL [S4]. Dacă vrei graniță VM, singura cale e B, după upgrade la Windows Pro.

## Surse (consultate 2026-10-01)

- [S1] https://learn.microsoft.com/en-us/windows/wsl/wsl-config — `wsl.conf` `[automount]`, `[interop]`, `[user]`, `[gpu]`; `.wslconfig` global, `networkingMode`, `firewall`, `memory`, `processors`; regula celor 8 secunde
- [S2] https://learn.microsoft.com/en-us/windows/wsl/filesystems — `/mnt/c`, `\\wsl$`, interop, `WSLInterop` (root, nepersistent)
- [S3] https://learn.microsoft.com/en-us/windows/wsl/networking — NAT, `mirrored` (127.0.0.1 spre Windows), firewall Hyper-V
- [S4] https://learn.microsoft.com/en-us/windows/wsl/compare-versions — „isolated containers inside the managed VM”
- [S5] https://learn.microsoft.com/en-us/windows/wsl/basic-commands — `--install` (`--location`, `--no-launch`), `--import`, `--export`, `--unregister`
- [S6] https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/hyper-v-firewall — reguli per VMCreatorId, `DefaultOutboundAction`
- [S7] https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/ — ediții (fără Home), unică folosință, o singură instanță
- [S8] https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file — `Networking`, `MappedFolders`/`ReadOnly`, `ClipboardRedirection`, `ProtectedClient`
- [S9] https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/install-hyper-v — Hyper-V: Pro/Enterprise, nu Home
- [S10] https://docs.docker.com/desktop/setup/install/windows-install/ — cerințe WSL2, licență, `docker-users`
- [S11] https://docs.docker.com/desktop/features/wsl/ — distribuția `docker-desktop`, `\\wsl$`
- [S12] https://docs.docker.com/enterprise/security/hardened-desktop/enhanced-container-isolation/ — ECI, „Subscription: Business”
- [S13] https://learn.chatgpt.com/docs/windows/windows-sandbox — sandbox-ul Codex elevated/unelevated, `/sandbox-add-read-dir`
- [S14] https://learn.chatgpt.com/docs/windows/wsl — Codex în WSL2, bubblewrap din 0.115, instalatorul oficial
- [S15] https://learn.chatgpt.com/docs/sandboxing — bubblewrap pe Linux/WSL2, user namespaces, AppArmor
- [S16] https://learn.chatgpt.com/docs/permissions — profiluri, `:root`/`:minimal`/`deny`, rețea, aplicare pe platforme, exemplul „File access limited to workspace”
- [S17] https://learn.chatgpt.com/docs/auth — `codex login --device-auth`, `auth.json` „like a password”, `cli_auth_credentials_store`, copiere în container
- [S18] https://learn.chatgpt.com/docs/windows/windows-app — CLI-ul din WSL are implicit `~/.codex` separat; `CODEX_HOME` partajat (de evitat aici)
