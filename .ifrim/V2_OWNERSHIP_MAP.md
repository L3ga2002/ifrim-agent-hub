# Harta de ownership — UN SINGUR plan de control (V2, Milestone 01)

**Regula:** există exact un proprietar principal pentru fiecare tip de stare: **Agent Hub V2** (`.ifrim/private/hub-v2.sqlite` + log de evenimente append-only). Sistemele vendor și frameworkurile pot *executa* munca; nu devin automat sursă canonică. Dacă mâine se schimbă providerul, Company Runtime supraviețuiește.

| Stare | Proprietar canonic | Cine poate executa / contribui | Cum ajunge înapoi în Hub |
|---|---|---|---|
| COMPANY STATE (companie, departamente, organigramă) | Hub (`companies`, `departments`, `manager_relationships`) | — | — |
| GOALS / OBJECTIVES | Hub (`goals`, `objectives`) | Chief of Staff (rol + workflow Hub) | comenzi `goal.*`, `objective.*` |
| MISSIONS / TASKS (+ dependențe) | Hub (`missions`, `tasks`, `task_dependencies`) | modele prin suprafețe programatice sau asistate | stare doar prin comenzi; COMPLETED doar cu dovezi |
| AGENT LIFECYCLE (AgentRole ≠ AgentRun) | Hub (`agent_roles` = definiții, `agent_runs` = execuții) | Codex app-server, Claude Code headless | adaptoare → `agent_runs`, evenimente |
| Subagenți / hooks / taskuri de fundal Claude în interiorul unei execuții Hub | **Execuția părinte din Hub** (același lease, aceeași telemetrie) | Claude Code (orchestrare nativă) | rezultat + activitate în execuția părinte; Hub-ul nu creează taskuri paralele |
| Sesiuni Claude pornite direct de tine | Claude Code (sesiunea ta) | Claude Code | **oglindă read-only** (`native_sessions`) |
| PROVIDER ROUTING | Hub (`route_decisions`, `routing.json`) | — | — |
| MEMORY | Hub (`memory_items`, scope-uri GLOBAL…AGENT_ROLE) | memoria Claude/ChatGPT rămâne a vendorului | import/export asistat cu marcaj anti-buclă |
| SKILLS CATALOG | Hub (`v2/skills/*/SKILL.md`, `skill_versions`) | Claude/Codex le pot folosi după export | export local (plugin/Agent Skills); instalarea o faci tu |
| TOOLS / CONNECTORS | Hub (`integrations`, registrul de unelte) | connectori Claude, pluginuri Codex/ChatGPT, MCP | instantaneu de descoperire; politica Hub se aplică oricum |
| COMPUTER ENVIRONMENTS | Hub (`computer_environments` + lock `computer:*`/`window:*`) | Claude computer use / Chrome / browser integrat, Codex computer use / browser (asistat) | lock + ArtifactReference + verificarea ta |
| INTEGRATIONS (conturi, rute) | Hub (inspecții, BillingPolicy) | clienții oficiali | `provider.inspect`, `provider.probe` |
| SCHEDULING METADATA | Hub (`schedules`, un singur backend per intenție) | LOCAL_HUB (execută Hub-ul) sau CLAUDE_NATIVE / OPENAI_NATIVE (execută vendorul) | `native_schedule_refs` (ID nativ înregistrat de tine) |
| EVENTS | Hub (`events`, envelope v2) | vendori → evenimente normalizate `provider.native_task_*` | adaptoare / oglindiri |
| APPROVALS | Hub (`approvals`, `approval_policies`, `task_approval_scopes`) | dialogurile vendorului = strat suplimentar | niciodată înlocuite de vendor |
| BACKUP | Hub (`backups`, backup verificat prin restaurare) | — | — |
| OBSERVABILITY / TELEMETRY | Hub (`execution_telemetry`, `commands`, audit) | vendorii raportează uzul/modelul | etichete MEASURED / PROVIDER_REPORTED / DERIVED / UNKNOWN |
| UI STATE | Hub (Control Room / Focus / Sistem) | suprafețe companion viitoare | preferințele locale nu sunt autoritative |
| ARTIFACTS | Hub (ArtifactReference) | Claude Artifacts/Projects/Research, ChatGPT Pages/Slides, Codex Cloud | referință + versiune, fără sincronizare pretinsă |
| CHECKPOINTS | Hub (checkpoint operațional cross-provider) | Claude `/rewind` (local sesiunii), fire Codex | referințe native în `native_refs_json` |

## Frameworkuri (după auditul nativ)

| Framework | Decizie | Rol permis |
|---|---|---|
| Paperclip | REFERENCE | idei de design (liveness, recuperarea muncii orfane, blocker/wake, watchdog pentru rulări tăcute); fără proces instalat — ar fi un al doilea plan de control, fără suport nativ oficial pe Windows, cu valori implicite `approve-all` / `--dangerously-skip-permissions` |
| Hermes Agent | REFERENCE | idei pentru bucla memorie/skills; fără rulare — nicio rută de inferență compatibilă cu INCLUDED_SUBSCRIPTION_ONLY (OAuth pe Max consumă extra usage; ruta Codex ocolește clientul oficial) |
| OpenClaw | RETIRE (din runtime) | nimic în V2; valoarea rămasă (canale WhatsApp/Signal/Matrix, noduri pe dispozitive) cere o decizie separată a ta. Gateway-ul PID 23596 și taskul programat Windows rămân neatinse până decizi |
| Agent Zero | REFERENCE | idei pentru un computer worker izolat; nu se instalează — computer use nativ acoperă ~80%, iar inferența lui cere chei API sau un client neoficial |
| Jarvis UI (jincocodev) | REFERENCE | doar tipare UX pentru Milestone 02 (fără cod, assets, fonturi, sunete sau identitate) |
| OpenJarvis | REFERENCE | referință de arhitectură (taxonomie de evenimente, trace, guardrails); fără integrare |
| Playwright | REUSE (după aprobarea instalării) | worker determinist, fără model, pentru browser structurat și dovezi de audit |
| Playwright MCP | INTEGRATE (opțional, amânat) | browser izolat pentru sesiunile headless pe abonament, doar cu grant |

Detalii și dovezi: `V2_FRAMEWORK_EVALUATION.md`. Ecosistemele native: `V2_OPENAI_CAPABILITY_AUDIT.md`, `V2_ANTHROPIC_CAPABILITY_AUDIT.md`, `V2_AI_ECOSYSTEM_MATRIX.md`.

## Interdicții de ownership dublu

- Hub-ul nu creează taskuri paralele pentru subagenții pe care Claude Code îi coordonează în interiorul unei execuții Hub.
- O intenție programată nu poate exista pe două backend-uri (`intent_key` unic).
- Două sisteme nu pot controla același mediu de computer sau aceeași fereastră (lease-uri).
- Două providere nu pot scrie în același workspace în același timp (lease de workspace + handoff în 9 pași).
- Memoria vendorului nu se reimportă ca fapt: doar ca ASSUMPTION, cu detectarea ecourilor Hub.
