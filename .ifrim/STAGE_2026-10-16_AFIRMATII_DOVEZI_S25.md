# Etapa „Închiderea livrării §25: afirmații, dovezi și artefacte corecte” (2026-10-15 21:50 → 2026-10-16 02:45 UTC)

Promptul proprietarului: thread-ul „Afirmații și dovezi corecte §25”, 2026-10-15 21:50 UTC. Decizii: reparăm asocierea afirmațiilor cu
specificația și dovezile; corectăm prin versiuni noi rezumatul și clipurile livrării existente; păstrăm fluxul pasului 0; documentăm
separat simplificarea autorului; M12 rămâne DRAFT.

**Rezultat pe scurt.** Codul 2.14.17-m11 (contract 13 aditiv, schema 12, fără migrare) leagă fiecare afirmație afișată clientului de
criteriile specificației aprobate prin amprente canonice de conținut și o verifică pe dovezile pachetului livrării, pe metodă; prezentarea
se îngheață în șablon; o corectură explicită și versionată (`delivery.correct`) refilmează și reface clipurile și rezumatul livrării
§25. Trecut prin poarta finală și îmbinat (`cfc58a7`). Upgrade-ul gestionat și push-ul au fost refuzate agentului de stratul de
permisiuni: comanda pentru proprietar e în §9. Cardul de corectură apare singur după upgrade; confirmarea lui e a proprietarului.

## 1. Baseline (21:50–22:05 UTC)
- `v2-milestone-01` = `bedda1d` (local = origin); live `2.14.16-m11`, contract 13, schema 12, `boot_mv9zgg11_ebe5510cca`, BUILD_SAFE.
- `dlv_mva09x21_b0b0cbfb2a` READY; pachetul `bnd_mva0hc23_b3d65a8da9` READY_FOR_OWNER_ACCEPTANCE (sha `43ad3531…`, recalculat = stocat);
  specificația aprobată v1 `a69b8e9f…` (hash recalculat = stocat); rezumatul v1 neaprobat; clipurile v1 cu aprobarea creativă PENDING.
- Clona `C:\Users\mihai\hub-rc`, ramura `claude/project-thread-98qmet` din `bedda1d`. Cele 20 de fișiere ale proprietarului: neatinse.

## 2. Roluri
Claude (Opus, această sesiune): coordonare, specificații (`C:\Users\mihai\s25-claims\SPEC_2.14.17_{A..F}.md`), verificare, integrare.
Codex (`codex exec`, gpt-6-astra, efort high, workspace-write, pornit detașat prin WMI cu node de sistem): 6 runde de implementare.
Review independent Claude: 3 workflow-uri (recenzori doar-citire, un sceptic pe constatare, critic de completitudine). Investigația
inițială: 6 cititori + critic (rapoarte `C:\Users\mihai\s25-claims\inv-*.txt`).

## 3. Ce s-a găsit
- **Cauza citărilor greșite:** textele clipului și ale rezumatului erau condiționate de ID-urile specificației INIȚIALE a fixture-ului
  (`booking-demo-def.mjs`), iar executorii recitreau fixture-ul curent la rulare (`executors.mjs blockOf`, `delivery.mjs renderDocument`).
  QA factual verifica doar existența afirmației. Exemple: „Corectura a fost verificată de un reviewer independent. (verificat: AC-4)” cu
  AC-4 = „telefon salvat exact”; clipul „AC-1 + AC-6: interval ocupat → indisponibil (390 px)” cu AC-1 = lista publică, AC-6 = preview.
- **Defect nou, în filmare:** ambele capturi au tastat telefonul de două ori („0700 123 4560700 123 456”, verificat pe cadrele
  `demo-16x9-v1.mp4`; sesiunile `mcs_mva0hcmt`, `mcs_mva0hxjh`, pasul 20 HOLD_POSTCONDITION_FAILED). Cauza: compunerea criteriilor nu era
  idempotentă peste două generații de revizie (câmp obligatoriu, apoi confidențialitate), deci AC-7/AC-8/AC-10 au perechea
  etichetă+completare de două ori; E2E înlocuiește valoarea, captura o adăuga. Toate cele 8 specificații hide_public din 10-10 au dublura.
  Corectura trebuie deci să refilmeze (capturile nu sunt valide).
- Word/PDF și campania citează corect criteriile noi, dar numesc clipurile v1. Linkul „Deschide livrarea care o înlocuiește” arăta cel mai
  nou copil, indiferent de stare.

## 4. Cod: 2.14.17-m11 (`ca8b42e` A, `bb8b6c6` B, `c190a88` C, `112764c` D, `2d52350` E, `e73b9d6` F, `b1db203` teste; îmbinat `cfc58a7`)
- **Amprenta criteriului** (`v2/server/media/claims.mjs`): sha256 canonic peste metodă, text normalizat, `testRef`/`kind`/`guard`/
  `expectFailure` (test), pașii exacți (e2e), comanda de preview; FĂRĂ id și `origin`. O renumerotare păstrează amprenta; orice schimbare de
  sens sau de metodă o schimbă. **Dovada pe metodă** (`criterionProof`): sha-ul manifestului = al pachetului livrării, sha-ul specificației,
  status exact (PASS_EVIDENCE / PASS_REVIEW), dovezi nestale pe change set-ul pachetului, QA cu comanda testului protejat și lanțul testului
  scris de Hub, e2e cu pașii și comanda `e2e <id>`, review de cod (nu review-ul testului de la pasul 0).
- **Prezentări curate** (`booking-demo-def.mjs`, `delivery/presentation.mjs`): `booking-mobile-fix` pentru specificația proprie a
  fixture-ului (ieșire identică byte cu byte cu 2.14.16) și `phone-privacy` pentru specificația §25 (amprente fixate, recalculate de teste
  din copia exactă `v2/tests/fixtures/s25-spec-a69b8e9f.json`). Rezolvare numai prin amprentă: asociere ambiguă, criteriu lipsă sau probă
  insuficientă → afirmația NU se afișează și motivul apare în „Ce nu putem afirma”. Fără model, fără potriviri aproximative. Specificații
  necuratoriate → texte generate legate prin construcție de criteriile capturilor.
- **Înghețare:** prezentarea rezolvată intră în șablon la PLANNED; executorii și rezumatul nu mai citesc fixture-ul; șabloanele vechi
  primesc prezentarea generată din specificația lor aprobată (calculată la propunere, nu la execuție; planurile rulează exact parametrii
  hash-uiți).
- **QA factual** pe text: elementele de text din IR poartă `claimIds` (câmp opțional, fără valoare implicită: hash-urile versiunilor
  stocate neschimbate); afirmațiile au dovezi `criterion` (specSha#id + amprentă), `display` (sha-ul fiecărui text afișat: ambele tonuri și
  suprascrierile verticalei), dovezile reale pe tip; coduri noi cu timecode (TEXT_CLAIM_MISSING, CLAIM_CRITERIA_MISMATCH,
  CLAIM_CRITERION_CHANGED, CLAIM_CRITERION_NOT_PASS, CLAIM_TEXT_UNBOUND, …), `QA_VERSION` 2; `summaryFactCheck` refuză orice citare
  nelegată; un FAIL factual oprește exportul.
- **Corectura `delivery.correct`** (`delivery/correction.mjs`): audit (texte, rezumat, capturi), înregistrare imutabilă cu sha, card
  propus de Hub (fără efect, fără autoritate; numai proprietarul confirmă), 13 pași (prepare, preview, refilmare desktop + telefon,
  montaj nou ca versiune nouă în același proiect de editare, randare, verticală, export v2, rezumat v2 pe bazele „claims” + „media” cu
  secțiunile proprietarului păstrate și marcate „de revăzut”, Word/campanie păstrate prin dovadă de reconstrucție sau scrise cu nume v2,
  manifest-v2 cu CURRENT/SUPERSEDED, finish). APPLIED numai la final; orice oprire după pornire → NEEDS_OWNER cu card de continuare.
- **Reparații punctuale:** compunerea câmpului idempotentă (și perechile moștenite dublate restrânse), captura nu mai filmează a doua
  completare identică și golește câmpul înainte de tastare doar dacă are valoare, criteriile preview/e2e moștenite nu se mai pierd
  (`slice(0,4)`), linkul de înlocuire = cel mai nou descendent valid (READY / în lucru; niciodată EXPIRED/CANCELLED/PLANNED), statusul
  livrării verificat și pentru planurile de revizie, `displayedSha` la editarea rezumatului, fraza vorbită a Legăi din prezentare.

## 5. Review-uri și reparații
| Review | Agenți | Confirmate | Reparate în |
|---|---|---|---|
| Partea A | 16 | 3 minore + 1 critic + 1 al coordonatorului (suprascrierile vechi substituite la execuție = alt conținut decât hash-ul cardului) | C |
| Partea B | 25 | 12 + critic (blocare NEEDS_OWNER după un eșec târziu; anularea unui card nepornit retrograda livrarea; supersede global) | D |
| Final (C+D, upgrade pe copia datelor live, artefacte) | 11 | 7 (blocare după un card de continuare expirat; reverificarea periodică eliminată din greșeală; formulări) | F |
Runda E: formulări din proba pe datele live (problema citează cerințele, nu „verificat”; „Cum funcționează” cu o singură linie de dovadă).

## 6. Poarta finală (pe `e73b9d6` + `b1db203`, 01:03–02:35 UTC, CPU 54–99 %)
| Comandă | Rezultat |
|---|---|
| `npm run build` | 0 |
| `npm run build:v2` | 0 |
| `npm run test:v2` | 2204 teste: 2200 PASS, 2 FAIL numai de test (INT-05 fixa versiunea 2.14.16; stub-ul M11-PF-01 fără `effectiveTemplate`) → reparate în `b1db203`, rerulate singure 5/5 și 3/3; 2 SKIP (T25 privilegiu symlink; M09-SB-01 fără build-ul Studio în clonă → construit și rerulat singur 1/1); 0 anulate |
| `npm run test` (V1, folderul Hub; cod V1 identic cu `bedda1d`) | 552: 551 PASS, 0 FAIL, 1 SKIP (symlink) |
| procese rămase create de poartă | 0 |

## 7. Probă pe o copie a datelor live (fără efect; `correction-dry-run.mjs` pe `VACUUM INTO` + `v2-media`, cod final)
- 21 de texte afectate (30 de constatări): hook / desktop / mobil în 16:9 și 9:16, problema, 4 rânduri „Ce demonstrăm”, 4 „Cum
  funcționează”, 3 „Beneficii”, ambele capturi (CAPTURE_STEPS_OUTDATED: pasul 13 completare repetată; CAPTURE_POSTCONDITION_FAILED).
- Card: 13 pași (prepare, preview, captură desktop, captură telefon, montaj, randare 16:9, verticală, export, rezumat, Word, campanie,
  index, finish), refilmare pentru ambele roluri; textele noi și rezumatul previzualizat sunt în raportul final (§9 al thread-ului).
  Dovada: `C:\Users\mihai\s25-claims\dryrun-f.json`.

## 8. Integrare și release
- Backup verificat înainte de îmbinare: `bkp_mvacxszx_e1d7098238` (2026-10-16 02:37:37Z, baza de date integrity ok).
- Îmbinare: `cfc58a7` (merge --no-ff) pe `v2-milestone-01`; arborele = cel trecut prin poartă (`git diff b1db203 cfc58a7` gol).
- Revenire verificată: `git revert -m 1 cfc58a7` redă exact arborele `bedda1d` (verificat într-o clonă); plus
  `node v2/scripts/upgrade.mjs --apply`, sau restaurarea backup-ului. După ce corectura rulează, versiunile noi de montaj (cu `claimIds`) nu
  mai pot fi citite de 2.14.16: atunci revenirea se face prin backup sau printr-o reparație înainte.
- **Refuzate agentului:** upgrade-ul gestionat („Permission for this action was denied by the Claude Code auto mode classifier. Reason:
  [Production Deploy].”) și push-ul („Permission to use Bash with command … git push -u origin claude/project-thread-98qmet 2>&1 has been
  denied.”). Proprietarul le rulează cu `C:\Users\mihai\s25-claims\owner-release.cmd`.
- Live rămâne `2.14.16-m11` până la acea comandă; arborele de lucru are deja 2.14.17: o repornire a PC-ului l-ar porni prin autostart fără
  upgrade gestionat (același risc ca în etapele anterioare).

## 9. După upgrade (al proprietarului)
- Hub-ul propune singur cardul „Corectură afirmații (clip + rezumat)” pentru `dlv_mva09x21_b0b0cbfb2a` (o dată pe versiune; vizibil în
  camera livrării și în „Deciziile mele”); confirmarea e a proprietarului (Windows Hello). Rezultate așteptate: `demo-16x9-v2.mp4`,
  `demo-9x16-v2.mp4`, `rezumat-v2.md/.html`, `Prezentare demo v2.docx` + PDF și `Campanie v2` (sau păstrate prin dovadă), `manifest-v2.json`,
  `README-v2.md`; versiunile v1 rămân neschimbate; aprobările creative și a rezumatului se dau din nou; software-ul, pachetul și
  specificația rămân neatinse.
