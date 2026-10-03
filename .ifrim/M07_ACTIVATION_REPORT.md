# M07 · Raport de activare: voce locală și validare reală

Data: 2026-10-03. Cod `2.8.0-m07`, contract API 7. Detalii în:
- `M07_LIVE_VALIDATION_RESULTS.md`: probele D1–D8, bugetul, defectele găsite live, verificarea adversarială;
- `M07_INSTALL_MANIFEST.md`: ce s-a instalat, versiuni, sha, rollback;
- `M07_SECURITY_READINESS.md`: cine ce poate, vocea, lanțul izolat, riscurile;
- `M07_USER_EXPERIENCE.md`: ce spui, ce vezi, cele două ecrane Lega.

## 1. Ce rulează acum și unde

**Hub V2 `2.8.0-m07`** pe `http://localhost:8011`, originea corectă (`127.0.0.1` te mută pe `localhost`).
- E pornit ca proces Windows independent (WMI), nu din sesiunea mea.
- Stare: **BUILD_SAFE**, sănătos.
- Fără execuții AI, fără granturi active, fără microfon deschis.
- Motorul vocal local pornește doar la cerere și se oprește după 30 de minute de inactivitate.

**Distribuția WSL `ifrim-runner`:** inactivă (doar `init`). Aici rulează writer-ul Codex, verificările, QA, preview-ul, E2E (Chromium) și review-ul Claude ale proiectelor de test.

**Politica D** (aprobarea (b), `host_isolation = environment`) e aprobată pe amprenta `8f9e9eeb934b6c01`. Niciun proiect real nu e pe această rută.

**Neatinse și încă pornite:** V1 (3004/8004) și OpenClaw. Aplicația ta Codex rulează separat de Hub.

**Te așteaptă:** pachetul de livrare D6 `bnd_murl82o1_00afe726c3` (nu l-am acceptat). Pachetul istoric Demo B `bnd_mupwze7b_e03f70f2d7` e neatins.

## 2. Ce spui ca să deschizi un proiect și să pornești o misiune de test

1. **Deschizi Hub-ul:** dublu-click pe `Ifrim Hub V2.cmd` sau `http://localhost:8011/#/lega`.
2. **„Hai să lucrăm la Factory Demo M07 (voce)”:** cockpit-ul proiectului, doar citire.
3. **Creezi misiunea**, într-unul din două feluri:
   - în sesiunea vocală Lega spui ce vrei construit; Lega propune misiunea și o aprobi pe ecran;
   - fără Lega: Misiuni → „Lucrare de engineering” → „Pregătește misiunea”.

   Un click; se creează doar ciorna (SPEC_DRAFT), fără execuții.
4. **„Arată-mi înainte să faci”:** planul exact, cu modelele, limitele și ce nu face niciodată.
5. **„Confirmă cu vocea” → „Da, execută planul”:** Hub-ul îți verifică vocea și transcrie local. Planul pornește, granturile se derivă singure, iar misiunea merge până la „Gata pentru verificare”.

## 3. Câte confirmări rămân după configurare

**Una pe plan:** pasul 5, vocal sau Enter/click în sesiunea Windows Hello.
- Crearea misiunii (pasul 3) e un click care nu pornește nimic.
- La TRUSTED, remedierile din limita planului nu cer nimic. La ASSISTED, fiecare remediere cere confirmarea diferenței.
- Rămân deciziile tale: orice oprire care îți cere decizia (inclusiv o încercare în plus), o fereastră nouă de timp, reluarea după o pauză pusă de tine, aprobarea politicii (b) și acceptarea pachetului.

**Măsurat live în D6:** 1 confirmare vocală a ta, 0 formulare de grant, 0 clicuri în Aprobări. Atenție:
- misiunea a fost creată și limitată de mine prin canalul `agent`, nu din propunerea Lega;
- după cele două opriri cauzate de defecte acum reparate (BLOCKED la 22:48 și NEEDS_OWNER_DECISION la 22:59 UTC), am reluat-o de două ori tot prin canalul `agent`;
- a doua reluare a ridicat limita la 2 încercări pe etapă, în cele 2 încercări pe probă permise de prompt. După revizie, un agent nu mai poate face asta: orice NEEDS_OWNER_DECISION e al tău.

## 4. Ce s-a instalat și ce s-a validat live

**Instalat (A1–B2):**
- bibliotecile Chromium și Playwright Chromium 1228 în `ifrim-runner`;
- Claude Code 2.1.285 Linux, ca reviewer izolat, cu login-ul tău;
- whisper.cpp 1.9.4 large-v3-turbo (CUDA) și modelul de vorbitor CAM++ în `C:\Users\mihai\IfrimHub\voice`, cu SHA-256 fixate în cod.

**PASS_LIVE:**
- **D4:** Stop într-o tură Codex reală în WSL. Întreruptă în 10,9 s, 0 procese rămase, 0 fișiere aplicate.
- **Reviewer Claude izolat:** 5/5 căi interzise refuzate de unealtă.
- **D5:** Windows Hello și profilul tău vocal.
- **D3 + D6:** misiunea completă, confirmată cu vocea ta. Încercarea 2 a trecut prin writer, verificări 11/11, review PASS, QA 5/5, preview și E2E pe mobil, toate în `ifrim-runner`, cu sandbox-ul Chromium măsurat activ. A ajuns la DELIVERY_READY (23:21:55 UTC), iar planul s-a închis singur.

**PASS_LOCAL:**
- **D1:** migrare, repornire, BUILD_SAFE (fără model, fără acțiunea ta).
- **D2:** atestarea C1–C20, 102 verificări.
- **D7:** „Hai să lucrăm la ProDelivery”, verificat prin rezolvitorul local și citirea cockpit-ului, doar în citire. Nimic inventat.

**PASS_SIMULATED / NOT_RUN:** D8 (față, hartă, explicații, reluare, taci/pauză/oprește) e acoperit de teste. Nicio sesiune Lega cloud nu a rulat (0/2).

**Politica D** e o decizie, nu o probă. Am aprobat-o la 23:23:35 UTC prin canalul `agent`, cu referința delegării tale (M07 §03), după dovada D6, pe amprenta `8f9e9eeb934b6c01` și atestarea `att_murgupen_3459ee8157`.

**Buget AI: 7 din 8 execuții** (Codex 4, Claude 3). Cel mult 2 încercări pe probă, 0 cicluri de remediere.

**6 defecte reale ale Hub-ului, găsite live și reparate** (detalii în `M07_LIVE_VALIDATION_RESULTS.md` §3):
1. liniștea strica profilul vocal;
2. „Arată-mi înainte să fac” era citit ca deschiderea unui proiect;
3. testele cu socket erau blocate de sandbox, așa că au primit fallback-ul doar-local;
4. o repornire pierdea modul planului;
5. la reluare, modul redat era luat drept schimbare manuală, iar legătura plan–mod se pierdea (Hub-ul a rămas în LIVE_VALIDATION până la repornire);
6. exportul era refuzat pentru bazele SQLite create de teste în foldere ignorate de proiect.

**Verificarea adversarială dinaintea commit-ului**, doar în citire, a avut două runde:
- **prima rundă** (84 de subagenți): 11 constatări de cod, toate reparate; 3 mecanisme respinse ca defecte, reparate oricum; 2 lacune găsite prin documente și închise în cod (agentul e limitat la proiecte de test, iar `setup/run` declarat `cli` e refuzat); 34 de corecturi de documente;
- **a doua rundă** (37 de subagenți, doar codul nou): 11 constatări, toate reparate. Cea mai importantă: un câmp fals adăugat într-o cerere ocolea limita la proiecte de test. Acum se verifică fiecare câmp, aprobarea politicii (b) nu mai e delegabilă, iar reluarea prin agent din NEEDS_OWNER_DECISION e refuzată;
- **a treia rundă** (12 subagenți): nimic nou pe canalul agent; 2 constatări low, reparate.

Mutanți: 30/30 prinși pe codul final.

Detalii în `M07_LIVE_VALIDATION_RESULTS.md` §4.

## 5. Ce mai necesită prezența ta fizică

- **Confirmarea fiecărui plan nou** (vocea ta sau Windows Hello).
- **Acceptarea pachetelor:** D6 `bnd_murl82o1_00afe726c3` și Demo B `bnd_mupwze7b_e03f70f2d7`.
- **O sesiune Lega cloud cu filtrul vocal** (D8 live), dacă vrei validarea ei. Ai 2 sesiuni de câte 10 min în buget și nu am folosit niciuna.
- **Decizia OneDrive:** baza Hub-ului (`.ifrim/private`) se sincronizează în cloud. O muți sau o excluzi (`M07_SECURITY_READINESS.md` §6).
- **Accesul la profilul vocal:** pe Windows, profilul moștenește citirea pentru grupul `CodexSandboxUsers`. Restrângerea cere un ACL sau o regulă de deny în profilul Codex, pe care nu le-am atins (`M07_SECURITY_READINESS.md` §5).
- **Opțional, pasul root:** mutarea binarelor Chromium/Claude sub `/opt`.
- **Re-atestarea** până pe ~2026-10-16 (atestarea expiră după 14 zile). O face „Rulează pașii automați”, fără tine, dacă amprenta nu s-a schimbat.

## 6. E pipeline-ul eligibil pentru un pilot real? Pe ce dovezi?

**Tehnic, da, în limitele de mai jos.** Dovezile:
1. Toate cele 6 etape rulează în `ifrim-runner`, atestate C1–C20 pe amprenta curentă.
2. O misiune completă a trecut live prin toate etapele, în mediu, până la DELIVERY_READY (D6).
3. Un Stop într-o tură reală lasă 0 procese și 0 fișiere aplicate (D4).
4. Reviewer-ul nu poate citi în afara copiei (proba live).
5. Exportul validat C14 aplică doar schimbări curate; fișierele de rulare binare din foldere ignorate sunt lăsate deoparte și afișate.
6. Politica D e aprobată pe aceeași amprentă.
7. Un agent nu poate pune singur un proiect real pe rută și nu poate porni lucru pe el.

**Ce mai trebuie pentru un pilot pe ProDelivery:**
- ruta `wsl-runner` și o autonomie peste OBSERVE pe proiect, setate de tine;
- un plan confirmat de tine;
- decizia OneDrive;
- cunoașterea riscurilor reziduale (`M07_SECURITY_READINESS.md` §3 și §5).

Proiectele reale ale clienților nu au fost atinse.

## 7. Commituri și push

Vezi secțiunea „Commit și push” de la sfârșitul acestui fișier (completată după push).

## 8. Teste și a doua rundă de verificare

Pe codul final (2026-10-03):
- **V2:** 596 de teste, 595 PASS, 0 FAIL, 1 omis. T25 e NOT_RUN: crearea unui symlink de fișier e refuzată de Windows (EPERM), iar ramura e acoperită de testul cu junction și de revizia sursei. Toate cele 61 de fișiere de test au rulat. Testele de pe modele sunt fixturi (PASS_SIMULATED); nicio execuție AI nouă.
- **V1:** 552 de teste, 551 PASS, 0 FAIL, 1 omis (canary symlink EPERM). Fișierele V1 nu s-au schimbat.
- **Mutanți:** 30/30 prinși pe codul final:
  - export: MX-1…8;
  - mod și reluare: MM-1…14;
  - canalul agent, setup și intenții: MS-1…8.

  Fiecare mutant a fost aplicat pe rând, testul țintă a picat, iar fișierul a fost restaurat octet cu octet.
- **Verificarea adversarială** (subagenți Claude Code, doar în citire, nu execuții ale Hub-ului):
  - runda 1: 84 de subagenți;
  - runda 2: 37 de subagenți;
  - runda 3: 12 subagenți.

  Fiecare constatare confirmată a fost reparată, cu test de regresie. Mecanismele rămase deschise sunt în `OPEN_ISSUES.md`.
- **Hub-ul live** a fost repornit pe codul final (2026-10-03 02:14 UTC):
  - `2.8.0-m07`, contract 7, BUILD_SAFE;
  - amprenta `8f9e9eeb934b6c01`, atestare validă, politica (b) validă, voice-first activă;
  - 0 granturi active, 0 execuții, `ifrim-runner` inactiv.

## Commit și push

- **M06** era deja în commit-ul `66487b9`, pe `origin/v2-milestone-01`.
- **Commit-ul M07** e `09f50b4` („M07: activation, local voice, agent channel and live validation (2.8.0-m07)”), pe `v2-milestone-01`, peste `66487b9`.
  - 99 de fișiere: codul, testele, scripturile de pornire și documentele M07.
  - Fără binare, modele, audio, embeddinguri, baze private sau backupuri. Am scanat caracterele de control și tiparele de secrete; singura potrivire e o cheie falsă de test, existentă deja.
- **Commit-ul de documentare** care conține acest rând urmează imediat după `09f50b4`.
- **Push: BLOCAT** de stratul de permisiuni al sesiunii (comanda `git push` a fost refuzată). Conform §26, nu am încercat alt canal.
- **`main`** a fost avansat **local**, prin fast-forward, de la `895c215` la vârful ramurii `v2-milestone-01`. Condițiile verificate înainte:
  - testele sunt verzi;
  - repo-ul e privat;
  - nu există workflows, webhooks, deployments sau environments pe GitHub (verificat prin `gh api`), deci un fast-forward nu declanșează niciun efect extern.
- **De rulat de tine**, ca să publici ambele ramuri:

  ```
  git push origin v2-milestone-01 main
  ```
