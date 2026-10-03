# M07 · Manifestul instalărilor

Data: 2026-10-02. Autorizare: promptul M07 al proprietarului, §03 punctele 2–6 (A1, A2, A3, B1, B2).
Executant: Claude Code, în sesiunea de lucru, prin unelte locale.

Regulă: doar componentele necesare. Toate au versiuni fixate, sursă oficială, integritate verificată unde există o valoare publicată și revenire documentată. Nimic din lista de mai jos nu e în Git.

## A1 · Biblioteci de sistem pentru Chromium, în `ifrim-runner`

| Câmp | Valoare |
|---|---|
| Cum am ales lista | Am instalat întâi doar Chrome Headless Shell ca `runner`. Apoi `ldd` pe binar a arătat exact ce lipsea: `libnspr4.so`, `libnss3.so`, `libnssutil3.so`, `libasound.so.2`. Lista completă `playwright install-deps` (38 de pachete: Xvfb, Mesa, Vulkan, fonturi CJK) nu e necesară pentru modul headless și nu a fost instalată. |
| Mecanism | `wsl.exe -d ifrim-runner -u root`, mecanismul administrativ al WSL, fără parolă. Am rulat `apt-get update` (doar indexul) și `apt-get install -y --no-install-recommends libnss3 libnspr4 libasound2t64`. Fără `upgrade`. |
| Pachete noi | `libasound2-data 1.2.11-1ubuntu0.3`, `libasound2t64 1.2.11-1ubuntu0.3`, `libnspr4 2:4.35-1.1build1`, `libnss3 2:3.98-1ubuntu0.2` (arhiva oficială Ubuntu noble) |
| Spațiu | 5,8 MB |
| Dovadă | Lista pachetelor înainte și după: `/root/pkgs-before-m07.txt` și `/root/pkgs-after-m07.txt`, în distribuție. Diferența are exact cele 4 pachete. |
| Privilegii | Utilizatorul `runner` nu e în grupul `sudo`, nu are intrări în `sudoers` și `/etc/sudoers.d` e gol. Root a fost folosit doar pentru `apt`. Codex, Claude, Chromium și codul proiectelor rulează ca `runner`. |
| Revenire | `wsl.exe -d ifrim-runner -u root -- apt-get remove libnss3 libnspr4 libasound2t64 libasound2-data` |

## A2 · Playwright și Chromium pentru Linux, ca `runner`

| Câmp | Valoare |
|---|---|
| Playwright | `playwright@1.61.0`, exact versiunea de pe Windows (`package.json`). Instalat cu `npm install --save-exact --ignore-scripts` în `/home/runner/tools/pw` (`package-lock.json` local, 18 MB). |
| Browser | `npx playwright install --only-shell chromium`: Chrome Headless Shell 149.0.7827.55 (Playwright rev. 1228) și ffmpeg 1011, în `/home/runner/.cache/ms-playwright` (267 MB). Sursa e CDN-ul Playwright (`cdn.playwright.dev`, redirecționat la Chrome for Testing). sha256 al binarului (primele 16): `670ba079b7510774`. |
| Fără | Firefox, WebKit, Chromium complet, Xvfb |
| Rulare | Ca `runner`, cu `chromiumSandbox: true` (implicit Playwright e `false`; `--no-sandbox` nu se folosește). Măsurat în profilul bwrap doar-local: renderer-ele rulează cu `Seccomp: 2` și `NoNewPrivs`, într-un user namespace propriu, imbricat. |
| Revenire | `rm -rf /home/runner/tools/pw /home/runner/.cache/ms-playwright` |

## A3 · Claude Code pentru Linux, reviewer izolat

| Câmp | Valoare |
|---|---|
| Versiune | `@anthropic-ai/claude-code@2.1.285`, canalul **stable** oficial la 2026-10-02 (latest era 2.1.287). Versiune exactă, prin npm, în `/home/runner/tools/claude`. |
| Instalare | `npm install --save-exact --ignore-scripts`, apoi `install.cjs` al pachetului, rulat după ce l-am citit: el doar leagă binarul nativ peste stub. |
| Binarul nativ | `@anthropic-ai/claude-code-linux-x64` 2.1.285, 240.327.864 B, aceeași dimensiune ca binarul publicat. sha256 (primele 16): `33dad1ec615a2e08`. |
| Spațiu | 230 MB |
| Actualizări | Nu se actualizează singur: versiunea npm e fixată, iar Hub-ul pornește Claude cu `DISABLE_AUTOUPDATER=1` și `DISABLE_UPDATES=1`. O schimbare a binarului schimbă amprenta mediului și invalidează atestarea. |
| Configurare | `/home/runner/ifrim-reviewer/config` (mod 700), folosit prin `CLAUDE_CONFIG_DIR`. Separat de orice alt `~/.claude`. |
| Login | Făcut de proprietar, în distribuție, prin OAuth oficial, la 2026-10-02 ~19:0x UTC. Rezultat: `authMethod: claude.ai`, `apiProvider: firstParty`, `subscriptionType: max`; fișierul de credențiale are mod 600. Nimic copiat din Windows, nicio cheie API. Codul OAuth l-a introdus proprietarul, nu agentul. |
| Revenire | `CLAUDE_CONFIG_DIR=/home/runner/ifrim-reviewer/config claude auth logout`, apoi `rm -rf /home/runner/tools/claude /home/runner/ifrim-reviewer` |

## B1 · Transcriere locală în română (pe Windows, în Hub)

| Câmp | Valoare |
|---|---|
| Alegere | whisper.cpp v1.9.4 (MIT), cu modelul **large-v3-turbo q8_0** (greutăți MIT, OpenAI) și limba forțată `ro`. |
| De ce nu planul M06 | Planul M06 propunea transformers.js cu Whisper tiny/base în browser. Am schimbat din trei motive: (1) pentru română, small/base nu sunt utilizabile (FLEURS WER ~34% / 50%+, față de ~9–11% pentru large-v3 / turbo); (2) transcrierea făcută în browser nu poate fi dovadă pentru server, iar M07 §14 cere ca „source=local” trimis de client să nu fie suficient; (3) whisper.cpp e alternativa indicată de proprietar (S6). |
| Binare | `whisper-cublas-12.4.0-bin-x64.zip` (release b5130 = v1.9.4), 674.539.285 B, sha256 `af520ddd034d985b55dfeea3e465ed93653ba2aee1a55e865033edc548c272a7` (verificat). Extras în `C:\Users\mihai\IfrimHub\voice\whisper-1.9.4-cu124\Release`: 47 de fișiere, 1,2 GB, cu DLL-urile CUDA 12.4 incluse. Hash-ul arborelui, fixat în cod: `3c80b88ee4b08d05ad001ab79e07271e327a1413aa324325545378325bde7bbc`. Arhiva a fost ștearsă după extragere. |
| Model | `ggml-large-v3-turbo-q8_0.bin`, 874.188.075 B, sha256 `317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1` (verificat; fixat în cod) |
| Cerințe | Driverul NVIDIA 617.14 (minimul e 551.61). RTX 3050 Laptop, 4 GB. VC++ runtime 14.50 prezent. |
| Măsurat | Pornire la rece ~30 s, din care 16 s verificarea hash-urilor și 6,6 s încărcarea pe GPU. Apoi 0,4–1,5 s per frază (GPU) plus 0,1–0,6 s verificarea vorbitorului. VRAM ~1 GB cât rulează. |
| Rulare | Proces copil al unui worker deținut de Hub, pe un port loopback aleator. La pornire, worker-ul verifică o singură dată, prin netstat, ce PID ascultă pe port și refuză un alt proces; dacă netstat nu răspunde clar, verificarea e sărită fără eroare. Folderul static e gol. Se oprește odată cu Hub-ul și după 30 de minute de inactivitate. Fără rețea. |
| Revenire | Ștergi `C:\Users\mihai\IfrimHub\voice\whisper-1.9.4-cu124` și modelul. Confirmarea vocală devine indisponibilă, cu motivul afișat. |

## B2 · Verificator de vorbitor local

| Câmp | Valoare |
|---|---|
| Model | 3D-Speaker **CAM++ VoxCeleb** (`3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx`), 29.596.978 B, sha256 `357a834f702b80161e5b981182c038e18553c1f2ca752ed6cec2052365d4129b`, valoare din `checksum.txt` al release-ului sherpa-onnx (verificată; fixată în cod). |
| Licență | Greutățile sunt Apache-2.0, conform ModelScope (`iic/speech_campplus_sv_en_voxceleb_16k`: „License: Apache License 2.0”). Modelele WeSpeaker au fost evitate din cauza licenței ambigue (CC BY 4.0 vs. apache-2.0). |
| Caracteristici | Embedding de 512 dimensiuni, EER publicat 0,73% pe VoxCeleb1-O (în engleză; pe vocea ta e nemăsurat). |
| Runtime | `sherpa-onnx-node@1.13.8` și `sherpa-onnx-win-x64@1.13.8` (Apache-2.0), npm, versiune exactă, fără scripturi de instalare, în `node_modules` al proiectului (23 MB). Addon N-API; a rulat pe Node 24.14. |
| Model în | `C:\Users\mihai\IfrimHub\voice\models\` |
| Revenire | `npm uninstall sherpa-onnx-node` și ștergerea modelului. Filtrul vocal devine indisponibil, cu motivul afișat. |

## Locația și o capcană găsită

- **Unde stau componentele vocale.** `C:\Users\mihai\IfrimHub\voice`: în profilul utilizatorului, dar nu în AppData și nu în OneDrive. Suprascrie cu `IFRIM_VOICE_ROOT`.
- **De ce nu AppData.** Aplicația desktop Claude e un pachet MSIX, iar procesele lansate din ea văd o copie redirecționată a `%LOCALAPPDATA%`. Prima descărcare a ajuns în `...\Packages\Claude_…\LocalCache`: invizibilă pentru un Hub pornit cu dublu-click. Am mutat-o, iar M07-VO-09 testează că rădăcina implicită nu e în AppData.
- **Distribuția `ifrim-runner` nu e afectată.** VHD-ul ei e real, în `C:\Users\mihai\AppData\Local\IfrimRunner\wsl\ext4.vhdx` (creat de serviciul WSL).

## Ce NU s-a instalat sau schimbat

- Fără Firefox/WebKit, Xvfb sau fonturi suplimentare.
- Fără framework-uri sau servicii cloud noi, fără autostart sau serviciu Windows.
- Fără `wsl.conf`, `.wslconfig`, kernel, interop sau mounturi.
- Fără upgrade general al distribuției, fără modificări ale clientului Claude/Codex de pe Windows.
- Fără V1/OpenClaw dezinstalat.
- Fără date biometrice în Git sau în OneDrive: profilul vocal e în `C:\Users\mihai\IfrimHub\voice\profiles` (sau `<IFRIM_VOICE_ROOT>\profiles`), în afara proiectului, nu în `.ifrim/private/` (sincronizat de OneDrive). Doar testele îl țin în directorul lor de date. Pe Windows, modul 600 cerut de cod nu se aplică: fișierele moștenesc ACL-ul folderului (vezi `M07_SECURITY_READINESS.md` §5).
