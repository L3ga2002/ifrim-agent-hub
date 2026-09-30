> **Înlocuit (Milestone 01, 2026-09-30).** Documentul este păstrat ca istoric. Sursele actuale: `V2_OPENAI_CAPABILITY_AUDIT.md`, `V2_ANTHROPIC_CAPABILITY_AUDIT.md`, `V2_AI_ECOSYSTEM_MATRIX.md`, `V2_EXECUTION_SURFACES.md` (generate din `v2/config/ecosystem/*.json`).

# Matricea capabilităților (DevDay 29.09.2026 + clienți)

Sursa de adevăr: `v2/config/capabilities.json` (afișată în UI → Integrări). Verificat: 2026-09-29. Recapitularea DevDay a fost citită în browserul integrat (ediția ro-RO); fetch-ul automat primise 403.

| ID | Capabilitate | Plan (din sursă) | Stări | Pasul următor |
|---|---|---|---|---|
| A-siwc | Sign in with ChatGPT: utilizarea planului | Plan ChatGPT; preview pentru aplicații open-source/găzduite local | DOCUMENTED, BLOCKED | Nu este necesar; Codex app-server folosește deja planul |
| A-openclaw | Gateway OpenClaw (V1) | n/a | BLOCKED (retras din V2) | Decizie: oprire gateway + task programat |
| B-sol-6-1 | GPT-6.1 Sol | Neprecizat pe pagină („[Adaugă disponibilitatea]”) | DOCUMENTED, IMPLEMENTED, TESTED_SIMULATED | Verifică contul + listă modele |
| B-ultrafast | Astra Ultrafast | Exclusiv Pro 500 $/lună | DOCUMENTED, BLOCKED | Doar dacă ai planul și confirmi cotele |
| C-app-server | Codex app-server | Autentificare ChatGPT | DOCUMENTED, IMPLEMENTED, TESTED_SIMULATED (+ handshake real PASS_LOCAL) | Un turn live read-only aprobat |
| D-cloud | Codex în cloud | Plus/Pro/Business/… | DOCUMENTED, ASSISTED_ONLY | Comandă pregătită `codex cloud exec`, rulată de tine |
| E-review | Revizuirea codului | Toate abonamentele | DOCUMENTED, ASSISTED_ONLY | Etapa Reviewer cu grant |
| E-security | Codex Security Cloud | Toți utilizatorii Codex | DOCUMENTED, ASSISTED_ONLY | Decizie: conectarea repo-ului privat |
| F-dots | dots | Pro, Business Premium, Enterprise | DOCUMENTED, BLOCKED | După confirmarea planului |
| G-space-pages | Spațiu, Pagini, Diapozitive | Pro, Business, Enterprise | DOCUMENTED, ASSISTED_ONLY | Export Markdown din Hub |
| H-extensions | Extensii pentru pluginuri | Toate abonamentele | DOCUMENTED, BLOCKED | Cere expunere publică aprobată |
| I-mcp-events | MCP Events | Toate abonamentele | DOCUMENTED, BLOCKED | Cere endpoint public; localhost e blocat |
| J-computer-use | Computer use | Agents API: API + Pro 500/Enterprise | DOCUMENTED, BLOCKED | Decizie Playwright local |
| K-sites / teams / slack-teams | Site-uri, echipe, Slack/Teams | Business/Enterprise | DOCUMENTED, BLOCKED | — |
| K-meetings | Plugin Întâlniri | Beta Pro/Business | DOCUMENTED, BLOCKED | — |
| K-profiles | Profiluri partajabile | non-Enterprise | DOCUMENTED | — |
| K-private-intelligence / marketplace / aws | Enterprise/AWS | Enterprise / AWS | DOCUMENTED, BLOCKED | — |
| K-pro-500 | Nou nivel Pro 500 $ | Abonament nou | DOCUMENTED, BLOCKED | Decizie exclusiv a ta; upgrade automat interzis |
| L | Agents API / Decisions API | API (preview) | DOCUMENTED, BLOCKED | Doar cu includere în plan documentată |
| claude-code | Claude Code headless | Pro/Max/Team/Enterprise | DOCUMENTED, AUTHENTICATED, IMPLEMENTED, TESTED_SIMULATED | Un turn live read-only aprobat |

Nicio capabilitate nu are `TESTED_LIVE`: niciun model nu a fost pornit în această sesiune.

Discrepanțe înregistrate:
- `developers.openai.com/codex/app-server` redirecționează permanent către `learn.chatgpt.com/docs/app-server`.
- Documentația citește aprobările ca `item/permissions/requestApproval`; schema versiunii instalate expune și `item/commandExecution/requestApproval`, `item/fileChange/requestApproval` (folosite de adaptor).
- Recapitularea DevDay listează pentru Codex în cloud atât planuri explicite, cât și „toate abonamentele”.
- Pagina GPT-6.1 Sol afișează un placeholder de disponibilitate.
