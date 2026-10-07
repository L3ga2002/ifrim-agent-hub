# Fișa de pilot L5 și upgrade-ul la 2.13.0-m11

**Stare:** pregătită pe 2026-10-07. **Neaprobată.**

## 1. Ce se aprobă

| Pas | Ce fac | Efect |
|---|---|---|
| Commit | Un commit local pe `v2-milestone-01` cu reparațiile 2.12.3 (D1–D4, D6, D7) și L5 | Doar git local |
| Push | `git push origin v2-milestone-01` | GitHub |
| Upgrade | `upgrade.mjs --plan`, apoi `--apply`, la `2.13.0-m11` | Fără migrare; contractul API rămâne 12; interfața se reconstruiește. Reîncarci tab-ul Hub-ului după upgrade |
| Proiectul pilot | Creez „Factory Demo L5” din fixture-ul `bug-demo-test-first`: proiect de test, ruta Windows, fără test de acceptanță | Un folder nou lângă celelalte proiecte demo; îl înregistrez pe canalul agent, nu ca un click al tău |
| Pilotul | Pașii tăi de la §2 | Rulări de model, cu limitele de la §3 |

## 2. Ce faci tu

1. Scrii sau spui: „Repară validarea: un nume format doar din spații trece de validare” pe Factory Demo L5.
2. Te uiți la card. Primul pas trebuie să fie „testul îl scrie Hub-ul”. Confirmi o singură dată.
3. Aștepți. Hub-ul trece singur prin pași:
   - Claude scrie testul;
   - Hub-ul îl rulează de două ori;
   - Codex îl verifică;
   - Hub-ul îl protejează;
   - Codex repară codul;
   - Claude face review;
   - urmează QA și pachetul de livrare.
4. Acceptarea pachetului rămâne decizia ta separată.

## 3. Limite AI

| Rol | Model | Acces |
|---|---|---|
| Autorul testului și review-ul codului | Claude `sonnet` · medium | doar citire |
| Verificarea testului | Codex `gpt-6.1-sol` · medium | doar citire |
| Implementarea | Codex `gpt-6.1-sol` · medium | doar în proiectul pilot |

- **Ture:** așteptat 4. Planul permite cel mult 10 încercări pe rol. Opresc pilotul dacă depășește 8 ture.
- **Timp:** termenul misiunii e 180 de minute, iar așteptarea e de 30–45 de minute. Limita pe tură e 15 minute pentru Claude și 25 pentru Codex.
- **Costuri:** fără API billing, credite sau servicii noi plătite.

## 4. Exclus

ProDelivery, orice proiect real, Factory Demo M10.2, pachetele istorice, deploy, social media, alte proiecte.

## 5. Ce raportez

- Exact o confirmare.
- Etapele `TEST_AUTHORING` → `TEST_PROVING` (2 rulări identice) → `TEST_REVIEW` PASS → testul protejat → `BASELINE` → … → `DELIVERY_READY`.
- Testul ajunge în `test/hub/`, iar zona de lucru rămâne goală.
- Proveniența apare în pachet.
- Nicio întrebare nu ți-a cerut să numești sau să alegi un fișier de test.

**Textul de aprobare:** „Aprob upgrade-ul 2.13 și pilotul L5.”
