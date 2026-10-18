# Etapa „Repararea pasului 0 și recuperarea sigură a §25” (2026-10-11 08:52 → 15:50 UTC)

Prompt al proprietarului din 2026-10-11 08:52 UTC (thread „Reparare pas 0 și recuperare §25”). Nu începe M12; M12 rămâne DRAFT.
Roluri respectate: Claude coordonator (diagnostic, specificație, verificare), Codex implementare (`codex exec`, gpt-6-astra, efort high,
sandbox workspace-write), Claude într-o sesiune separată pentru review (agent read-only, două runde), QA determinist.

## Baseline

| Element | Inițial (08:53 UTC) | Final (15:50 UTC) |
|---|---|---|
| HEAD / origin | `b7bb54b` = `origin/v2-milestone-01` | `529cb83` (cod 2.14.8) = origin, plus commitul acesta de docs (local) |
| Live | `2.14.7-m11`, contract 13, schema 12, BUILD_SAFE | `2.14.8-m11`, contract 13, schema 12 (boot `boot_mv3weq4s_62da39313c`) |
| Fișierele proprietarului | 20 fișiere doar CRLF | neatinse |

## R-DIAG — cauze demonstrate (local, fără apeluri live)

Cele patru candidaturi respinse au fost reconstruite din baza Hub cu `parseAuthorOutput` + `assembleTestFile`, sha identic cu
`factory_reviews.change_set_sha` (`f29e00a0`, `899cec0d`, `cdfd3a69`, `239b04a5`), păstrate ca fixture în `v2/tests/fixtures/stage0-s25/`.
Rulate pe 12 (apoi 15) copii sintetice ale aplicației: originală, corectă (doar `phone` scos din maparea publică), refuză tot, pierde
telefonul, validare doar în browser, expunere publică, ocolire `includePhone`, scurgere sub altă cheie la `?debug=1`, listă goală, cerere
invalidă salvată, proprietate lipsă acceptată, valoare mascată, plus scurgere în text, ca cheie și cu cheie JSON escape.

1. **Export inventat** — `buildAuthorBrief()` impunea la FEATURE `assert.equal(typeof m.fn, "function")`; autorul a inventat `publicBooking`
   / `publicBookingView`. c1, c3, c4 pică **și pe aplicația corectă**, opriți la export, înaintea oricărei cereri HTTP; `classifyProof()`
   accepta acel `ERR_ASSERTION` ca PROVEN. Codex a avut dreptate.
2. **Rescriere fără candidatul anterior** — c2 (singura care discriminează) a pierdut verificarea valorii în tot corpul la parametri anonimi:
   scurgerea sub altă cheie la `?debug=1` trece de c2 și e prinsă de c1. Niciuna nu trimitea o cerere fără proprietatea `phone`.
3. **STALE fără cod schimbat** — `dlv_mv1eo8oo_d120460140` READY → STALE la 03:44:52 (91 s după confirmare), `software_changed`, changedFiles =
   copia retrasă, jurnalul, candidatul din staging și testul vechi lipsă. Retragerea R-SUP se făcea la pornire, înaintea pasului 0; writer-ul
   nu a pornit niciodată (0 change set-uri). Opririle nu au fost cauzate de CPU (setup-ul invalid se reproduce determinist).

## 2.14.8-m11 (commit `529cb83`, fără migrare, contract 13)

- **R-PROOF**: antetul Hub are `need(m, "nume")` și `setup("etichetă", fn)` (mesaje `HUB_SETUP`); colectorul TAP păstrează primul cadru din
  stivă; fiecare eșec are linie, instrucțiune și origine (setup / behaviour / new_api); setup nu e niciodată red comportamental
  (`setup_failed`), un eșec fără cadru verificabil e INCONCLUSIVE `provenance`; lint: `export_existence_assert`, `export_missing_undeclared`;
  specificațiile derivate din comportament existent poartă `changesExisting` (fără API nou); FEATURE cu API nou doar declarat în `newApi`.
  Criteriile hide_public sunt explicite (tot corpul, id-ul programării create, proprietate lipsă / gol / spații, nimic salvat).
- **R-REWRITE**: autorul primește candidatul anterior (sha, ciclu), manifestul, dovada, verdictul, constatările și un inventar al aserțiunilor;
  eliminările se declară în `removed`; reviewer-ul răspunde `kept | replaced_correctly | lost` pentru fiecare; `lost` → CHANGES_REQUESTED.
  Comparația deterministă identifică doar verificările scoase; echivalența e judecata reviewer-ului (nu certificare semantică).
- **R-LIFECYCLE**: testul vechi se retrage doar la protejarea noului test (după PROVEN + review PASS), în același lease/snapshot; orice eșec
  restaurează verificat; writer-ul e refuzat fără protecție înregistrată; compensare doar la oprire finală înainte de writer; boot-ul restaurează
  retragerea anticipată 2.14.7 fără a abandona autorul; jurnal cu istoric, restaurare atomică (`linkSync`), restaurare incompletă blochează.
- **R-STALE**: `driftProvenance` — o cale e a Hub-ului doar cu proveniență verificată (staging scris de Hub, jurnal egal cu planul din DB,
  retragere înregistrată, test protejat); BASELINE nu mai invalidează, ci primul change set cu modificări; `reconcileStale` STALE → READY
  doar pe dovezi (cauză, drift software zero, inventarul căilor, writer nepornit, hash-uri de octeți ale tuturor dovezilor, fără livrare mai
  nouă), într-o tranzacție, cu eveniment `delivery.stale_reconciled`; aprobările creative neatinse.

Review Claude separat: runda 1 CHANGES_REQUESTED (F1 typeof legitim clasat setup; F2 revocarea bloca misiunea; F3–F8), runda 2 a confirmat
F1–F8 + C1 și a găsit N1 (`recover()` sărea BLOCKED); toate reparate de Codex. C1 (coordonator): retragerea testului protejat după writer,
readusă la comportamentul dinainte.

## Teste

- Noi: 66 de cazuri S0R-01…41 (`v2/tests/r-stage0-repair.test.mjs`) + S0R-30 în wave-b; fixture-uri actualizate explicit pentru noul protocol
  (`m11-l5-test-first`, `m11-l5-factory-stage0` I5 / repair 3, `r-closure` ROLL-03/REV-01, `r-priv-rev` RP-01, `m11-pilot-fixes` M11-PF-01,
  `stage-finalizare` FZ-04, versiunea INT-05). Nicio aserțiune slăbită (verificat în review).
- Afectate (13 fișiere, în afara sandbox-ului): 266/266 PASS. `build:v2` exit 0.
- Regresia V2 completă (11:54 → 12:59 UTC, CPU mediu 66 %, 65 de eșantioane): 1836 teste, 1832 PASS, 1 SKIP (T25), 3 FAIL — M11-PF-01 și
  FZ-04 (fixture-uri vechi incompatibile cu noul protocol; reparate, 14/14 PASS) și RM-10 (captură reală, 255 în loc de 256 de cadre sub
  încărcare; izolat: FAIL o dată, apoi PASS). V1 nu a fost reluat (în afara schimbării). Regresia NU e integral verde.
- Matricea locală: candidatul de referință pe noul protocol trece pe aplicația corectă și respinge toate cele 13 variante defecte.

## Release

- Backup verificat înaintea upgrade-ului: `bkp_mv3u40gg_1d92338e23` (Hub + hub-v2, 1048 fișiere), `bkp_mv3u3rlu_d5c91bbe55` (proiectul §25).
- Upgrade (`upgrade.mjs --apply`) și `git push` refuzate agentului (classifier „[Production Deploy]”, regula Bash pentru push); rulate de
  proprietar ~14:08 UTC. Live `2.14.8-m11`, origin `529cb83`.
- La pornire: `factory.retire_restored` pentru `mis_mv2ql0fp_ee35f8071e` (testul `butonul-de-programare-trebuie-sa-84f571.test.mjs` înapoi,
  sha `8d944644…`, jurnal RESTORED cu istoric). `reconcileStale` pentru `dlv_mv1eo8oo_d120460140` **refuzat**: fără inventar de căi în evenimentul
  vechi și fără hash de octeți pentru pachet și cele 3 capturi E2E; driftul software al părintelui e însă zero. Părintele rămâne STALE.
- LightingService: Running / Automatic după repornirea de la 08:02 UTC; nimic de restabilit, setările de pornire neschimbate.
  WmiPrvSE ≈ 2,7 nuclee (citire delimitată), sursă tot neidentificată.

## Proba live §25 (una singură)

Plan pregătit prin `factory.refine_test` (canal cli) pe `mis_mv3b251g_754a6a2159` (oprită → CANCELLED): card `env_mv3wfqmy_e139f9baef`,
misiune `mis_mv3wfpyy_d440c4ec5c`, livrare-copil `dlv_mv3wfqkl_14bc4f88fd` (părinte `dlv_mv1eo8oo`). Confirmat de proprietar (click) 15:28:46 UTC.

| Pas | Rulare | Rezultat |
|---|---|---|
| Autor (Claude sonnet, doar citire) | `run_mv3za9be_a73edb3f49` | candidat `8b940d9b` |
| Dovada Hub (2 rulări) | `evd_*` 15:35 | PROVEN; AC-1/AC-2 pică pe comportament (L76, L99: `"phone"` în corp) |
| Verificare (Codex gpt-6.1-sol, doar citire) | `run_mv3zitzf_987830bb1c` | CHANGES_REQUESTED: programări existente, escape JSON, id în listă |
| Rescriere (Claude) cu varianta anterioară | `run_mv3zk0cy_68110987d6` | candidat `8a4fd87d`; 6 verificări scoase, toate declarate |
| Dovada Hub | `evd_mv3zpung_1d5400c854`, `evd_mv3zpvos_0a8e0eacc0` | PROVEN |
| Verificare (Codex) | `run_mv3zpvpq_224f49de21` | CHANGES_REQUESTED: P77 și P100 `lost` |

Oprire 15:41:32 UTC (`exhausted`), NEEDS_OWNER_DECISION; plan WAITING_OWNER, expiră singur la 18:58:46 UTC; livrarea-copil ARMED se închide cu el.
Nicio rafinare automată (misiunea e deja rezultatul unei rafinări). Nimic retras (retragerea așteaptă protejarea), testul vechi în suită, 0 change
set-uri, nicio implementare, nicio captură. Aprobarea creativă: neatinsă.

**Diagnostic** (local, aceleași variante): ambele candidaturi live trec pe aplicația corectă și resping toate cele 10 variante defecte de bază.
Rescrierea a înlocuit verificările de subșir (`body.includes(PHONE)`) cu o comparație de egalitate pe JSON-ul decodat; scurgerile în text
(`"Tel 0700 … (sună)"`) și ca cheie (`{ "0700 …": true }`) trec de rescriere și sunt prinse de prima variantă. Mecanismul R-REWRITE a funcționat:
inventarul a arătat eliminarea, reviewer-ul a marcat-o `lost`, testul mai slab nu a fost protejat. Cauza rămasă: o verificare criticată ca
insuficientă a fost înlocuită, nu completată, iar o singură rescriere nu permite corecția.

Rulări reale de model în etapă: 2 Claude autor + 2 Codex verificator (toate doar citire); implementarea Codex a etapei (5 rulări `codex exec`
pe repo, în afara Hub-ului) și review-ul Claude (agent separat, 2 runde).

## Decizii rămase (proprietar)

1. Corecția candidată, neimplementată: o verificare criticată ca insuficientă se completează (păstrată + verificare nouă), se înlocuiește doar
   una numită greșită; eventual a doua rescriere numai când reviewer-ul a marcat `lost`. Necesită aprobarea ta înaintea unui nou plan.
2. Planul `env_mv3wfqmy_e139f9baef` expiră singur; nu am cerut alt plan identic.
3. Părintele `dlv_mv1eo8oo` rămâne STALE (dovezi vechi fără hash); livrarea nouă îl va înlocui după un §25 reușit.
4. Regresia: RM-10 sensibil la încărcare; M12 rămâne DRAFT.
