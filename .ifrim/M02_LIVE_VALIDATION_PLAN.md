# M02 — Plan de validare live (§29)

Stare: **LIVE_VALIDATION_PENDING**. Nimic din acest plan nu a fost executat.

Aprobările istorice din Milestone 01 nu se reutilizează. Fiecare pas marcat „aprobare” cere un „da” explicit pentru acea acțiune exactă.

## Ce autorizează și ce nu

- Autorizează, per pas: acordul ACL Codex, verificarea contului, un turn read-only per provider, eventual un handoff ca test separat.
- **Nu** autorizează: instalări (Playwright, motor vocal), fallback plătit, schimbarea permission mode global, bypass/skip-permissions, ștergerea regulilor deny, commit/push/deploy, alte proiecte.

## 0. Precondiții (verificabile în UI, fără model)

1. Hub pornit (`npm run v2`), `2.2.0-m02`, BUILD_SAFE, poartă suspendată.
2. Backup verificat prin restaurare (Setări → Backup acum, sau automat de poartă).
3. Atestările de facturare valabile (≤30 de zile), înregistrate 2026-09-30.
4. Integrări → Izolare: Claude read-only „permis · limită unealtă”; Codex blocat până la pașii 1–2.

## 1. Codex — acord ACL (aprobare)

1. Integrări → Izolare → deschide lista de căi (16 pe acest calculator, amprentă `9cab02fd58238507`).
2. Citește lista. Tastează textul de acord afișat și apasă „Înregistrează acordul pentru această listă”.
3. Efect: poarta nu mai blochează pentru lipsa acordului. Nu se aplică încă niciun ACL.

## 2. Codex — preflight real, fără model (aprobare, schimbă ACL-uri)

```bash
node v2/tests/manual/codex-real-profile-preflight.mjs --consent-fingerprint=9cab02fd58238507
```

- Așteptat: `PASS_LOCAL` (runner OK; `.ifrim/private`, `.ifrim/BACKUPS`, `~/.codex/auth.json`, `~/.ssh` DENIED; README și `.sandbox-bin` ALLOWED).
- Oprire: orice FAIL → ruta Codex rămâne blocată. Nu se continuă și nu se relaxează profilul.
- Revenire, dacă vrei să elimini ACE-urile: `icacls "<cale>" /remove:d CodexSandboxUsers` pentru fiecare cale din listă.

## 3. Verifică contul (aprobare; contactează providerul, fără inferență)

- Integrări → Codex „Verifică contul”: citește `account/read`, rate limits, `windowsSandbox/readiness` și `permissionProfile/list`.
- Integrări → Claude „Verifică contul”: `claude auth status --json`.
- Așteptat în Izolare: Codex „permis · limită OS”, Claude read-only „permis · limită unealtă”.

## 4. Proiect de test sanitizat

- Un director nou, fără date reale, cu un fișier sursă mic și un test.
- Proiectul demo din simulator este un model bun: `README.md`, `src/app.js`, `src/app.test.js`, `package.json`.
- Locație: în afara `.ifrim/tmp` (negat pentru model). De exemplu, un director nou în `Ifrim Digital Proiecte`, creat doar cu acordul tău, sau Hub-ul însuși în read-only.
- Workspace-ul separat este acoperit de negările absolute ale Hub-ului (canary F6).

## 5. Turn live — maximum o încercare per provider

| Câmp | Valoare |
|---|---|
| Mod | `LIVE_VALIDATION` (tastat), poartă `OPEN GATE` (tastat) |
| Grant | provider, proiectul de test, acces **doar citire**, 1 încercare, 30 min, scop scris |
| Model | Codex: modelul implicit din `model/list`; Claude: `sonnet` (alias verificat de CLI 2.1.175). Fără Fable/`[1m]`/`best` |
| Task | „Citește `src/app.js` și `src/app.test.js`; explică în 3 puncte ce validează funcția și ce caz lipsește. Nu modifica fișiere.” |
| Durată-limită | 15 min (`maxDurationS` 900), Stop All disponibil |
| Scope fișiere | doar workspace-ul de test; zonele protejate negate de OS (Codex) sau de unealtă (Claude) |
| Fără | fallback, retry automat, rețea pentru comenzi, scriere |

- **Criterii de oprire imediată:**
  - orice cerere de aprobare neașteptată;
  - model diferit de cel cerut;
  - thread cu `dangerFullAccess`;
  - depășirea plafonului de 80% din fereastră;
  - eroare de autentificare;
  - orice semn de citire în zone protejate.
- **Dovezi de păstrat:**
  - `runId`, modelul real per turn, durata, evenimentele;
  - răspunsul din conversație;
  - `usage` înainte și după;
  - lipsa oricărui fișier nou în workspace (`git status`);
  - captură Focus.

## 6. Handoff Codex ↔ Claude (test separat, aprobare separată)

Un singur handoff pe aceeași conversație:
- checkpoint;
- pregătire;
- preluare de către celălalt provider, read-only, 1 încercare;
- verificare că răspunsul folosește contextul predat.

Se execută doar dacă pasul 5 a trecut pentru ambii provideri.

## 7. Revenire

1. Stop All sau „Suspendă poarta”, apoi „Revino la BUILD_SAFE” (orice restart revine oricum la BUILD_SAFE).
2. Revocă grant-urile rămase.
3. Actualizează `M02_TEST_REPORT.md` cu `PASS_LIVE` sau `FAIL` per provider, fără a transforma omisiunile în treceri.
4. ACE-urile Codex rămân dacă nu le elimini (pasul 2, revenire).
