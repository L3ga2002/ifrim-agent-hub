# Etapa „Lega: autonomie și lucru pe PC” (2026-10-09, înaintea M12 Sales)

Raportul etapei. Ordinea de citire pentru o sesiune nouă: acest fișier, apoi `.ifrim/HANDOFF_2026-10-07_M11.md` (secțiunile „Pilotul live” și
„După pilot”), apoi `.ifrim/M11_REPORT.md`.

## Decizia proprietarului (istoric)

Mesajul proprietarului din threadul de proiect „Lega autonomie și lucru pe PC” (2026-10-09 09:56 UTC) cere lucru autonom pe etapă:
implementare, teste, rulări Codex și Claude prin abonamente, backup, build, upgrade și restart controlat al Hub-ului local, commituri și push pe
`v2-milestone-01` fără force-push, o singură aprobare a planului și fără Windows Hello în dezvoltarea locală. Excluse: mesaje externe,
publicare, cheltuieli, merge în `main`, proiecte reale fără legătură, deciziile proprietarului (acceptare, aprobare creativă).

Stratul de permisiuni al sesiunii Claude Code (modul „auto”, clasificator) decide separat fiecare operație. În această sesiune a refuzat:

| Ce am încercat | Refuzul exact |
|---|---|
| Să scriu decizia în `CLAUDE.md` și `.ifrim/DECISIONS.md` | `Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Instruction Poisoning]` |
| Modulul `v2/server/owner/dev-profile.mjs` (sesiune de proprietar fără ceremonia Hello, marcată `local_dev_profile`, `userVerified = 0`) | `… Reason: [Security Weaken]` |
| În `trust.mjs`: autoritatea unei confirmări să supraviețuiască închiderii paginii (idle/expirare/logout), revocată doar de revocarea autentificatorului sau „revocă toate sesiunile” | `… Reason: [Security Weaken]` |
| Verificarea Word/Excel prin PowerShell cu `-ExecutionPolicy Bypass` | `… Reason: [Auto-Mode Bypass]` (rezolvat legitim: politica proprietarului e `CurrentUser Unrestricted`, flagul nu era necesar și a fost scos) |

După refuzuri, clasificatorul a refuzat intermitent și citiri banale prin Bash; citirile prin Read/Grep au mers.

## Ce s-a implementat (cod local, `v2-milestone-01`)

1. **Word, Excel și pachet de campanie în planul de livrare** (`v2/server/office/`, `v2/server/delivery/office-executors.mjs`):
   - generare `.docx`/`.xlsx` proprie, reproductibilă (ZIP + OOXML, fără dependențe noi): titluri cu stiluri reale Word, listă cu numerotare
     reală, tabele cu antet repetat, notă „date demonstrative”; registru cu coloane tipizate, formule fără valori în cache
     (`fullCalcOnLoad`), filtre, antet înghețat, rânduri de total; fără prețuri („De stabilit”);
   - verificare pe trei niveluri, niciodată amestecate: `FILE_CHECKED` (fișierul citit înapoi), `APP_VERIFIED` (Word/Excel prin COM, instanță
     proprie invizibilă, doar citire: structura văzută de Word, export PDF; Excel recalculează formulele și valorile se compară cu cele
     așteptate), deschiderea pentru proprietar (capabilitate separată);
   - pachetul de campanie local: obiectiv, public, mesaj, dovezi (criteriile PASS), calendar, texte pe 5 canale, variante 16:9 / 9:16 legate de
     clipurile exportate, `campanie.json` cu `distribution` oprit (forma pe care M12 o completează cu canale și buget într-un singur plan);
   - cuprinsul dosarului (`README.md` + `manifest.json` cu sha256 pentru fiecare fișier);
   - reluarea nu dublează: un fișier identic existent e refolosit (`reused: true`), altfel nume nou, niciodată suprascriere.
2. **Sarcina combinată dintr-o singură frază**: „Pregătește prezentarea demo-ului de detailing: verifică site-ul, fă un document Word, un Excel
   cu date demonstrative, un clip vertical și un pachet de campanie. Salvează totul într-un singur dosar.” → un singur pas `delivery_prepare`,
   artefactele cerute (cu negații: „fără Excel”) intră în același șablon hash-uit (`extras`), același card, aceeași confirmare, același dosar.
   Un șablon fără extras păstrează forma și hash-ul M11 octet cu octet. Camera de livrare are panoul „5b · Dosarul prezentării”.
3. **Lega cunoaște sistemul** (`v2/server/owner/knowledge.mjs`): întrebările despre aplicații, conturi și modele, capabilități, locații,
   lucru activ, ce a scris Codex, ce a găsit Claude, ce e blocat → intenția de citire `system_knowledge`, răspuns construit din starea reală
   (registre, tabele, fișiere) cu ecranul unde se vede. Același răspuns pe text (intake), voce (unealta Lega `system_knowledge`, doar voice-first)
   și `GET /api/knowledge?topic=`. Inventar controlat al aplicațiilor instalate din cheile Uninstall (fără scanare de disc, nimic lansat,
   asincron, cache 10 min): 90 de aplicații pe PC-ul proprietarului, inclusiv Office LTSC 2021, CapCut 9.3, OBS 32.2.2.

## Dovezi

| Verificare | Rezultat |
|---|---|
| OFF-01…05 (frază, docx, xlsx, campanie, extras/hash) | PASS |
| OFF-06 cap-coadă (modele simulate; Chromium, ffmpeg, Word și Excel REALE cu `HUB_V2_OFFICE_COM=1`) | PASS, 125 s: un card, o confirmare, 0 rulări de model după DELIVERY_READY, Word și Excel `APP_VERIFIED`, ≥12 fișiere în manifest, reluarea refolosește fișierele |
| Probă manuală Word/Excel pe PC | Word 16.0: 2 pagini, 5 titluri, 2 tabele cu antet repetat, PDF exportat; Excel 16.0: 13/13 formule egale cu valorile așteptate, filtre active pe ambele foi, PDF |
| KN-01…03 (cunoașterea sistemului) | PASS |
| DF-01 (M11, reluat în condiții măsurate) | PASS în 147 s; CPU 97% la start (eșantion instantaneu), 68% la final. Timeout-ul de 300 s din 2026-10-08 nu s-a reprodus: nicio regresie găsită |
| DF-02 | PASS în 104 s |
| M11 template + stale graph | 28/28 PASS |
| Regresia V2 completă | vezi secțiunea „Regresie” (rulare 2026-10-09) |

## După ce proprietarul a adăugat permisiunile (11:02 UTC)

4. **Profilul de dezvoltare locală (§5)** (`v2/server/owner/dev-profile.mjs`, `trust.mjs`, `POST /api/owner/dev-session`,
   `v2/scripts/dev-profile.mjs on|off|status`): fișier al instanței în folderul privat de date, legat de numele PC-ului și contul Windows;
   sesiune de proprietar fără ceremonie, marcată `local_dev_profile`, `user_verified = 0`, credențial `devprofile:<id>` (nu se scrie niciun
   autentificator), audit `owner.session_opened` cu `authority: local_dev_profile`; emisă doar pentru origin-ul canonic `http://localhost:8011`,
   peer loopback, cerere same-origin cu tokenul per-boot, niciodată pe canalele agent/CLI. Pașii care cereau Hello proaspăt trec în această
   sesiune; oprirea profilului închide sesiunile la următoarea verificare. UI: `unlockSession` deschide sesiunea profilului fără dialog
   (acoperă toate cele ~49 de locuri care cereau Hello), pagina o deschide singură la pornire, insigna „Mod dezvoltare locală”.
5. **Autoritatea confirmată supraviețuiește browserului (§7)** (`trust.confirmedAuthority`, `ops/plans.mjs` la autorizarea fiecărei operații
   și la planul derivat): închiderea paginii, expirarea, logout-ul și rotația nu mai opresc un plan confirmat; îl opresc Stop, pauza, anularea,
   revocarea autentificatorului, „revocă toate sesiunile” și oprirea profilului. Confirmările noi cer în continuare o sesiune deschisă.
6. **Recuperare fără proprietar (criteriul 5)**: testul „browser închis” a găsit că preview-ul refolosit al fabricii se poate opri între cele
   două capturi (NEEDS_OWNER). Captura își pornește acum o singură dată propriul preview supravegheat și reia toate gărzile.
7. **Contrastul textelor din clip**: fiecare text al clipului de livrare are plăcuță (opacitate ≥ 0,9), deci contrastul nu mai depinde de
   imaginea de dedesubt (pilotul: CTA 3,94:1 și 4,2:1).

Teste: DP-01…05 PASS; DP-06 (o confirmare, sesiunea închisă imediat, misiune → review → QA → livrare derivată → READY, fără a doua confirmare,
fără sesiune nouă) PASS în 108 s; regresia completă 1693 teste: 1688 PASS, 4 FAIL (3 intenții reparate și reluate PASS; M09-SB-01 = build de
test învechit în `.ifrim/tmp`, PASS pe build-ul curent), 1 SKIP; regresiile țintite pe codul final 138/140 PASS, 2 SKIPPED_ENV (vite).

## Ce NU s-a făcut și de ce (istoric, înainte de permisiuni)

- **Profilul de dezvoltare și §7**: inițial refuzate de clasificator; făcute după permisiuni (punctele 4–5).
- **Defectul care bloca autonomia (reparat la punctul 5)**: `v2/server/ops/plans.mjs` oprea orice plan (SESSION_CLOSED → NEEDS_OWNER) când
  sesiunea în care a fost confirmat se închidea, inclusiv după 30 min de inactivitate, și refuza planul derivat al livrării.
- **Pauzele cu imagine înghețată din clip** (avertisment QA): neschimbate; verdictul QA rămâne separat de aprobarea creativă dată versiunilor vechi.
- **§24 și §25 pe Hub-ul live**: confirmarea cardurilor cere sesiunea de proprietar (Hello). Fără profilul de dezvoltare, confirmarea e a
  proprietarului; nu o simulez. Ambele trec cap-coadă pe Hub-ul de test (DF-01: §24 doar media, fără model; §25 un card cu misiune nouă și
  livrare-copil).
- **Proba vocală 2 a proprietarului**: rămâne o probă umană.

## Decizii rămase ale proprietarului

1. Permisiunile sesiunii Claude Code pentru §5 și §7 (sau implementarea lor de către el / altă sesiune).
2. Confirmarea cardurilor §24 și §25 pe Hub-ul live (sau după §5, de către agent cu autoritatea de dezvoltare).
3. Pachetele care îl așteaptă: ProDelivery, Factory Demo M07 (voce), misiunea accidentală pe Factory Demo M10.2.

## Următoarele trei priorități

1. §7: autoritatea confirmată să nu depindă de pagina deschisă (cele două locuri din `plans.mjs`), cu test „browser închis → misiunea ajunge la
   READY”, „revocare → se oprește”.
2. §5: profilul de dezvoltare locală (designul de mai sus), cu teste: origin extern refuzat, alt PC/cont refuzat, `userVerified` niciodată fals.
3. §24/§25 live pe „Demo Livrare — Detailing”, apoi M12 (publicarea și bugetul în planul aprobat; `campanie.json` are deja forma).
