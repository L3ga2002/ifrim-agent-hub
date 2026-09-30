# Audit capabilități Anthropic / Claude (Milestone 01)

> Generat din `v2/config/ecosystem/` de `v2/scripts/gen-ecosystem-docs.mjs`. Verificat: 2026-09-30. Nu edita manual: modifică JSON-ul și regenerează.

Surse: Anthropic Newsroom, Claude Help Center (release notes, planuri Pro/Max), documentația Claude Code, plus dovezi locale fără inferență (claude auth status, claude agents --json, skills/connectori ai contului).

## Tabel sintetic

| ID | Capabilitate | Status | Plan | Inclus | Risc API | Control | Decizie Hub | Relevanță |
|---|---|---|---|---|---|---|---|---|
| an-plan-max | Claude Max (niveluri 5x și 20x) | AVAILABLE | Max 5x: 100 USD/lună; Max 20x: 200 USD/lună (articolul 1104… | yes | low | PROGRAMMATIC | REUSE_NATIVE | HIGH |
| an-plan-pro | Claude Pro (plan de referință) | NOT_APPLICABLE | Pro: 20 USD/lună cu plată lunară sau 17 USD/lună cu plată a… | not_applicable | low | NONE | REFERENCE | LOW |
| an-plan-team-enterprise | Claude Team și Claude Enterprise | NOT_APPLICABLE | Team Standard 20 USD/loc/lună anual (25 lunar); Team Premiu… | not_applicable | high | NONE | NOT_APPLICABLE | NONE |
| an-plan-purchase-flows | Fluxuri de cumpărare și upgrade (/upgrade, /usage-credits, /rate-limi… | BLOCKED | Pro/Max (credite, upgrade); Team/Enterprise (cerere către a… | no | high | NATIVE_INTERACTIVE | REJECT | MEDIUM |
| an-priority-access | Acces prioritar la trafic ridicat și acces timpuriu (Max) | AVAILABLE | Max 5x, Max 20x, Team Premium și Enterprise (nu și Team Sta… | yes | none | NONE | REUSE_NATIVE | LOW |
| an-usage-limits-windows | Limite de utilizare: sesiune de 5 ore, săptămânal și pe familii de mo… | AVAILABLE | Toate planurile; Max = 5x sau 20x Pro pe sesiune | yes | low | PROGRAMMATIC | MIRROR_STATE | HIGH |
| an-fable-weekly-allowance | Alocarea Fable pe Max și consimțământul pentru usage credits | AVAILABLE | Inclus: Max, Team Premium, Enterprise Premium. Doar cu cred… | partial | low | PROGRAMMATIC | WRAP | HIGH |
| an-usage-credits | Usage credits (fostul „extra usage”) | BLOCKED | Pro, Max 5x, Max 20x (Team/Enterprise prin admin) | no | high | ASSISTED | REJECT | HIGH |
| an-limit-resets | Resetări gratuite de limită („Reset for free”) | ASSISTED_ONLY | Planuri eligibile (anunțul Opus 5.5: abonați) | yes | none | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| an-auto-continue-usage-limit | Așteptare și continuare automată după resetarea limitei | DOCUMENTED | Abonament claude.ai (nu API sau cloud providers) | yes | low | NATIVE_INTERACTIVE | REIMPLEMENT | MEDIUM |
| an-model-opus-5-5 | Claude Opus 5.5 | NEEDS_SETUP | Planuri plătite; model implicit în Claude Code pentru Pro, … | yes | low | PROGRAMMATIC | WRAP | HIGH |
| an-model-sonnet-5-5 | Claude Sonnet 5.5 | NEEDS_SETUP | Planuri Claude (pagina de prețuri listează Sonnet și pe Fre… | yes | low | PROGRAMMATIC | WRAP | HIGH |
| an-model-fable-5-1 | Claude Fable 5.1 | NEEDS_SETUP | Max (până la 50% din limita săptămânală), Team/Enterprise P… | partial | low | PROGRAMMATIC | WRAP | HIGH |
| an-model-haiku-4-5 | Claude Haiku 4.5 | AVAILABLE | Toate planurile, inclusiv Free | yes | low | PROGRAMMATIC | WRAP | MEDIUM |
| an-model-haiku-5-5 | Claude Haiku 5.5 (anunțat) | ROLLOUT_PENDING | Nepublicat | unknown | unknown | UNKNOWN | REFERENCE | LOW |
| an-model-mythos-5-1 | Claude Mythos 5.1 | PLAN_RESTRICTED | Program restricționat pentru organizații verificate; nu est… | no | high | NONE | NOT_APPLICABLE | NONE |
| an-models-legacy | Modele anterioare încă disponibile (Fable 5, Opus 5, Sonnet 5, Opus 4… | AVAILABLE | Planuri plătite (Fable 5 cu aceleași reguli ca Fable 5.1) | yes | low | PROGRAMMATIC | REFERENCE | MEDIUM |
| an-claude-code-cli-version | Versiunea Claude Code CLI folosită de adaptorul Hub | NEEDS_SETUP | n/a | yes | none | PROGRAMMATIC | WRAP | HIGH |
| an-claude-code-model-selection | Selecția modelului în Claude Code (aliasuri, precedență, variabile de… | AVAILABLE | Orice plan cu Claude Code | yes | low | PROGRAMMATIC | WRAP | HIGH |
| an-effort-levels | Niveluri de effort și adaptive thinking | AVAILABLE | Toate planurile cu Claude Code; pe Enterprise adminii pot p… | yes | low | PROGRAMMATIC | WRAP | HIGH |
| an-ultracode | Ultracode (orchestrare de dynamic workflows) | BLOCKED | Orice plan cu Claude Code; modelul trebuie să suporte xhigh | yes | low | PROGRAMMATIC | REJECT | MEDIUM |
| an-fast-mode | Fast mode pentru Opus (research preview) | BLOCKED | Pe abonamente doar prin usage credits, niciodată din limite… | no | high | PROGRAMMATIC | REJECT | MEDIUM |
| an-1m-context | Fereastra de context de 1M tokeni | DOCUMENTED | Inclus pe Max pentru modelele native și Opus 4.6 [1m] | partial | low | PROGRAMMATIC | WRAP | MEDIUM |
| an-classifier-fallback | Fallback automat la semnalarea clasificatorilor de siguranță | DOCUMENTED | Toate planurile | yes | low | PROGRAMMATIC | WRAP | MEDIUM |
| an-fallback-model-chain | Lanț de fallback la indisponibilitate (fallbackModel / --fallback-mod… | AVAILABLE | Orice plan | yes | low | PROGRAMMATIC | WRAP | MEDIUM |
| an-auth-precedence | Precedența autentificării în Claude Code (abonament vs chei API) | AVAILABLE | Orice | yes | low | PROGRAMMATIC | WRAP | HIGH |
| an-auth-bare-mode | Modul --bare (doar cheie API) | BLOCKED | Cheie API din Claude Console | no | high | PROGRAMMATIC | REJECT | HIGH |
| an-auth-setup-token | claude setup-token (token OAuth de un an) | DOCUMENTED | Pro, Max, Team sau Enterprise | yes | low | PROGRAMMATIC | REJECT | LOW |
| an-auth-status-json | claude auth status (JSON) | AVAILABLE | Orice | yes | none | PROGRAMMATIC | WRAP | HIGH |
| an-console-api-billing | Claude Console / Claude API (facturare separată per token) | BLOCKED | Cont Console cu credite plătite | no | high | PROGRAMMATIC | REJECT | HIGH |
| an-third-party-providers | Amazon Bedrock, Google Cloud Agent Platform, Microsoft Foundry, Claud… | BLOCKED | Cont cloud sau gateway organizațional | no | high | PROGRAMMATIC | REJECT | LOW |
| an-subscription-oauth-policy | Politica de utilizare a OAuth-ului de abonament (Consumer Terms, Agen… | DOCUMENTED | Free, Pro, Max, Team, Enterprise | yes | none | PROGRAMMATIC | REFERENCE | HIGH |
| an-usage-command | /usage, /status, /stats, /cost și /insights în Claude Code | AVAILABLE | Pro, Max, Team, Enterprise pentru barele de plan | yes | none | ASSISTED | ASSISTED | MEDIUM |
| an-usage-statusline | Status line cu rate_limits (five_hour, seven_day) | DOCUMENTED | rate_limits apare doar pentru abonații claude.ai Pro/Max (s… | yes | none | PROGRAMMATIC | MIRROR_STATE | MEDIUM |
| an-usage-stream-json-events | Evenimente stream-json: rate_limit_event, system/init apiKeySource, r… | DOCUMENTED | Orice | yes | none | PROGRAMMATIC | MIRROR_STATE | HIGH |
| an-usage-otel | Export OpenTelemetry din Claude Code | NEEDS_SETUP | Orice | yes | none | PROGRAMMATIC | MIRROR_STATE | MEDIUM |
| an-usage-settings-page | claude.ai Settings → Usage și inelul de utilizare din Claude Desktop | AVAILABLE | Planuri plătite | yes | none | ASSISTED | ASSISTED | HIGH |
| an-usage-analytics-apis | Enterprise Analytics API și Claude Code Analytics API | NOT_APPLICABLE | Enterprise sau organizație Console | not_applicable | high | NONE | NOT_APPLICABLE | NONE |
| an-cost-estimates-budget | Estimări de cost (total_cost_usd) și --max-budget-usd | DOCUMENTED | Orice | yes | none | PROGRAMMATIC | REFERENCE | LOW |
| an-ultrareview-billing | Facturarea ultrareview (/code-review ultra) | ASSISTED_ONLY | Autentificare claude.ai; usage credits activate pentru rulă… | partial | high | ASSISTED | ASSISTED | MEDIUM |
| an-background-usage-consumers | Consumatori de fundal ai limitelor (prompt suggestions, /insights, /l… | DOCUMENTED | Orice | yes | low | PROGRAMMATIC | REFERENCE | MEDIUM |
| an-models-in-claude-apps | Modele disponibile în aplicațiile Claude pe plan | AVAILABLE | Conform planului | yes | low | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| an-cc-cli-interactive | Claude Code CLI interactiv (terminal/TUI) | AVAILABLE | Pro, Max, Team, Enterprise (claude.ai) sau Console (API); c… | yes | low | NATIVE_INTERACTIVE | ASSISTED | HIGH |
| an-cc-headless-print | Claude Code headless `claude -p` (Agent SDK prin CLI) | AVAILABLE | Orice cont Claude Code; pe abonament folosește OAuth claude… | yes | low | PROGRAMMATIC | WRAP | HIGH |
| an-cc-stream-json-input | Intrare stream-json bidirecțională (`--input-format stream-json`, `--… | AVAILABLE | Toate planurile. | yes | low | PROGRAMMATIC | WRAP | HIGH |
| an-cc-json-schema | Ieșire structurată `--json-schema` | AVAILABLE | Toate planurile. | yes | low | PROGRAMMATIC | WRAP | HIGH |
| an-cc-session-resume | Persistența sesiunilor: `--resume`, `--continue`, `--session-id`, `-n… | AVAILABLE | Toate planurile. | yes | low | PROGRAMMATIC | WRAP | HIGH |
| an-cc-fork-session | Ramificarea sesiunilor (`--fork-session`, `/branch`) | AVAILABLE | Toate planurile. | yes | low | PROGRAMMATIC | WRAP | MEDIUM |
| an-cc-checkpoint-rewind | Checkpoint-uri și /rewind (interactiv) | AVAILABLE | Toate planurile. | yes | none | NATIVE_INTERACTIVE | REUSE_NATIVE | MEDIUM |
| an-cc-sdk-file-checkpointing | File checkpointing în -p/SDK (`CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINT… | AVAILABLE | Toate planurile. | yes | none | PROGRAMMATIC | WRAP | MEDIUM |
| an-cc-subagents | Subagenți (Explore/Plan/general-purpose, .claude/agents, `--agents` J… | AVAILABLE | Toate planurile. | yes | low | PROGRAMMATIC | REUSE_NATIVE | HIGH |
| an-cc-background-tasks | Comenzi în fundal (`run_in_background`), Monitor, TaskStop, /tasks | AVAILABLE | Toate planurile. | yes | low | PROGRAMMATIC | WRAP | MEDIUM |
| an-cc-agent-view | Agent view și sesiuni de fundal (`claude agents`, `--bg`, supervisor) | AVAILABLE | Toate planurile (research preview). | yes | low | PROGRAMMATIC | MIRROR_STATE | HIGH |
| an-cc-agent-teams | Agent teams (experimental) | DOCUMENTED | Toate planurile. | yes | low | NATIVE_INTERACTIVE | REJECT | LOW |
| an-cc-dynamic-workflows | Dynamic workflows (unealta Workflow, ultracode, /deep-research) | AVAILABLE | Toate planurile plătite (pe Pro cu opt-in). | yes | low | PROGRAMMATIC | REUSE_NATIVE | MEDIUM |
| an-cc-task-tools | Liste de task-uri interne (TaskCreate/TaskUpdate/TaskList, TodoWrite) | AVAILABLE | Toate planurile. | yes | none | PROGRAMMATIC | MIRROR_STATE | LOW |
| an-cc-hooks | Hooks (evenimente de ciclu de viață, decizii JSON, `--include-hook-ev… | AVAILABLE | Toate planurile și toți furnizorii. | yes | none | PROGRAMMATIC | WRAP | HIGH |
| an-cc-skills | Skills Claude Code (.claude/skills/<nume>/SKILL.md) | AVAILABLE | Toate planurile. | yes | low | PROGRAMMATIC | REUSE_NATIVE | HIGH |
| an-cc-plugins | Plugins Claude Code (plugin.json, marketplaces, `claude plugin valida… | AVAILABLE | Toate planurile. | yes | low | PROGRAMMATIC | WRAP | HIGH |
| an-cc-mcp-client | Client MCP (`claude mcp`, `--mcp-config`, `--strict-mcp-config`, cone… | AVAILABLE | Toate planurile; conectorii claude.ai doar cu login claude.… | yes | low | PROGRAMMATIC | WRAP | HIGH |
| an-cc-mcp-serve | `claude mcp serve` (Claude Code ca server MCP) | DOCUMENTED | Nu este documentată o cerință de plan pentru expunerea unel… | not_applicable | none | PROGRAMMATIC | REJECT | LOW |
| an-cc-chrome | Claude in Chrome din Claude Code (`--chrome`) | NEEDS_SETUP | Plan direct Anthropic: Pro, Max, Team, Enterprise. | yes | low | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| an-cc-computer-use-cli | Computer use din CLI Claude Code | NOT_APPLICABLE | Pro sau Max (nu Team/Enterprise). | not_applicable | none | NONE | NOT_APPLICABLE | NONE |
| an-cc-desktop-computer-use | Computer use în Claude Desktop (tab Code) pe Windows | ASSISTED_ONLY | Pro sau Max (nu Team/Enterprise). | yes | low | NATIVE_INTERACTIVE | ASSISTED | LOW |
| an-cc-worktrees | Worktrees (`--worktree`/-w, EnterWorktree, isolation: worktree) | AVAILABLE | Toate planurile. | yes | none | PROGRAMMATIC | WRAP | HIGH |
| an-cc-git-workflows | Fluxuri Git/PR (commit, push, gh, `--from-pr`, /install-github-app) | AVAILABLE | Toate planurile. | yes | low | PROGRAMMATIC | WRAP | HIGH |
| an-cc-file-tools | Unelte de fișiere și shell (Read/Edit/Write/Glob/Grep/NotebookEdit/Ba… | AVAILABLE | Toate planurile. | yes | none | PROGRAMMATIC | WRAP | HIGH |
| an-cc-permission-modes | Moduri de permisiune (default/manual, acceptEdits, plan, auto, dontAs… | AVAILABLE | Toate planurile. | yes | none | PROGRAMMATIC | WRAP | HIGH |
| an-cc-permission-rules | Reguli allow/deny/ask, workspace trust, `--permission-prompt-tool`, `… | AVAILABLE | Toate planurile. | yes | none | PROGRAMMATIC | WRAP | HIGH |
| an-cc-auto-mode | Auto mode (clasificator) și `claude auto-mode` | AVAILABLE | Toate planurile; modele Opus/Sonnet 4.6+ sau Fable pe API A… | partial | low | PROGRAMMATIC | REFERENCE | MEDIUM |
| an-cc-sandboxing | Sandbox pentru Bash (Seatbelt/bubblewrap) | NOT_APPLICABLE | Toate planurile. | not_applicable | none | NONE | REFERENCE | MEDIUM |
| an-cc-managed-settings | Managed settings locale (managed-settings.json sau registru) | NEEDS_SETUP | Toate planurile (fișierul funcționează pe orice furnizor). | not_applicable | none | ASSISTED | ASSISTED | HIGH |
| an-cc-safe-mode-isolation | Izolarea configurației per run (`--safe-mode`, `--setting-sources`, `… | AVAILABLE | Toate planurile. | yes | none | PROGRAMMATIC | WRAP | HIGH |
| an-cc-bare-mode | `--bare` (mod minimal) | BLOCKED | Cheie API Console (facturare API). | no | high | PROGRAMMATIC | REJECT | HIGH |
| an-cc-auth-status | Starea autentificării (`claude auth status --json`) | AVAILABLE | Nu se aplică. | not_applicable | none | PROGRAMMATIC | MIRROR_STATE | HIGH |
| an-cc-setup-token | `claude setup-token` / CLAUDE_CODE_OAUTH_TOKEN | BLOCKED | Pro, Max, Team, Enterprise. | yes | low | ASSISTED | REJECT | MEDIUM |
| an-cc-model-effort | Selecția modelului și a efortului (`--model`, aliasuri, `--effort`, f… | AVAILABLE | Max: Opus, Sonnet, Haiku incluse; Fable separat (vezi an-cc… | yes | low | PROGRAMMATIC | WRAP | HIGH |
| an-cc-fable-access | Modele Fable (Fable 5.1) în Claude Code | ELIGIBILITY_UNKNOWN | Acces Fable; pe unele planuri și niveluri de loc se facture… | unknown | unknown | PROGRAMMATIC | REJECT | HIGH |
| an-cc-fast-mode | Fast mode (/fast) | BLOCKED | Pe abonamente doar prin usage credits; nu intră în limitele… | no | high | PROGRAMMATIC | REJECT | HIGH |
| an-cc-advisor | Advisor tool (`--advisor`, /advisor) | DOCUMENTED | Abonament sau API Anthropic; nu Bedrock/Vertex/Foundry. | partial | low | PROGRAMMATIC | REFERENCE | LOW |
| an-cc-usage-visibility | Vizibilitatea consumului (/usage, /status, statusline rate_limits, to… | AVAILABLE | Toate; rate_limits doar pentru Pro/Max. | yes | none | ASSISTED | MIRROR_STATE | HIGH |
| an-cc-otel | Telemetrie OpenTelemetry către colector local | AVAILABLE | Toate; independent de autentificare. | not_applicable | none | PROGRAMMATIC | MIRROR_STATE | MEDIUM |
| an-cc-remote-control | Remote Control (`--remote-control`, `claude remote-control`) | AVAILABLE | Pro, Max (Team/Enterprise cu activare de admin); API keys n… | yes | low | ASSISTED | ASSISTED | MEDIUM |
| an-cc-cloud-sessions | Claude Code în cloud (claude.ai/code, `--cloud`, `--teleport`) | NEEDS_SETUP | Pro, Max, Team (Enterprise cu loc premium). | yes | low | ASSISTED | ASSISTED | MEDIUM |
| an-cc-routines | Routines (agenți cloud programați sau declanșați) | NEEDS_SETUP | Pro, Max, Team, Enterprise. | yes | low | ASSISTED | ASSISTED | MEDIUM |
| an-cc-loop-cron | /loop și programare în sesiune (CronCreate/CronList/CronDelete) | AVAILABLE | Toate planurile. | yes | low | NATIVE_INTERACTIVE | REJECT | MEDIUM |
| an-cc-desktop-scheduled-tasks | Sarcini programate locale în Claude Desktop | AVAILABLE | Toate planurile cu Desktop ≥1.1.5368. | yes | low | ASSISTED | MIRROR_STATE | MEDIUM |
| an-cc-ultrareview | Ultrareview (`/code-review ultra`, `claude ultrareview`) | BLOCKED | Pro/Max: 3 rulări gratuite unice, apoi usage credits; Team/… | partial | high | PROGRAMMATIC | REJECT | MEDIUM |
| an-cc-code-review-local | /code-review local (skill inclus) | AVAILABLE | Toate planurile; consumă din limitele planului. | yes | low | PROGRAMMATIC | WRAP | HIGH |
| an-cc-code-review-managed | Code Review gestionat pentru PR-uri GitHub | PLAN_RESTRICTED | Team sau Enterprise (research preview). | no | high | NONE | REJECT | LOW |
| an-cc-security-review | /security-review și pluginul Claude Security | NEEDS_SETUP | Plan plătit (workflows); se numără în limitele planului. | yes | low | ASSISTED | ASSISTED | MEDIUM |
| an-cc-security-guidance | Pluginul security-guidance (verificare în timpul scrierii) | NEEDS_SETUP | Toate planurile. | yes | low | PROGRAMMATIC | REFERENCE | LOW |
| an-cc-agent-sdk | Claude Agent SDK (TypeScript/Python) și autentificarea prin abonament | BLOCKED | Documentația SDK trimite la API key (Console) sau cloud pro… | unknown | high | PROGRAMMATIC | REFERENCE | HIGH |
| an-cc-artifacts | Artifacts din Claude Code (unealta Artifact, /artifacts) | AVAILABLE | Pro, Max, Team (activat implicit) și Enterprise (activat de… | yes | low | ASSISTED | ASSISTED | LOW |
| an-cc-projects | Projects în Claude Code (coordonarea sesiunilor cloud) | ROLLOUT_PENDING | Pro, Max (nu Team/Enterprise încă). | yes | low | NATIVE_INTERACTIVE | REFERENCE | LOW |
| an-cc-deep-links | Deep links `claude-cli://open` | AVAILABLE | Nu se aplică. | yes | none | ASSISTED | ASSISTED | HIGH |
| an-cc-memory | Memoria de proiect: CLAUDE.md, .claude/rules, auto memory | AVAILABLE | Toate planurile. | yes | none | PROGRAMMATIC | MIRROR_STATE | HIGH |
| an-cc-vscode | Extensia VS Code Claude Code | DOCUMENTED | Pro, Max, Team, Enterprise sau Console. | yes | low | NATIVE_INTERACTIVE | ASSISTED | LOW |
| an-cc-jetbrains | Pluginul JetBrains Claude Code (beta) | DOCUMENTED | Pro, Max, Team, Enterprise sau Console. | yes | low | NATIVE_INTERACTIVE | ASSISTED | LOW |
| an-cc-github-actions | Claude Code GitHub Actions (anthropics/claude-code-action@v1) | BLOCKED | API key sau token OAuth de abonament (Pro/Max/Team/Enterpri… | partial | low | PROGRAMMATIC | REJECT | LOW |
| an-cc-channels | Channels (push de evenimente într-o sesiune deschisă) | DOCUMENTED | claude.ai sau Console; Pro/Max fără admin; Team/Enterprise … | yes | low | PROGRAMMATIC | REFERENCE | LOW |
| an-cc-cross-session-messaging | Mesagerie între sesiuni (SendMessage/ListAgents) | DOCUMENTED | Toate planurile; peste mașină doar cu claude.ai + Remote Co… | yes | low | UNKNOWN | REFERENCE | LOW |
| an-cc-goal | /goal (lucru până la îndeplinirea unei condiții) | AVAILABLE | Toate planurile. | yes | low | PROGRAMMATIC | REFERENCE | MEDIUM |
| an-cc-doctor | `claude doctor` (diagnostic) | AVAILABLE | Nu se aplică. | not_applicable | none | PROGRAMMATIC | MIRROR_STATE | LOW |
| an-cc-desktop-code-tab | Claude Code Desktop (tab Code): sesiuni paralele, worktrees, cloud/SS… | AVAILABLE | Abonament claude.ai. | yes | low | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| an-cc-version-updates | Actualizarea Claude Code (`claude update`, `claude install stable\|la… | AVAILABLE | Nu se aplică. | not_applicable | none | ASSISTED | ASSISTED | HIGH |
| an-claudeai-projects | Projects în claude.ai (chat) — spații de lucru cu cunoștințe, instruc… | ASSISTED_ONLY | Toate planurile; Free limitat la 5 proiecte; Pro/Max acces … | yes | low | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| an-project-knowledge-rag | Cunoștințe de proiect extinse (RAG pentru Projects) | ASSISTED_ONLY | Pro, Max, Team, Enterprise. | yes | low | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| an-claude-code-projects-cloud | Projects în Claude Code (conversație coordonatoare cu fire paralele î… | ROLLOUT_PENDING | Beta publică pe Pro și Max; indisponibil pe Team/Enterprise. | yes | low | NATIVE_INTERACTIVE | REFERENCE | MEDIUM |
| an-cowork-projects-local-folders | Projects în Cowork (inclusiv proiecte bazate pe foldere locale) | ASSISTED_ONLY | Pro, Max, Team, Enterprise. | yes | low | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| an-research | Research (cercetare agentică multi-căutare cu citări) | ASSISTED_ONLY | Pro, Max, Team, Enterprise (Free nu are Research). | yes | low | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| an-memory | Memoria Claude (chat + Cowork, pe topicuri editabile) | ASSISTED_ONLY | Toate planurile; activă implicit pe Free, Pro și Max (web, … | yes | none | NATIVE_INTERACTIVE | REIMPLEMENT | MEDIUM |
| an-chat-search | Căutare și referire a conversațiilor anterioare (Search and reference… | ASSISTED_ONLY | Planuri plătite (Pro, Max, Team, Enterprise). | yes | low | NATIVE_INTERACTIVE | REFERENCE | LOW |
| an-memory-import-export | Import și export de memorie (experimental) | ASSISTED_ONLY | Free, Pro, Max, Team (import); web și Desktop. | yes | low | ASSISTED | ASSISTED | MEDIUM |
| an-account-data-export | Exportul datelor contului (istoric conversații) | ASSISTED_ONLY | Free, Pro, Max (self-serve); Team/Enterprise doar Primary O… | yes | none | ASSISTED | ASSISTED | LOW |
| an-artifacts-chat | Artifacts în claude.ai (livrabile interactive lângă conversație) | ASSISTED_ONLY | Crearea: toate planurile inclusiv Free; șabloanele Design/S… | yes | low | NATIVE_INTERACTIVE | REFERENCE | LOW |
| an-artifacts-claude-code | Artifacts publicate din Claude Code (instrumentul Artifact, /artifact… | AVAILABLE | Pro, Max, Team; Enterprise cu activare admin. | yes | low | PROGRAMMATIC | WRAP | HIGH |
| an-claude-docs | Claude Docs (documente vii colaborative) | AVAILABLE | Beta pe Pro, Max, Team (activ implicit) și Enterprise (acti… | yes | low | PROGRAMMATIC | ASSISTED | MEDIUM |
| an-claude-slides | Claude Slides (prezentări editabile) | ASSISTED_ONLY | Șablon beta pe Pro, Max, Team (implicit activ); Enterprise … | yes | low | UNKNOWN | ASSISTED | MEDIUM |
| an-claude-design | Claude Design (designuri, prototipuri, one-pagers) | ASSISTED_ONLY | Beta pe Pro, Max, Team (activ implicit); Enterprise cu acti… | yes | low | UNKNOWN | ASSISTED | MEDIUM |
| an-file-creation | Creare și editare de fișiere (docx, xlsx, pptx, pdf, cod) cu execuție… | NEEDS_SETUP | Toate planurile; pe Free/Pro/Max activ implicit, cu acces l… | yes | low | PROGRAMMATIC | WRAP | HIGH |
| an-cowork | Claude Cowork (taskuri agentice pentru munca de birou) | ASSISTED_ONLY | Planuri plătite: Pro, Max, Team și Enterprise pe desktop; p… | yes | low | NATIVE_INTERACTIVE | ASSISTED | HIGH |
| an-unified-claude-experience | Experiența Claude unificată (chat și Cowork în aceeași conversație) | ROLLOUT_PENDING | Pro și Max întâi; alte planuri ulterior (Enterprise primeșt… | yes | low | NATIVE_INTERACTIVE | REFERENCE | MEDIUM |
| an-cowork-remote-sessions | Sesiuni Cowork la distanță pe web și mobil | ASSISTED_ONLY | Beta pe web/mobil pentru Pro, Max, Team; Enterprise cu acti… | yes | low | NATIVE_INTERACTIVE | REFERENCE | MEDIUM |
| an-cowork-scheduled-tasks | Taskuri programate în Cowork (execuție la distanță) | ASSISTED_ONLY | Toate planurile plătite. | yes | low | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| an-desktop-local-scheduled-tasks | Taskuri programate locale în Claude Desktop (Code > Routines > Local) | AVAILABLE | Planuri claude.ai cu Claude Desktop (Code tab); Desktop ≥ 1… | yes | low | ASSISTED | MIRROR_STATE | MEDIUM |
| an-routines-cloud | Routines (Claude Code programat în cloud, cu declanșatori API și GitH… | NEEDS_SETUP | Pro, Max, Team, Enterprise. | yes | low | PROGRAMMATIC | REFERENCE | MEDIUM |
| an-claude-in-chrome-extension | Extensia Claude in Chrome (panou lateral) | NEEDS_SETUP | Pro, Max, Team, Enterprise (beta); panoul ca sesiune Cowork… | yes | low | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| an-claude-code-chrome | Claude Code + Chrome (--chrome, /chrome, serverul claude-in-chrome) | NEEDS_SETUP | Plan Anthropic direct (Pro, Max, Team, Enterprise). | yes | low | PROGRAMMATIC | WRAP | HIGH |
| an-chrome-shortcuts-scheduled | Claude in Chrome: scurtături, taskuri programate și fluxuri înregistr… | NEEDS_SETUP | Planuri plătite. | yes | low | NATIVE_INTERACTIVE | REFERENCE | LOW |
| an-desktop-built-in-browser | Browserul integrat din Claude Desktop (Browser pane și panoul Cowork) | AVAILABLE | Pro, Max, Team și Enterprise eligibile pentru Cowork; Code … | yes | low | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| an-desktop-computer-use-windows | Computer use în Claude Desktop pe Windows | NEEDS_SETUP | Pro și Max (research preview); nu Team/Enterprise. | yes | low | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| an-cli-computer-use-macos | Computer use din Claude Code CLI (server MCP computer-use) | NOT_APPLICABLE | Pro sau Max. | yes | low | NONE | NOT_APPLICABLE | LOW |
| an-dispatch | Dispatch (fir persistent: taskuri trimise de pe telefon către Desktop) | ELIGIBILITY_UNKNOWN | Pro sau Max; nu Team/Enterprise. | yes | low | NATIVE_INTERACTIVE | REFERENCE | LOW |
| an-remote-control | Remote Control (continuarea sesiunilor locale Claude Code de pe web s… | AVAILABLE | Pro, Max; Team/Enterprise cu activare admin; cheile API nu … | yes | low | PROGRAMMATIC | ASSISTED | HIGH |
| an-mobile-app | Aplicația mobilă Claude (iOS/Android) ca suprafață de continuare | ASSISTED_ONLY | Toate planurile pentru chat; Code și Dispatch conform planu… | yes | low | NATIVE_INTERACTIVE | REFERENCE | MEDIUM |
| an-connectors-directory | Directorul de conectori (servere MCP verificate și comunitare) | AVAILABLE | Toate planurile; pe Team/Enterprise conectorii îi adaugă ow… | yes | low | NATIVE_INTERACTIVE | REUSE_NATIVE | HIGH |
| an-claudeai-connectors-in-claude-code | Conectorii claude.ai încărcați automat în Claude Code | AVAILABLE | Orice plan claude.ai care are conectori. | yes | low | PROGRAMMATIC | WRAP | HIGH |
| an-custom-remote-connectors | Conectori custom prin MCP la distanță (URL) | BLOCKED | Free (un conector), Pro, Max; pe Team/Enterprise îl adaugă … | yes | low | NATIVE_INTERACTIVE | REJECT | MEDIUM |
| an-mcp-tunnels | MCP tunnels (conectori către servere MCP din rețele private) | PLAN_RESTRICTED | Enterprise, la cerere (research preview). | no | high | NONE | NOT_APPLICABLE | LOW |
| an-desktop-extensions-local-mcp | Extensii desktop (.mcpb) și servere MCP locale în Claude Desktop | AVAILABLE | Claude Desktop autentificat claude.ai (orice plan); organiz… | yes | low | ASSISTED | REUSE_NATIVE | HIGH |
| an-mcp-apps-interactive-connectors | Conectori interactivi / MCP Apps (UI live în conversație) | DOCUMENTED | Free, Pro, Max, Team, Enterprise. | yes | low | ASSISTED | REFERENCE | MEDIUM |
| an-claudeai-plugins | Pluginuri Claude (skill-uri, conectori, comenzi, agenți, hooks) | AVAILABLE | Directorul: Pro, Max, Team, Enterprise; limite: 25 de marke… | yes | low | NATIVE_INTERACTIVE | REUSE_NATIVE | MEDIUM |
| an-plugin-directory-portal | Portalul de dezvoltatori pentru directorul de pluginuri și conectori | DOCUMENTED | Dezvoltatori pe planuri plătite; pe Team/Enterprise trimite… | yes | none | NATIVE_INTERACTIVE | REFERENCE | LOW |
| an-claude-marketplace | Claude Marketplace (pluginuri/conectori, agenți/produse, parteneri de… | BLOCKED | Neprecizat pentru pluginuri; achiziția de agenți și produse… | partial | high | NONE | REJECT | LOW |
| an-claudeai-skills | Skills pe claude.ai (Anthropic, parteneri, organizație, custom) | AVAILABLE | Pro, Max, Team, Enterprise, cu Code execution and file crea… | yes | low | PROGRAMMATIC | REUSE_NATIVE | HIGH |
| an-claudeai-account-sync | Sincronizarea skill-urilor și pluginurilor contului claude.ai în Clau… | NEEDS_SETUP | Plan claude.ai; Claude Code ≥ 2.1.273 pentru sincronizarea … | yes | low | PROGRAMMATIC | WRAP | HIGH |
| an-inline-visualizations | Vizualizări interactive inline (grafice și diagrame în răspuns) | ASSISTED_ONLY | Neprecizat în nota de lansare. | yes | low | NATIVE_INTERACTIVE | REFERENCE | LOW |
| an-usage-credits-app-surfaces | Usage credits (extra usage) pe suprafețele Claude și regimul Fable | BLOCKED | Pro, Max 5x, Max 20x. | no | high | NONE | REJECT | HIGH |
| an-gap-cc-billing-guards | Gărzi native de facturare în Claude Code aplicabile per proces (DISAB… | AVAILABLE | Oricare plan; gărzile sunt locale clientului, nu depind de … | yes | none | PROGRAMMATIC | WRAP | HIGH |
| an-gap-cc-settings-env-helper-neutralization | Neutralizarea blocului env, a apiKeyHelper și a hook-urilor din fișie… | AVAILABLE | Oricare | not_applicable | none | PROGRAMMATIC | WRAP | HIGH |
| an-gap-cc-version-governance | Guvernanța și fixarea versiunii Claude Code folosite de Hub (autoUpda… | NEEDS_SETUP | Oricare | not_applicable | none | PROGRAMMATIC | WRAP | HIGH |
| an-gap-model-retirement-signals | Retragerea modelelor Anthropic și semnalele din Claude Code (pagina m… | DOCUMENTED | Oricare | not_applicable | none | ASSISTED | MIRROR_STATE | HIGH |
| an-gap-cc-restricted-mode | Modul restricționat pentru harness-uri: --restricted / CLAUDE_CODE_RE… | NEEDS_SETUP | Oricare | yes | low | PROGRAMMATIC | WRAP | HIGH |
| an-gap-cc-disable-sideload-flags | disableSideloadFlags (managed): respingerea --plugin-dir, --plugin-ur… | DOCUMENTED | Orice plan cu managed settings (fișier, registru, MDM sau s… | not_applicable | none | NONE | REFERENCE | MEDIUM |
| an-gap-cc-native-skill-isolation | Izolarea skill-urilor native în rulările Claude Code lansate de Hub (… | AVAILABLE | Oricare | not_applicable | none | PROGRAMMATIC | WRAP | HIGH |
| an-gap-cc-config-dir-isolation | CLAUDE_CONFIG_DIR + CLAUDE_CODE_PROJECT_DIR_NAME: stare nativă separa… | NEEDS_SETUP | Oricare | yes | low | PROGRAMMATIC | WRAP | MEDIUM |
| an-gap-cc-system-prompt-flags | Personalizarea promptului de sistem în -p, inclusiv pentru subagenți … | AVAILABLE | Oricare | yes | low | PROGRAMMATIC | WRAP | HIGH |
| an-gap-cc-batch-skill | /batch (skill inclus): orchestrare de schimbări mari în 5–30 de unită… | DOCUMENTED | Oricare plan cu Claude Code | yes | low | PROGRAMMATIC | REJECT | MEDIUM |
| an-gap-cc-project-purge | claude project purge: ștergerea stării locale Claude Code pentru un p… | BLOCKED | Oricare | not_applicable | none | PROGRAMMATIC | REJECT | MEDIUM |
| an-gap-web-search-fetch | Căutare web în chatul Claude și uneltele WebSearch/WebFetch din Claud… | AVAILABLE | Chat: toate planurile (Team/Enterprise necesită activare de… | yes | low | PROGRAMMATIC | WRAP | HIGH |
| an-gap-cc-import | claude import / /import: preluarea configurației din OpenAI Codex, Ge… | NEEDS_SETUP | Oricare plan pe Claude API (nu pe Bedrock, Agent Platform, … | unknown | low | ASSISTED | ASSISTED | MEDIUM |
| an-gap-claude-web-desktop-core | Suprafețele de bază Claude pe web (claude.ai) și în Claude Desktop pe… | AVAILABLE | Chat: toate planurile; Code și Cowork: Pro, Max, Team, Ente… | yes | low | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| an-gap-claude-for-m365 | Claude for M365: add-in-uri Claude for Excel, PowerPoint, Word și Out… | NEEDS_SETUP | Pro, Max, Team, Enterprise (Excel, PowerPoint și Word GA; O… | yes | low | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| an-gap-claudeai-github-integration | Integrarea GitHub din claude.ai (depozit în chat sau fișiere din depo… | NEEDS_SETUP | Toate planurile, inclusiv Free | yes | none | NATIVE_INTERACTIVE | REFERENCE | LOW |
| an-gap-claude-in-slack | Claude în Slack: Claude Tag (Team/Enterprise) și varianta anterioară … | NEEDS_SETUP | Claude Tag: Team sau Enterprise (nu Free/Pro/Max). Claude C… | partial | low | NATIVE_INTERACTIVE | REFERENCE | LOW |
| an-gap-reflect-recap-time-focus | Monthly recap (Settings > Reflect) și Time and focus (break reminders… | ELIGIBILITY_UNKNOWN | Free, Pro, Max (nu Team/Enterprise) | yes | none | NONE | NOT_APPLICABLE | LOW |
| an-gap-skill-plugin-security-scanning | Scanarea de securitate pentru skill-uri și pluginuri terțe (Enterpris… | PLAN_RESTRICTED | Enterprise | no | none | NONE | REIMPLEMENT | MEDIUM |
| an-gap-text-watermark-c2pa | Watermark-ul textului generat de Claude și content credentials C2PA p… | DOCUMENTED | Se aplică automat tuturor planurilor și suprafețelor pentru… | not_applicable | none | NONE | REFERENCE | MEDIUM |
| an-gap-cc-self-hosted-environments | Medii self-hosted pentru sesiuni cloud Claude Code (claude self-hoste… | PLAN_RESTRICTED | Team sau Enterprise (public beta, oprit implicit, activat d… | no | unknown | NONE | NOT_APPLICABLE | LOW |
| an-gap-model-availability-regulatory-risk | Risc de disponibilitate: suspendarea Fable 5 și Mythos 5 prin directi… | DOCUMENTED | N/A | not_applicable | none | NONE | REFERENCE | MEDIUM |
| an-gap-mythos-trusted-access-programs | Acces restricționat la modelele Mythos-class: Mythos 5, Project Glass… | PLAN_RESTRICTED | Program de acces verificat (nu un plan de abonament) | no | unknown | NONE | NOT_APPLICABLE | LOW |
| an-gap-enterprise-frontier-safeguards | Enterprise Frontier Safeguards (EFS): confidențialitate de tip ZDR pl… | PLAN_RESTRICTED | Clienți enterprise (Claude Enterprise / Platform / cloud) | no | high | NONE | NOT_APPLICABLE | LOW |
| an-gap-vertical-plugin-packs | Pachete verticale de pluginuri și conectori: Agents for financial ser… | DOCUMENTED | Pluginurile rulează în Cowork/Claude Code pe planurile care… | partial | high | ASSISTED | REFERENCE | LOW |
| an-gap-business-connectors-write-tools | Conectori de business cu acțiuni de scriere: write tools în conectoru… | ELIGIBILITY_UNKNOWN | M365: toate planurile (write actions: activare de admin); S… | yes | low | NATIVE_INTERACTIVE | REFERENCE | MEDIUM |

## Index de surse (anunțuri / release notes)

| Data | Titlu | Relevanță | URL |
|---|---|---|---|
| 2026-05-05 | Agents for financial services | LOW: exemplu de pachete verticale de pluginuri; nu vizează direct Ifrim Digital. | https://www.anthropic.com/news/finance-agents |
| 2026-05-06 | Higher usage limits and a SpaceX compute deal | HIGH: crește capacitatea inclusă folosită de Hub prin Claude Code. | https://www.anthropic.com/news/higher-limits-spacex |
| 2026-05-13 | Introducing Claude for Small Business | MEDIUM: referință pentru operațiunile Ifrim Digital; utilizare doar ASSISTED. | https://www.anthropic.com/news/claude-for-small-business |
| 2026-05-18 | Anthropic acquires Stainless | LOW: semnal pentru evoluția ecosistemului MCP. | https://www.anthropic.com/news/anthropic-acquires-stainless |
| 2026-05-28 | Introducing Claude Opus 4.8 | MEDIUM: conform istoricului documentației, este modelul implicit al CLI-ului lo… | https://www.anthropic.com/news/claude-opus-4-8 |
| 2026-06-02 | Expanding Project Glasswing | NONE: acces restricționat la modelele Mythos. | https://www.anthropic.com/news/expanding-project-glasswing |
| 2026-06-09 | Claude Fable 5 and Claude Mythos 5 | MEDIUM: predecesorul Fable 5.1; singurul Fable accesibil din CLI 2.1.175. | https://www.anthropic.com/news/claude-fable-5-mythos-5 |
| 2026-06-12 | Statement on the directive to suspend Fable 5 access | HIGH: risc regulatoriu dovedit; Hub-ul nu trebuie să depindă exclusiv de Fable. | https://www.anthropic.com/news/fable-mythos-access |
| 2026-06-23 | Introducing Claude Tag | NONE: disponibil pentru Team și Enterprise. | https://www.anthropic.com/news/introducing-claude-tag |
| 2026-06-30 | Claude Science, an AI workbench for scientists | LOW: inclus în Pro și Max, dar în afara domeniului Hub-ului. | https://www.anthropic.com/news/claude-science-ai-workbench |
| 2026-06-30 | Introducing Claude Sonnet 5 | LOW: înlocuit de Sonnet 5.5; rămâne ținta de fallback cyber pentru Sonnet 5.5. | https://www.anthropic.com/news/claude-sonnet-5 |
| 2026-06-30 | Redeploying Claude Fable 5 | MEDIUM: explică regulile de acces Fable și fallback-ul spre Opus 4.8. | https://www.anthropic.com/news/redeploying-fable-5 |
| 2026-07-02 | Fable 5's cyber safeguards and our jailbreak framework | MEDIUM: afectează sarcinile de review de securitate rulate de Hub. | https://www.anthropic.com/news/fable-safeguards-jailbreak-framework |
| 2026-07-09 | A new way to reflect on how you use Claude | LOW | https://www.anthropic.com/news/reflect-with-claude |
| 2026-07-14 | Introducing Claude for Teachers | NONE | https://www.anthropic.com/news/claude-for-teachers |
| 2026-07-22 | The Anthropic Economic Index connector | LOW | https://www.anthropic.com/news/anthropic-economic-index-connector |
| 2026-07-24 | Introducing Claude Opus 5 | MEDIUM: ținta de fallback pentru semnalările bio; înlocuit de Opus 5.5. | https://www.anthropic.com/news/claude-opus-5 |
| 2026-07-30 | Investigating three incidents in our cybersecurity evaluations | MEDIUM: argument pentru sandbox strict și allowlist de rețea în Hub. | https://www.anthropic.com/news/investigating-incidents-cybersecurity-evals |
| 2026-08-07 | Improving Fable 5's safeguards | LOW | https://www.anthropic.com/news/improving-fable-5-s-biology-safeguards |
| 2026-08-14 | How Claude's text watermarking works | MEDIUM: relevant pentru conținutul livrat clienților din UE. | https://www.anthropic.com/news/claude-text-watermark |
| 2026-08-27 | Previewing the Model Hardware Standard | NONE | https://www.anthropic.com/news/model-hardware-standard-research-preview |
| 2026-08-27 | Expanding our support for scientists | NONE | https://www.anthropic.com/news/expanding-support-for-scientists |
| 2026-08-31 | Improving our alignment and security practices | LOW | https://www.anthropic.com/news/improving-alignment-security-efforts |
| 2026-09-01 | Introducing Claude Fable 5.1 and Claude Mythos 5.1 | HIGH: Fable 5.1 este inclus pe Max până la 50% din limita săptămânală; necesită… | https://www.anthropic.com/claude-fable-and-mythos-5-1 |
| 2026-09-01 | Developing Enterprise Frontier Safeguards with our customers | NONE: soluție enterprise. | https://www.anthropic.com/news/enterprise-frontier-safeguards |
| 2026-09-10 | Detecting and countering misuse of AI: September 2026 | LOW | https://www.anthropic.com/threat-intelligence-report-september-2026 |
| 2026-09-17 | Introducing the Life Sciences Verification Program | NONE | https://www.anthropic.com/news/life-sciences-verification-program |
| 2026-09-22 | Introducing Claude Opus 5.5 | HIGH: modelul implicit recomandat pentru Hub după actualizarea CLI la ≥2.1.280. | https://www.anthropic.com/claude-opus-5-5 |
| 2026-09-28 | Introducing Claude Sonnet 5.5 | HIGH: model de rutină pentru Builder și Tester; necesită CLI ≥2.1.284. | https://www.anthropic.com/claude-sonnet-5-5 |
| 2026-09-28 | Release notes: Claude Sonnet 5.5 launch | HIGH | https://www.anthropic.com/claude-sonnet-5-5 |
| 2026-09-25 | Release notes: Build plugins for Claude | LOW: Hub-ul nu publică pluginuri fără aprobare. | https://claude.com/blog/build-plugins-for-claude |
| 2026-09-22 | Release notes: Claude Opus 5.5 launch | HIGH | https://www.anthropic.com/claude-opus-5-5 |
| 2026-09-16 | Release notes: Claude Cowork comes to every conversation | MEDIUM: suprafață ASSISTED pentru rapoarte, foi de calcul și prezentări. | https://support.claude.com/en/articles/16761823-claude-cowork-and-chat-are-one-claude |
| 2026-09-16 | Release notes: Create designs, decks, and docs in any conversation | MEDIUM: livrabile de documente pregătite de Hub și finalizate nativ. | https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them |
| 2026-09-15 | Release notes: Launching Salesforce in Claude (beta) | NONE | https://claude.com/blog/salesforce-in-claude |
| 2026-09-10 | Release notes: Smart reports (beta) | NONE | https://support.claude.com/en/articles/16893491-get-started-with-smart-reports |
| 2026-09-01 | Release notes: Claude Fable 5.1 and Claude Mythos 5.1 launch | HIGH | https://www.anthropic.com/claude-fable-and-mythos-5-1 |
| 2026-08-25 | Release notes: Memory in Claude Cowork, editable topics, and a sensitive topics setting | MEDIUM: memoria Claude este separată de memoria canonică a Hub-ului; risc de du… | https://support.claude.com/en/articles/11817273 |
| 2026-08-06 | Release notes: Skill and plugin security scanning (beta) | NONE | https://support.claude.com/en/articles/15927065 |
| 2026-07-24 | Release notes: Claude Opus 5 launch | MEDIUM | https://www.anthropic.com/news/claude-opus-5 |
| 2026-07-14 | Release notes: HIPAA configuration is now self-serve | NONE | https://support.claude.com/en/articles/13296973-hipaa-ready-enterprise-plans |
| 2026-07-10 | Release notes: Updated memory for Claude | MEDIUM: de ținut separată de memoria Hub-ului. | https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context |
| 2026-07-09 | Release notes: A new way to reflect with Claude | LOW | https://support.claude.com/en/articles/15672559 |
| 2026-07-07 | Release notes: Claude Cowork on web and mobile | MEDIUM: suprafață nativă pentru lucru în fundal, doar ASSISTED. | https://support.claude.com/en/articles/15520349 |
| 2026-07-07 | Release notes: Write tools for the Microsoft 365 connector | LOW: efecte externe, interzise fără aprobare explicită. | https://support.claude.com/en/articles/12542951-set-up-the-microsoft-365-connector |
| 2026-07-01 | Release notes: Access to Claude Fable 5 and Claude Mythos 5 restored | MEDIUM | https://www.anthropic.com/news/redeploying-fable-5 |
| 2026-07-01 | Release notes: Model entitlements for Enterprise plans (beta) | NONE | https://support.claude.com/en/articles/15694740 |
| 2026-06-30 | Release notes: Claude Sonnet 5 launch | LOW | https://www.anthropic.com/news/claude-sonnet-5 |
| 2026-06-25 | Release notes: Enable Trusted Devices for Remote Control | LOW: indică modelul de securitate pentru Remote Control. | https://code.claude.com/docs/en/remote-control#trusted-devices |
| 2026-06-23 | Release notes: Delegate work to Claude in Slack with Claude Tag | NONE | https://www.anthropic.com/news/introducing-claude-tag |
| 2026-06-12 | Release notes: Access to Claude Fable 5 and Claude Mythos 5 suspended | HIGH: confirmă riscul de indisponibilitate bruscă a unui model. | https://anthropic.com/news/fable-mythos-access |
| 2026-06-12 | Release notes: Edit Claude's drafts in place | LOW | https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them |
| 2026-06-09 | Release notes: Claude Fable 5 launch | MEDIUM | https://www.anthropic.com/news/claude-fable-5-mythos-5 |
| 2026-06-02 | Release notes: Enterprise plans can manage admin permissions with custom roles | NONE | https://support.claude.com/en/articles/13930452-manage-custom-roles-on-enterprise-plans |
| 2026-09-30 | Claude Code docs index (llms.txt) | HIGH: hartă pentru verificări periodice ale capabilităților. | https://code.claude.com/docs/llms.txt |
| 2026-09-30 | CLI reference | HIGH: baza adaptorului Claude și a listei de flag-uri interzise. | https://code.claude.com/docs/en/cli-reference |
| 2026-09-30 | Run Claude Code programmatically (headless) | HIGH: ruta principală de execuție și anulare. | https://code.claude.com/docs/en/headless |
| 2026-09-30 | Authentication | HIGH: garda de facturare INCLUDED_SUBSCRIPTION_ONLY. | https://code.claude.com/docs/en/authentication |
| 2026-09-30 | Legal and compliance | HIGH: cadrul de politică pentru orchestrarea prin abonament. | https://code.claude.com/docs/en/legal-and-compliance |
| 2026-09-30 | Agent SDK overview | HIGH: motiv pentru a folosi subprocesul CLI, nu SDK-ul. | https://code.claude.com/docs/en/agent-sdk/overview |
| 2026-09-30 | Checkpointing | MEDIUM: limitele undo-ului nativ față de backup-ul Hub. | https://code.claude.com/docs/en/checkpointing |
| 2026-09-30 | Rewind file changes with checkpointing (SDK) | MEDIUM: undo automat pentru run-uri headless. | https://code.claude.com/docs/en/agent-sdk/file-checkpointing |
| 2026-09-30 | Create custom subagents | HIGH: regula unui singur proprietar al ciclului de viață. | https://code.claude.com/docs/en/sub-agents |
| 2026-09-30 | Hooks reference | HIGH: strat determinist de politică pentru Hub. | https://code.claude.com/docs/en/hooks |
| 2026-09-30 | Manage multiple agents with agent view | HIGH: oglindirea sesiunilor native. | https://code.claude.com/docs/en/agent-view |
| 2026-09-30 | Extend Claude with skills | HIGH: livrarea procedurilor Hub. | https://code.claude.com/docs/en/skills |
| 2026-09-30 | Plugin manifest reference | HIGH: ambalarea extensiilor Hub. | https://code.claude.com/docs/en/plugins/manifest-reference |
| 2026-09-30 | Plugin commands reference | MEDIUM: validare fără inferență. | https://code.claude.com/docs/en/plugins/cli-reference |
| 2026-09-30 | Connect Claude Code to tools via MCP | HIGH: server MCP Hub și izolare. | https://code.claude.com/docs/en/mcp |
| 2026-09-30 | Use Claude Code with Chrome | MEDIUM: asistare pentru teste UI locale. | https://code.claude.com/docs/en/chrome |
| 2026-09-30 | Computer use from the CLI | LOW: neaplicabil pe mașina Windows. | https://code.claude.com/docs/en/computer-use |
| 2026-09-30 | Choose a permission mode | HIGH: politica per grant. | https://code.claude.com/docs/en/permission-modes |
| 2026-09-30 | Configure the sandboxed Bash tool | MEDIUM: explică absența izolării OS pe Windows. | https://code.claude.com/docs/en/sandboxing |
| 2026-09-30 | Run parallel sessions with worktrees | HIGH: izolarea run-urilor de scriere. | https://code.claude.com/docs/en/worktrees |
| 2026-09-30 | Speed up responses with fast mode | HIGH: blocat de BillingPolicy. | https://code.claude.com/docs/en/fast-mode |
| 2026-09-30 | Model configuration | HIGH: rutare de model fără credite. | https://code.claude.com/docs/en/model-config |
| 2026-09-30 | Manage costs effectively | HIGH: vizibilitatea cotei. | https://code.claude.com/docs/en/costs |
| 2026-09-30 | Customize your status line | MEDIUM: captură programatică a limitelor în sesiuni interactive. | https://code.claude.com/docs/en/statusline |
| 2026-09-30 | Remote Control | MEDIUM: supraveghere mobilă asistată. | https://code.claude.com/docs/en/remote-control |
| 2026-09-30 | Use Claude Code in the cloud | MEDIUM: execuție cloud asistată. | https://code.claude.com/docs/en/claude-code-on-the-web |
| 2026-09-30 | Automate work with routines | MEDIUM: automatizări cloud ale proprietarului. | https://code.claude.com/docs/en/routines |
| 2026-09-30 | Find bugs with ultrareview | HIGH: trebuie blocat în Hub. | https://code.claude.com/docs/en/ultrareview |
| 2026-09-30 | Code Review | HIGH: revizie inclusă prin /code-review local. | https://code.claude.com/docs/en/code-review |
| 2026-09-30 | Streaming Input (Agent SDK) | HIGH: anulare curată în adaptor. | https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode |
| 2026-09-30 | Manage sessions | HIGH: continuitatea run-urilor. | https://code.claude.com/docs/en/sessions |
| 2026-09-30 | Share session output as artifacts | LOW: exclus din run-urile Hub. | https://code.claude.com/docs/en/artifacts |
| 2026-09-30 | Feature availability | HIGH: eligibilitate pe plan. | https://code.claude.com/docs/en/feature-availability |
| 2026-09-30 | Dynamic workflows | MEDIUM: control al costului. | https://code.claude.com/docs/en/workflows |
| 2026-09-30 | Agent teams | LOW: al doilea orchestrator. | https://code.claude.com/docs/en/agent-teams |
| 2026-09-30 | Cross-session messaging | LOW: indisponibil local. | https://code.claude.com/docs/en/cross-session-messaging |
| 2026-09-30 | Channels | LOW: referință pentru notificări. | https://code.claude.com/docs/en/channels |
| 2026-09-30 | Launch sessions from links | HIGH: fluxuri ASSISTED fără inferență automată. | https://code.claude.com/docs/en/deep-links |
| 2026-09-30 | How Claude remembers your project | HIGH: memoria canonică rămâne în Hub. | https://code.claude.com/docs/en/memory |
| 2026-09-30 | Deploy managed settings | HIGH: gardă deterministă de facturare. | https://code.claude.com/docs/en/managed-settings |
| 2026-09-30 | Claude Code GitHub Actions | LOW: respins. | https://code.claude.com/docs/en/github-actions |
| 2026-09-30 | Claude Security plugin / security guidance plugin | MEDIUM: audit asistat. | https://code.claude.com/docs/en/claude-security |
| 2026-09-30 | Claude Code CHANGELOG (GitHub) | HIGH: decalaj de versiune și flag-uri lipsă. | https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md |
| 2026-09-30 | Use Claude Code with your Pro or Max plan | HIGH: confirmarea cotei partajate. | https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan |
| 2026-09-30 | Claude pricing | MEDIUM: nivelul exact Max rămâne neverificat. | https://claude.com/pricing |
| 2026-09-29 | Claude Desktop v2.16120.0 | MEDIUM: livrabile de birou; versiunea locală instalată este 2.9939.4. | https://claude.com/docs/cowork/changelog |
| 2026-09-25 | Portal de dezvoltatori pentru pluginuri Claude | LOW: Hub-ul privat nu publică. | https://claude.com/blog/build-plugins-for-claude |
| 2026-09-23 | Claude Marketplace | LOW: achizițiile sunt blocate de BillingPolicy. | https://claude.com/blog/claude-marketplace |
| 2026-09-17 | Claude Desktop v2.2553.0 | LOW | https://claude.com/docs/cowork/changelog |
| 2026-09-16 | Claude Cowork și chat devin un singur Claude | MEDIUM: schimbă modul în care proprietarul pornește munca nativă. | https://support.claude.com/en/articles/16761823 |
| 2026-09-16 | Șabloane Claude Design, Slides și Docs | MEDIUM: rute de livrabile; publicarea din workeri trebuie oprită implicit. | https://support.claude.com/en/articles/17153992 |
| 2026-10-06 | Taskurile Cowork noi rulează în cloud (programat) | HIGH: afectează accesul la fișiere locale și rularea pe Windows 11 Home. | https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork |
| 2026-09-10 | Claude Desktop v1.52386.0 | MEDIUM: consum automat al ferestrei următoare. | https://claude.com/docs/cowork/changelog |
| 2026-08-25 | Memorie extinsă între chat și Cowork | MEDIUM: Hub-ul își păstrează memoria canonică. | https://support.claude.com/en/articles/12138966-release-notes |
| 2026-08-20 | Claude Desktop v1.34493.0 | LOW | https://claude.com/docs/cowork/changelog |
| 2026-08-12 | Ghid de utilizare sigură Claude in Chrome | MEDIUM: model de siguranță pentru automatizarea browserului. | https://support.claude.com/en/articles/12902428-using-claude-in-chrome-safely |
| 2026-08-06 | Actualizarea ghidului de creare de fișiere | HIGH: livrabile Office prin skill-uri. | https://support.claude.com/en/articles/12111783-create-and-edit-files-with-claude |
| 2026-07-10 | Revizia sistemului de memorie | LOW | https://support.claude.com/en/articles/12138966-release-notes |
| 2026-07-07 | Cowork pe web și mobil | MEDIUM | https://support.claude.com/en/articles/15520349 |
| 2026-07 | Fable pe usage credits pentru Pro | HIGH: risc de facturare suplimentară. | https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan |
| 2026-06-25 | Trusted Devices pentru Remote Control | MEDIUM: recomandare de securitate pentru cont. | https://support.claude.com/en/articles/12138966-release-notes |
| 2026-04-17 | Lansarea Claude Design | MEDIUM | https://support.claude.com/en/articles/12138966-release-notes |
| 2026-04-09 | Cowork GA pe macOS și Windows | HIGH | https://support.claude.com/en/articles/12138966-release-notes |
| 2026-03-25 | Aplicații interactive pe mobil | LOW | https://support.claude.com/en/articles/12138966-release-notes |
| 2026-03-23 | Computer use research preview | MEDIUM: interzis workerilor Hub. | https://support.claude.com/en/articles/14128542 |
| 2026-03-17 | Fir Cowork persistent (Dispatch) | LOW | https://support.claude.com/en/articles/13947068 |
| 2026-03-12 | Vizualizări interactive inline | LOW | https://support.claude.com/en/articles/12138966-release-notes |
| 2026-03-02 | Memorie pentru utilizatorii Free și import/export | MEDIUM: portabilitate fără lock-in. | https://support.claude.com/en/articles/12123587-importing-and-exporting-your-memory-from-claude |
| 2026-02-25 | Taskuri programate în Cowork | MEDIUM | https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork |
| 2026-02-24 | Pluginuri Cowork și controale de administrare | MEDIUM | https://support.claude.com/en/articles/12138966-release-notes |
| 2026-01-26 | Conectori interactivi (MCP Apps) | MEDIUM: posibil panou Hub în Claude Desktop prin MCP local. | https://claude.com/blog/interactive-tools-in-claude |

## plans

### Claude Max (niveluri 5x și 20x) (`an-plan-max`)

- **Sursă oficială:** https://claude.com/pricing
- **Documentație tehnică:** https://support.claude.com/en/articles/11049741-what-is-the-max-plan
- **Ce face:** Abonament individual care include tot ce are Pro (Claude Code, Cowork, Claude Design/Slides/Docs, Claude Science, Research, Projects, extensiile Chrome și Microsoft 365) plus 5x sau 20x mai multă utilizare pe sesiune de 5 ore decât Pro, limite de output mai mari, acces timpuriu la funcții și modele noi, acces prioritar la trafic ridicat și Fable inclus până la 50% din limita săptămânală.
- **Plan necesar:** Max 5x: 100 USD/lună; Max 20x: 200 USD/lună (articolul 11049741). Pagina de prețuri afișează „From $100” cu selector de nivel.
- **Platformă:** claude.ai web, Claude Desktop (Windows, macOS, Linux beta), aplicații mobile, Claude Code (CLI, IDE, Desktop, web)
- **Rollout:** GA
- **Eligibilitate cont:** Verificat local: claude auth status → authMethod claude.ai, apiProvider firstParty, subscriptionType max; get_usage din Claude Desktop (30.09.2026) → plan „Max”. Nivelul 5x sau 20x nu este expus de niciuna dintre aceste surse.
- **Autentificare:** OAuth claude.ai prin /login în clientul oficial
- **Allowance:** Fereastră de sesiune de 5 ore, limită săptămânală pentru toate modelele și fereastră săptămânală Fable (toate vizibile în get_usage). Cantitățile absolute nu sunt publicate; doar multiplicatori față de Pro.
- **Utilizare partajată:** Un singur pool pentru web, desktop, mobil, Cowork și Claude Code (FAQ-ul de prețuri și articolul 11145838).
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar dacă proprietarul activează usage credits (acum dezactivate: extraUsage.enabled=false). Trecerea 5x→20x este o schimbare de plan, interzisă automat de BillingPolicy.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Planul este consumat programatic doar prin binarul oficial Claude Code (claude -p) autentificat cu /login; identificarea planului prin claude auth status --json (câmpul subscriptionType).
- **Suprafață nativă:** claude.ai → Settings → Usage și Billing
- **Cerințe locale:** Claude Code autentificat cu contul Max; mediu de proces fără variabile ANTHROPIC_* sau CLAUDE_CODE_USE_*
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Sursa principală de capacitate Anthropic inclusă în abonament pentru toate rolurile Claude din Hub.
- **Suprafață de execuție:** anthropic.claude_account_settings
- **Echivalent la celălalt ecosistem:** ChatGPT Pro (inclusiv noul nivel de 500 USD/lună) sau Plus, folosite prin Codex
- **Ce face unic / mai bine:** Fable inclus (până la 50% săptămânal), acces prioritar, Opus 5.5 implicit în Claude Code, Claude Code și Cowork în același pool.
- **Securitate:** Se aplică Consumer Terms; limitele anunțate presupun utilizare individuală obișnuită; OAuth-ul nu trebuie intermediat de aplicații terțe.
- **Cale de implementare:** Hub-ul citește subscriptionType înainte de fiecare lot de execuție și refuză rularea dacă nu este max, dacă authMethod nu este claude.ai sau dacă apiProvider nu este firstParty.
- **Test necesar:** Confirmarea nivelului 5x/20x de către proprietar (Settings → Billing); fără inferență.
- **Status:** AVAILABLE
- **Decizie Hub:** REUSE_NATIVE
- **Încredere:** high
- **Note:** FAQ-ul de prețuri: Pro oferă cel puțin 5x Free pe sesiune, Max 5x sau 20x Pro; Anthropic își rezervă dreptul la plafoane suplimentare săptămânale, lunare sau pe modele și funcții.
- **Surse citite:** https://claude.com/pricing · https://support.claude.com/en/articles/11049741-what-is-the-max-plan · https://support.claude.com/en/articles/9797557-usage-limit-best-practices · https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan · https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan · local: claude auth status --json (sources-anthropic-local.md) · local: Claude Desktop get_usage, read-only (30.09.2026)
- **Verificare adversarială:** CONFIRMED — Am verificat claude.com/pricing: „From $100”, 5x sau 20x față de Pro pe sesiunea de 5 ore, Higher output limits, Early access, Priority access at high traffic times, Fable „50% of weekly limits”. Tot acolo, FAQ-ul spune că web, desktop, mobil și Claude Code folosesc același pool și că Anthropic poate impune plafoane săptămânale sau lunare. Articolul 11049741 confirmă 100/200 USD și resetarea săptămânală la o oră fixă alocată contului. Am recitit get_usage acum: plan „Max”, extraUsage.enabled=false; nivelul 5x/20x nu este expus. Precizare: plata anuală există doar pentru Pro și Team, deci Max este doar lunar.

### Claude Pro (plan de referință) (`an-plan-pro`)

- **Sursă oficială:** https://claude.com/pricing
- **Documentație tehnică:** https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan
- **Ce face:** Planul individual plătit de bază: Claude Code, Claude Science, Claude Design/Slides/Docs, Projects, Research, extensiile Chrome și Microsoft 365, modele Opus, Sonnet și Haiku; cel puțin 5x utilizarea Free pe sesiune; Fable doar prin usage credits (pay-as-you-go de la prima cerere); fără acces prioritar.
- **Plan necesar:** Pro: 20 USD/lună cu plată lunară sau 17 USD/lună cu plată anuală (200 USD în avans).
- **Platformă:** Web, desktop, mobil, Claude Code
- **Rollout:** GA
- **Eligibilitate cont:** Nu se aplică: contul verificat este Max, care include tot ce are Pro.
- **Autentificare:** OAuth claude.ai
- **Allowance:** Referința pentru multiplicatorii Max; fără alocare Fable inclusă.
- **Utilizare partajată:** Același pool pentru aplicații și Claude Code.
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Pe Pro, Fable și variantele [1m] ale modelelor 4.6 se facturează din usage credits; un downgrade la Pro ar muta Fable în zona plătită.
- **Risc de facturare API:** low
- **Integrare programatică:** NONE
- **Detaliu integrare:** Nu este planul activ; folosit doar ca referință pentru regulile de modele.
- **Suprafață nativă:** claude.com/pricing; Settings → Billing
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință: dacă subscriptionType devine pro, Hub-ul blochează Fable și variantele [1m].
- **Suprafață de execuție:** anthropic.claude_account_settings
- **Echivalent la celălalt ecosistem:** ChatGPT Plus
- **Ce face unic / mai bine:** Claude Code inclus la cel mai mic preț plătit.
- **Securitate:** Niciuna specifică.
- **Cale de implementare:** Regulă în politica de modele: pro → fără Fable, fără [1m].
- **Test necesar:** Niciunul
- **Status:** NOT_APPLICABLE
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Grila de prețuri afișează pentru Fable „Usage credits” la Pro și „50% of weekly limits” la ambele niveluri Max.
- **Surse citite:** https://claude.com/pricing · https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan · https://code.claude.com/docs/en/model-config
- **Verificare adversarială:** CONFIRMED — Pricing: 20 USD lunar sau 17 USD/lună la plata anuală (200 USD/an), Fable marcat „Usage credits”, fără priority access. Help Center 15424964: pe Pro, Fable 5 și 5.1 rulează pe credite (promoția Fable 5 s-a încheiat la 19.07.2026). model-config: Opus 4.6 [1m] și Sonnet 4.6 [1m] cer credite pe Pro. Din 2.1.280, modelul implicit în Claude Code pe Pro este Opus (changelog).

### Claude Team și Claude Enterprise (`an-plan-team-enterprise`)

- **Sursă oficială:** https://claude.com/pricing
- **Documentație tehnică:** https://code.claude.com/docs/en/costs
- **Ce face:** Planuri de organizație cu locuri Standard și Premium (Premium = 5x Standard), facturare centrală, SSO, controale admin; Enterprise adaugă SCIM, audit logs, Compliance API, Enterprise Analytics API, controlul modelelor și al nivelului de effort, smart reports, limite de cheltuieli pe utilizator și grup.
- **Plan necesar:** Team Standard 20 USD/loc/lună anual (25 lunar); Team Premium 100 USD/loc/lună anual (125 lunar); Enterprise self-serve 20 USD/loc/lună anual plus utilizare.
- **Platformă:** Web, desktop, mobil, Claude Code, consolă admin
- **Rollout:** GA
- **Eligibilitate cont:** Neaplicabil: cont individual Max.
- **Autentificare:** OAuth claude.ai în organizație, SSO
- **Allowance:** Alocare per loc pe ferestre de 5 ore și săptămânale, partajată cu chat și Cowork.
- **Utilizare partajată:** Per membru, în organizație
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Ar însemna un abonament nou plătit; interzis de BillingPolicy.
- **Risc de facturare API:** high
- **Integrare programatică:** NONE
- **Detaliu integrare:** n/a pentru acest cont
- **Suprafață nativă:** claude.ai Admin settings
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** NONE
- **Rol propus:** Niciunul
- **Suprafață de execuție:** anthropic.claude_account_settings
- **Echivalent la celălalt ecosistem:** ChatGPT Business / Enterprise
- **Ce face unic / mai bine:** Controale de organizație și rapoarte de cheltuieli
- **Securitate:** n/a
- **Cale de implementare:** Niciuna
- **Test necesar:** Niciunul
- **Status:** NOT_APPLICABLE
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** high
- **Note:** Funcțiile listate în release notes pentru Team/Enterprise (Claude Tag, Trusted Devices, smart reports, model entitlements) nu se aplică contului Max.
- **Surse citite:** https://claude.com/pricing · https://code.claude.com/docs/en/costs · https://support.claude.com/en/articles/12138966-release-notes
- **Verificare adversarială:** CONFIRMED — Pricing: Team Standard 20/25 USD, Premium 100/125 USD (5x Standard, Fable până la 50% săptămânal), Enterprise 20 USD/loc plus utilizare la tarife API, doar cu plată anuală. Release notes: model entitlements (01.07.2026, beta) și smart reports (10.09.2026, beta) sunt doar pe Enterprise. Documentația costs: alocare per loc pe ferestre de 5 ore și săptămânale, partajată cu chat și Cowork.

### Fluxuri de cumpărare și upgrade (/upgrade, /usage-credits, /rate-limit-options, Settings → Billing) (`an-plan-purchase-flows`)

- **Sursă oficială:** https://code.claude.com/docs/en/commands
- **Documentație tehnică:** https://code.claude.com/docs/en/costs
- **Ce face:** /upgrade deschide pagina de upgrade în browser; /usage-credits (fost /extra-usage) deschide Settings → Usage pentru activarea creditelor; /rate-limit-options oferă la atingerea limitei așteptare, credite sau upgrade; pe Pro/Max, la plafonul lunar de credite, Claude Code propune ridicarea lui direct din CLI.
- **Plan necesar:** Pro/Max (credite, upgrade); Team/Enterprise (cerere către admin)
- **Platformă:** Claude Code CLI interactiv; browser
- **Rollout:** GA
- **Eligibilitate cont:** Disponibile contului Max; Hub-ul nu le folosește.
- **Autentificare:** OAuth claude.ai
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Orice acțiune din aceste fluxuri poate produce costuri noi (credite prepay, auto-reload, plan superior); BillingPolicy le interzice.
- **Risc de facturare API:** high
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Comenzi slash interactive; Hub-ul nu trebuie să le trimită niciodată ca prompt în claude -p.
- **Suprafață nativă:** Claude Code în terminal; claude.ai Settings → Usage și Billing
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Listă neagră în adaptor: input-urile care încep cu aceste comenzi sunt respinse.
- **Suprafață de execuție:** anthropic.claude_code_interactive
- **Echivalent la celălalt ecosistem:** Cumpărarea de credite și upgrade-ul ChatGPT (metodele de credit sunt deja blocate în adaptorul Codex app-server)
- **Ce face unic / mai bine:** n/a
- **Securitate:** Un agent care ar tasta aceste comenzi ar deschide fluxuri de plată; opțiunea „Set to unlimited” elimină plafonul lunar.
- **Cale de implementare:** Gărzi native în mediul copil: DISABLE_EXTRA_USAGE_COMMAND=1 (ascunde /usage-credits), DISABLE_UPGRADE_COMMAND=1, DISABLE_LOGIN_COMMAND=1, DISABLE_LOGOUT_COMMAND=1 și CLAUDE_CODE_DISABLE_FAST_MODE=1 (suportul lor în versiunea fixată trebuie verificat). În plus, filtrul adaptorului respinge prompturile care încep cu /upgrade, /usage-credits, /extra-usage, /rate-limit-options, /fast, /login, /logout, /config, /model, /effort, /code-review ultra, /ultrareview și /insights. Motiv: în -p, /model și /effort acceptă argumente din 2.1.205, iar /insights consumă din plan.
- **Test necesar:** Test unitar al filtrului, fără model.
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Setarea autoContinueAtUsageLimit poate fi doar dezactivată prin /config key=value, nu reactivată, pentru că acordă execuție nesupravegheată.
- **Surse citite:** https://code.claude.com/docs/en/commands · https://code.claude.com/docs/en/costs · https://code.claude.com/docs/en/interactive-mode · https://claude.com/pricing
- **Verificare adversarială:** CORRECTED (corectat: implementationPath (https://code.claude.com/docs/en/env-vars; https://code.claude.com/docs/en/headless; https://code.claude.com/docs/en/commands)) — Afirmațiile despre comenzi sunt confirmate în pagina commands: /usage-credits apare cu mențiunea „Previously /extra-usage”, /rate-limit-options oferă așteptare, credite sau upgrade, iar /upgrade deschide browserul. Documentația costs confirmă promptul de ridicare a plafonului de credite pe Pro/Max. /config key=value nu poate reactiva autoContinueAtUsageLimit. Corecția adaugă gărzile native documentate și comenzile care acceptă argumente în -p.

### Acces prioritar la trafic ridicat și acces timpuriu (Max) (`an-priority-access`)

- **Sursă oficială:** https://claude.com/pricing
- **Documentație tehnică:** https://support.claude.com/en/articles/11049741-what-is-the-max-plan
- **Ce face:** Max (și Team/Enterprise) primește prioritate când traficul este ridicat și acces timpuriu la funcții și modele noi (ex.: Cowork pe web și mobil a fost lansat întâi pe Max, 07.07.2026).
- **Plan necesar:** Max 5x, Max 20x, Team Premium și Enterprise (nu și Team Standard)
- **Platformă:** Toate suprafețele
- **Rollout:** GA
- **Eligibilitate cont:** Inclus în planul Max verificat.
- **Autentificare:** OAuth claude.ai
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul
- **Risc de facturare API:** none
- **Integrare programatică:** NONE
- **Detaliu integrare:** Nu există semnal programatic; erorile 529 overloaded pot apărea în continuare.
- **Suprafață nativă:** Implicit, fără setări
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciun rol activ; Hub-ul tratează 529 cu retry și backoff, fără schimbare de furnizor spre API.
- **Suprafață de execuție:** anthropic.claude_account_settings
- **Echivalent la celălalt ecosistem:** Prioritatea planurilor Pro ChatGPT (nespecificată în sursele OpenAI citite)
- **Ce face unic / mai bine:** Stabilitate mai bună la vârfuri de trafic
- **Securitate:** Niciuna
- **Cale de implementare:** Niciuna
- **Test necesar:** Niciunul
- **Status:** AVAILABLE
- **Decizie Hub:** REUSE_NATIVE
- **Încredere:** medium
- **Note:** Beneficiu documentat pe pagina de prețuri; efectul nu poate fi măsurat din Hub.
- **Surse citite:** https://claude.com/pricing · https://support.claude.com/en/articles/11049741-what-is-the-max-plan · https://support.claude.com/en/articles/12138966-release-notes
- **Verificare adversarială:** CORRECTED (corectat: planRequired (https://claude.com/pricing)) — Pricing listează „Priority access at high traffic times” pe Max 5x, Max 20x, Team Premium și Enterprise, dar nu pe Team Standard. Release notes confirmă că Cowork pe web și mobil a fost lansat începând cu Max (07.07.2026). Restul recordului este corect.

### Limite de utilizare: sesiune de 5 ore, săptămânal și pe familii de modele (`an-usage-limits-windows`)

- **Sursă oficială:** https://support.claude.com/en/articles/9797557-usage-limit-best-practices
- **Documentație tehnică:** https://code.claude.com/docs/en/errors
- **Ce face:** Fiecare plan are o fereastră de sesiune de 5 ore (rolling) și, pe planurile plătite, limite săptămânale; pot exista ferestre separate pe model (Fable; erorile Claude Code menționează și limite Opus și Sonnet). Consumul depinde de lungimea conversației, fișiere, instrumente, model și effort; nu există un număr fix de mesaje.
- **Plan necesar:** Toate planurile; Max = 5x sau 20x Pro pe sesiune
- **Platformă:** Toate suprafețele Claude
- **Rollout:** GA. 06.05.2026: limitele de 5 ore din Claude Code dublate (Pro, Max, Team, Enterprise pe locuri) și eliminată reducerea la ore de vârf pentru Pro/Max. 22.09.2026: limitele de 5 ore crescute din nou.
- **Eligibilitate cont:** Verificat pe 30.09.2026 prin get_usage (recitit): ferestrele „5-hour limit”, „Weekly · all models” și „Weekly · Fable”. Următoarea resetare săptămânală este 2026-10-06T00:00Z, adică marți la 00:00 UTC (marți la 03:00, ora României), nu luni. Contul nu are ferestre săptămânale separate pentru Opus sau Sonnet.
- **Autentificare:** OAuth claude.ai
- **Allowance:** Cantități absolute nepublicate; limita săptămânală se resetează la o oră fixă alocată contului; Anthropic poate impune plafoane lunare sau pe funcții.
- **Utilizare partajată:** Pool comun pentru chat, Cowork și Claude Code pe toate dispozitivele
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** La epuizarea unei ferestre, cererile trec automat pe usage credits doar dacă acestea sunt activate (acum dezactivate), până la plafonul lunar.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** stream-json rate_limit_event (status allowed, allowed_warning, rejected; resetsAt; utilization); statusline rate_limits.five_hour și seven_day; mesaje de eroare de tip session/weekly/Opus/Sonnet limit cu ora de resetare; avertisment la ~85%.
- **Suprafață nativă:** claude.ai Settings → Usage; inelul de utilizare din Claude Desktop; /usage în Claude Code
- **Cerințe locale:** Claude Code autentificat cu abonamentul
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Bugetul de capacitate al Hub-ului: planificarea misiunilor și oprirea înainte de epuizare.
- **Suprafață de execuție:** anthropic.claude_account_settings
- **Echivalent la celălalt ecosistem:** Limitele Codex citite prin app-server account/rateLimits/read
- **Ce face unic / mai bine:** Fereastră Fable separată și vizibilă
- **Securitate:** Automatizarea intensă poate epuiza plafonul săptămânal și bloca utilizarea interactivă a proprietarului.
- **Cale de implementare:** Adaptorul parsează rate_limit_event și erorile de limită; Hub-ul oprește programarea peste un prag configurabil la allowed_warning și la rejected; nu schimbă automat familia de modele pentru a ocoli limitele fără regulă aprobată.
- **Test necesar:** Un turn live aprobat care confirmă că CLI-ul emite rate_limit_event în stream-json.
- **Status:** AVAILABLE
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** high
- **Note:** Limitele de sesiune și săptămânale sunt comune tuturor modelelor; schimbarea modelului ajută doar la limitele pe familie (Opus, Sonnet, Fable).
- **Surse citite:** https://support.claude.com/en/articles/9797557-usage-limit-best-practices · https://support.claude.com/en/articles/11049741-what-is-the-max-plan · https://claude.com/pricing · https://www.anthropic.com/news/higher-limits-spacex · https://www.anthropic.com/claude-opus-5-5 · https://code.claude.com/docs/en/errors · https://code.claude.com/docs/en/costs · local: Claude Desktop get_usage (30.09.2026)
- **Verificare adversarială:** CORRECTED (corectat: accountEligibility (local: Claude Desktop get_usage (30.09.2026), resetsAt 2026-10-06T00:00:00Z = Tue)) — Restul recordului este confirmat de: pricing (fereastră rulantă de 5 ore, limite săptămânale pe planurile plătite), articolul 11049741, anunțul SpaceX din 06.05.2026 (limitele de 5 ore din Claude Code dublate, reducerea la ore de vârf eliminată pentru Pro/Max), pagina Opus 5.5 (o nouă creștere a limitelor de 5 ore), pagina errors (mesaje session/weekly/Opus/Sonnet, avertisment de tip „85%”) și rate_limit_event din Agent SDK. Help Center 12429409: cu credite active, utilizatorul este notificat că se continuă pe credite.

### Alocarea Fable pe Max și consimțământul pentru usage credits (`an-fable-weekly-allowance`)

- **Sursă oficială:** https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan
- **Documentație tehnică:** https://code.claude.com/docs/en/model-config
- **Ce face:** Pe Max, Fable 5 și Fable 5.1 pot folosi până la 50% din limita săptămânală fără cost suplimentar, consumând limita mai repede decât alte modele; după plafonul Fable se continuă doar cu usage credits sau cu alt model. În sesiunile interactive Claude Code cere consimțământ înainte ca Fable să factureze credite; în -p și în Agent SDK facturează fără să întrebe.
- **Plan necesar:** Inclus: Max, Team Premium, Enterprise Premium. Doar cu credite: Pro, Team Standard.
- **Platformă:** Aplicații Claude și Claude Code (CLI ≥2.1.170 pentru Fable 5, ≥2.1.257 pentru Fable 5.1)
- **Rollout:** GA; Fable 5 a trecut pe credite pentru Pro și Team Standard la 19.07.2026
- **Eligibilitate cont:** Fereastra „Weekly · Fable” există pe cont (get_usage), deci Fable este inclus.
- **Autentificare:** OAuth claude.ai
- **Allowance:** Maximum 50% din limita săptămânală; limita săptămânală totală nu poate fi depășită.
- **Utilizare partajată:** Din același pool săptămânal cu celelalte modele
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** RIDICAT dacă usage credits ar fi activate: în -p o cerere Fable peste plafon se facturează fără prompt. Cu creditele dezactivate (starea actuală), cererea eșuează fără cost.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** claude -p --model fable; /model afișează „Requires usage credits” când se aplică; mesaje de tip Fable limit reached; dialogExpiry (implicit 5 minute) pentru consimțământ în sesiuni fără terminal (Remote Control, background, agent teams).
- **Suprafață nativă:** Settings → Usage (fereastra Fable); /model
- **Cerințe locale:** CLI ≥2.1.257 pentru Fable 5.1 (local: 2.1.175)
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Rezervat investigațiilor lungi, arhitecturii și depanării dificile, cu grant separat per misiune.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** GPT-6 Astra în limitele planului ChatGPT
- **Ce face unic / mai bine:** Cel mai capabil model inclus în Max
- **Securitate:** Facturare silențioasă în -p dacă proprietarul activează creditele; clasificatorii pot redirecționa cererile cyber/bio spre alte modele.
- **Cale de implementare:** Înaintea oricărei rulări Fable: dovadă recentă că usage credits sunt dezactivate (confirmarea proprietarului sau snapshot get_usage dintr-o sesiune Claude Desktop) și utilizare Fable sub un prag; altfel refuz.
- **Test necesar:** După actualizarea CLI aprobată: confirmare că o rulare -p la plafonul Fable, cu creditele dezactivate, eșuează curat.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Articolul Help Center 11145838 (actualizat 19.08.2026) spune că trecerea la credite cere consimțământ explicit, dar documentația Claude Code precizează excepția -p/Agent SDK pentru Fable; Hub-ul aplică regula mai strictă.
- **Surse citite:** https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan · https://claude.com/pricing · https://code.claude.com/docs/en/model-config · https://code.claude.com/docs/en/errors · https://www.anthropic.com/news/redeploying-fable-5 · https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan · local: Claude Desktop get_usage (30.09.2026)
- **Verificare adversarială:** CONFIRMED — Help Center 15424964: până la 50% din limita săptămânală, Fable consumă limitele mai repede decât alte modele, promoția Fable 5 s-a încheiat la 19.07.2026 23:59:59 PT. Minimul indicat acolo este 2.1.170 pentru Fable 5 și 2.1.255+ pentru Fable 5.1. model-config și changelog-ul indică 2.1.257, iar 2.1.255/2.1.256 nu există pe npm, deci 2.1.257 este prima versiune utilizabilă. model-config: în -p și Agent SDK, Fable facturează credite fără să întrebe. Nuanță: interactiv, după o singură acceptare promptul nu mai apare.

### Usage credits (fostul „extra usage”) (`an-usage-credits`)

- **Sursă oficială:** https://support.claude.com/en/articles/12429409-extra-usage-for-paid-claude-plans
- **Documentație tehnică:** https://code.claude.com/docs/en/costs
- **Ce face:** Permite continuarea după limitele incluse, facturat la tarife API standard, separat de abonament, pentru chat și Claude Code. Unele funcții se plătesc exclusiv din credite: fast mode, Fable pe Pro, Sonnet 4.6 cu 1M, ultrareview după rulările gratuite.
- **Plan necesar:** Pro, Max 5x, Max 20x (Team/Enterprise prin admin)
- **Platformă:** claude.ai Settings → Usage (pe web dacă abonamentul a fost cumpărat din aplicația mobilă)
- **Rollout:** GA
- **Eligibilitate cont:** Eligibil, dar DEZACTIVAT: get_usage → extraUsage.enabled=false (30.09.2026).
- **Autentificare:** Cont claude.ai plus metodă de plată
- **Allowance:** Prepay prin „Add funds”; plafon lunar sau nelimitat; limită de răscumpărare de 2.000 USD/zi; auto-reload opțional, dezactivat implicit.
- **Utilizare partajată:** Aceleași credite pentru chat și Claude Code
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Dacă este activat: consumul peste limite trece automat pe credite până la plafon; auto-reload cumpără automat sub prag; TTL-ul cache-ului scade de la 1 oră la 5 minute când se consumă credite.
- **Risc de facturare API:** high
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Activare doar din UI (Settings → Usage sau /usage-credits, care deschide browserul). Semnale: rândul de usage credits apare în /usage doar când sunt activate; rate_limit_event cu errorCode credits_required indică faptul că abonamentul este epuizat și creditele lipsesc.
- **Suprafață nativă:** claude.ai Settings → Usage → Usage credits
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Stare supravegheată: Hub-ul refuză execuția Claude fără dovadă recentă că sunt dezactivate.
- **Suprafață de execuție:** anthropic.claude_account_settings
- **Echivalent la celălalt ecosistem:** Credite suplimentare ChatGPT/Codex (blocate de BillingPolicy)
- **Ce face unic / mai bine:** n/a
- **Securitate:** Facturare automată fără prompt în -p (Fable) și la epuizarea ferestrelor; opțiunea de plafon nelimitat.
- **Cale de implementare:** Politica usage_credits=deny; snapshot periodic al stării (confirmare proprietar sau get_usage dintr-o sesiune Claude Desktop) scris în audit; blocare la orice semnal că sunt active.
- **Test necesar:** Niciun test cu model; confirmarea stării de către proprietar.
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Creditele nu expiră, cu excepția Japoniei (6 luni, din 10.09.2026). Denumirea veche „extra usage” se păstrează în URL-ul articolului și în mesajul get_usage.
- **Surse citite:** https://support.claude.com/en/articles/12429409-extra-usage-for-paid-claude-plans · https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans · https://claude.com/pricing · https://code.claude.com/docs/en/costs · https://code.claude.com/docs/en/fast-mode · https://code.claude.com/docs/en/model-config · https://code.claude.com/docs/en/errors · local: Claude Desktop get_usage (30.09.2026)
- **Verificare adversarială:** CONFIRMED — Help Center 12429409 (actualizat săptămâna aceasta) confirmă: planurile Pro, Max 5x și Max 20x; pașii Enable, Adjust limit, Set to unlimited și Add funds; auto-reload se activează opțional; limită zilnică de 2000 USD; notificare la limită, cu confirmarea că se continuă pe credite. Expirarea de 6 luni (din 10.09.2026) se aplică în jurisdicții „precum” Japonia, nu doar în Japonia. Documentația costs: TTL-ul cache-ului scade de la 1 oră la 5 minute pe credite. get_usage: creditele sunt dezactivate.

### Resetări gratuite de limită („Reset for free”) (`an-limit-resets`)

- **Sursă oficială:** https://support.claude.com/en/articles/17007452
- **Documentație tehnică:** https://www.anthropic.com/claude-opus-5-5
- **Ce face:** Anthropic acordă ocazional planurilor eligibile resetări care readuc imediat la plin limita de 5 ore sau pe cea săptămânală; la lansarea Opus 5.5 (22.09.2026) abonații au primit o resetare care poate fi păstrată și folosită oricând.
- **Plan necesar:** Planuri eligibile (anunțul Opus 5.5: abonați)
- **Platformă:** Settings → Usage → Resets pe web sau Claude Desktop; indisponibil în Claude Code (terminal/IDE) și pe mobil
- **Rollout:** Ocazional, experimental
- **Eligibilitate cont:** Necunoscută: get_usage nu expune resetările; proprietarul verifică în Settings → Usage.
- **Autentificare:** OAuth claude.ai
- **Allowance:** O resetare readuce fereastra la plin; ireversibilă; eventuala expirare este afișată în Settings → Usage.
- **Utilizare partajată:** Se aplică pool-ului comun
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu rambursează credite deja facturate și nu modifică soldul de credite.
- **Risc de facturare API:** none
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Doar butonul din UI; nu există comandă CLI sau API.
- **Suprafață nativă:** claude.ai / Claude Desktop → Settings → Usage → Resets
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Hub-ul poate recomanda folosirea resetării înaintea unei misiuni mari aprobate și înregistrează decizia proprietarului.
- **Suprafață de execuție:** anthropic.claude_account_settings
- **Echivalent la celălalt ecosistem:** Nespecificat în sursele OpenAI citite
- **Ce face unic / mai bine:** Capacitate suplimentară gratuită, la momentul ales
- **Securitate:** Niciuna
- **Cale de implementare:** Card de recomandare în Hub; fără automatizare de UI.
- **Test necesar:** Niciunul
- **Status:** ASSISTED_ONLY
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Numărul și expirarea resetării oferite la Opus 5.5 nu apar în sursele oficiale citite; surse terțe menționează o expirare în octombrie 2026 (neconfirmat).
- **Surse citite:** https://support.claude.com/en/articles/17007452 · https://www.anthropic.com/claude-opus-5-5
- **Verificare adversarială:** CONFIRMED — Articolul 17007452 („What is a limit reset?”): resetări acordate ocazional planurilor eligibile, pentru sesiunea de 5 ore sau pentru limita săptămânală. Butonul „Reset for free” este în Settings → Usage, pe web sau în Claude Desktop, și lipsește pe mobil și în Claude Code. Resetarea este ireversibilă, expirarea apare în Settings → Usage și nu rambursează credite. Pagina Opus 5.5 confirmă resetarea oferită abonaților, care poate fi păstrată și folosită oricând; nu publică o dată de expirare.

### Așteptare și continuare automată după resetarea limitei (`an-auto-continue-usage-limit`)

- **Sursă oficială:** https://code.claude.com/docs/en/interactive-mode
- **Documentație tehnică:** https://code.claude.com/docs/en/settings-reference
- **Ce face:** Când o limită claude.ai oprește o sarcină, sesiunea interactivă așteaptă resetarea și reia automat cu un prompt fix; implicit activă în sesiuni interactive cu abonament; pentru resetări mai îndepărtate de 24 de ore se folosește meniul /rate-limit-options.
- **Plan necesar:** Abonament claude.ai (nu API sau cloud providers)
- **Platformă:** Claude Code CLI interactiv ≥2.1.234
- **Rollout:** GA
- **Eligibilitate cont:** CLI local 2.1.175 nu are funcția.
- **Autentificare:** OAuth claude.ai
- **Allowance:** Consumă din fereastra resetată
- **Utilizare partajată:** Pool comun
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Continuarea nesupravegheată consumă capacitatea proaspăt resetată.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Setarea autoContinueAtUsageLimit (user sau managed); /config autoContinueAtUsageLimit=false funcționează și cu -p, dar nu o poate reactiva; nu acoperă rulările -p ale Hub-ului.
- **Suprafață nativă:** Claude Code în terminal
- **Cerințe locale:** CLI ≥2.1.234
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Model pentru logica proprie de reluare după resetare.
- **Suprafață de execuție:** anthropic.claude_code_interactive
- **Echivalent la celălalt ecosistem:** Nespecificat în sursele OpenAI citite
- **Ce face unic / mai bine:** Reluare fără pierderea contextului
- **Securitate:** Execuție nesupravegheată la resetare; în Hub trebuie să rămână sub poarta de aprobare.
- **Cale de implementare:** Hub-ul programează reluarea cu --resume pe sessionId pe baza resetsAt din rate_limit_event, doar cu grant valid și în fereastra aprobată.
- **Test necesar:** Simulare cu evenimente înregistrate; fără model.
- **Status:** DOCUMENTED
- **Decizie Hub:** REIMPLEMENT
- **Încredere:** high
- **Note:** Pentru API keys și cloud providers nu există reset de așteptat.
- **Surse citite:** https://code.claude.com/docs/en/interactive-mode · https://code.claude.com/docs/en/settings-reference · https://code.claude.com/docs/en/costs
- **Verificare adversarială:** CONFIRMED — Pagina interactive-mode confirmă: funcția este activă implicit în sesiunile interactive cu abonament claude.ai, din 2.1.234. Reia cu un prompt fix și re-armează așteptarea de cel mult două ori. Nu pornește singură pentru resetări aflate la peste 24 de ore. Rândul de așteptare lipsește în rulările -p, în sesiunile background, cu API keys și la cloud providers. /config autoContinueAtUsageLimit=false funcționează și în -p, dar nu poate reactiva setarea.

### Claude Console / Claude API (facturare separată per token) (`an-console-api-billing`)

- **Sursă oficială:** https://platform.claude.com/docs/en/about-claude/pricing
- **Documentație tehnică:** https://code.claude.com/docs/en/authentication
- **Ce face:** Acces API facturat per token, separat de abonament (Fable 5.1 10/50 USD, Opus 5.5 4/20 USD, Sonnet 5.5 2/10 USD, Haiku 4.5 1/5 USD per MTok input/output). Claude Code poate folosi Console prin claude auth login --console, prin cheie API sau prin profil Anthropic fără cheie (ant auth login); prima autentificare creează un workspace „Claude Code”.
- **Plan necesar:** Cont Console cu credite plătite
- **Platformă:** platform.claude.com; Claude Code; SDK-uri
- **Rollout:** GA
- **Eligibilitate cont:** Nefolosit; interzis de BillingPolicy.
- **Autentificare:** Cheie API, apiKeyHelper, profil Anthropic user_oauth sau WIF
- **Allowance:** Fără alocare inclusă
- **Utilizare partajată:** Separat de abonament
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Orice rulare pe această rută este cost API direct.
- **Risc de facturare API:** high
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Messages API, Models API; în Claude Code: ANTHROPIC_API_KEY, apiKeySource ANTHROPIC_API_KEY sau /login managed key.
- **Suprafață nativă:** Claude Console (Usage, Cost, Billing)
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Rută interzisă; detectată și blocată.
- **Suprafață de execuție:** anthropic.console_api
- **Echivalent la celălalt ecosistem:** OpenAI API, Agents API, Decisions API (refuzate de BillingPolicy)
- **Ce face unic / mai bine:** Batch, cache configurabil, API-uri programatice complete
- **Securitate:** O autentificare Console fără cheie scoate din uz login-ul claude.ai de pe mașină.
- **Cale de implementare:** Garda de autentificare (an-auth-precedence) și refuzul oricărei comenzi auth login --console.
- **Test necesar:** Test simulat: apiKeySource diferit de none → abort.
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Estimările de cost din /usage și total_cost_usd sunt calculate la prețul de listă API chiar și pentru abonați; nu indică facturare.
- **Surse citite:** https://claude.com/pricing · https://platform.claude.com/docs/en/about-claude/models/overview · https://code.claude.com/docs/en/authentication · https://code.claude.com/docs/en/costs · https://code.claude.com/docs/en/cli-reference
- **Verificare adversarială:** CONFIRMED — Prețurile sunt confirmate pe pricing și în models overview. claude auth login --console apare în cli-reference. Documentația costs confirmă workspace-ul „Claude Code” creat la prima autentificare Console. Pagina authentication: login-ul Console fără cheie (≥2.1.242) deconectează login-ul claude.ai de pe mașină. Estimările din /usage sunt calculate la preț de listă.

### /usage, /status, /stats, /cost și /insights în Claude Code (`an-usage-command`)

- **Sursă oficială:** https://code.claude.com/docs/en/costs
- **Documentație tehnică:** https://code.claude.com/docs/en/commands
- **Ce face:** /usage arată bare de utilizare a planului, statistici și o defalcare pe skills, subagenți, pluginuri, servere MCP, comportamente costisitoare și bucle programate (24 h sau 7 zile, doar din istoricul local); blocul Session afișează o estimare de cost la preț de listă, irelevantă pentru abonați; rândul de usage credits apare doar când creditele sunt activate. /status arată versiunea, modelul, contul și metoda de login. /insights generează un raport HTML și consumă din plan.
- **Plan necesar:** Pro, Max, Team, Enterprise pentru barele de plan
- **Platformă:** Claude Code CLI; VS Code (Account and usage)
- **Rollout:** GA
- **Eligibilitate cont:** Disponibil interactiv.
- **Autentificare:** OAuth claude.ai
- **Allowance:** Documentația de costuri precizează că /usage poate genera cereri de verificare a stării, incluse în consumul de fundal cu tokeni (de regulă sub 0,04 USD pe sesiune la preț de listă, împreună cu celelalte procese de fundal). /insights consumă din plan.
- **Utilizare partajată:** Defalcarea exclude alte dispozitive și claude.ai
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul pentru /usage și /status
- **Risc de facturare API:** none
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Comenzi interactive; conform tipurilor Agent SDK, /usage trimis ca prompt returnează ieșirea comenzii locale ca mesaj de asistent (neverificat pentru -p).
- **Suprafață nativă:** Claude Code în terminal
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Proprietarul copiază periodic starea în Hub; posibilă citire automată după test aprobat.
- **Suprafață de execuție:** anthropic.claude_code_interactive
- **Echivalent la celălalt ecosistem:** account/rateLimits/read în Codex app-server
- **Ce face unic / mai bine:** Atribuirea consumului pe skills, subagenți și MCP
- **Securitate:** Niciuna
- **Cale de implementare:** Formular Hub pentru snapshot manual; evaluarea citirii prin -p după test.
- **Test necesar:** Verificare aprobată că /usage în -p nu declanșează inferență.
- **Status:** AVAILABLE
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Când endpointul de utilizare este limitat, /usage arată ultimele bare din ultimele 60 de minute.
- **Surse citite:** https://code.claude.com/docs/en/costs · https://code.claude.com/docs/en/commands · https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan · https://code.claude.com/docs/en/agent-sdk/typescript
- **Verificare adversarială:** CORRECTED (corectat: allowance (https://code.claude.com/docs/en/costs)) — Confirmate în commands: /cost și /stats sunt aliasuri ale /usage; /status arată versiunea, modelul, contul și conectivitatea. În costs: defalcarea pe skills, subagenți, pluginuri și MCP, pe 24 h sau 7 zile, doar din istoricul local; rândul de credite apare doar când creditele sunt active; la eșec se afișează date din ultimele 60 de minute. Agent SDK: /usage trimis ca prompt revine ca mesaj de asistent.

### Status line cu rate_limits (five_hour, seven_day) (`an-usage-statusline`)

- **Sursă oficială:** https://code.claude.com/docs/en/statusline
- **Documentație tehnică:** https://code.claude.com/docs/en/statusline
- **Ce face:** Scriptul de status line primește JSON pe stdin cu rate_limits.five_hour și seven_day (used_percentage 0–100, resets_at în secunde epoch), cost.total_cost_usd, context_window.used_percentage și statistici de cache.
- **Plan necesar:** rate_limits apare doar pentru abonații claude.ai Pro/Max (sau cu limită de gateway), după primul răspuns API
- **Platformă:** Claude Code CLI interactiv
- **Rollout:** GA
- **Eligibilitate cont:** Eligibil; neconfigurat. Câmpul rate_limits există din 2.1.80 (19.03.2026), deci și în 2.1.175. Scriptul rulează doar după workspace trust. JSON-ul nu conține fereastra săptămânală Fable, doar five_hour, seven_day și spend_limit (pentru gateway).
- **Autentificare:** OAuth claude.ai
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Setarea statusLine cu o comandă locală care citește JSON; rulează doar în sesiuni interactive.
- **Suprafață nativă:** Bara de stare din Claude Code
- **Cerințe locale:** Modificarea setărilor utilizatorului (cere aprobare)
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Sursă de oglindire a procentelor de plan din sesiunile interactive ale proprietarului.
- **Suprafață de execuție:** anthropic.claude_code_interactive
- **Echivalent la celălalt ecosistem:** account/rateLimits/read în Codex app-server
- **Ce face unic / mai bine:** Procente exacte pentru ferestrele de 5 ore și 7 zile
- **Securitate:** Scriptul primește date de sesiune; trebuie să scrie doar local, spre loopback-ul Hub-ului.
- **Cale de implementare:** Script opțional care scrie un snapshot local citit de Hub; instalare doar cu aprobare.
- **Test necesar:** Test local cu JSON simulat; fără model.
- **Status:** DOCUMENTED
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** high
- **Note:** Fereastra dispare din JSON după trecerea momentului resets_at.
- **Surse citite:** https://code.claude.com/docs/en/statusline · https://code.claude.com/docs/en/errors
- **Verificare adversarială:** CORRECTED (corectat: accountEligibility (https://code.claude.com/docs/en/changelog; https://code.claude.com/docs/en/statusline)) — Pagina statusline confirmă: used_percentage 0–100 și resets_at în secunde epoch; câmpurile apar doar pentru Pro/Max sau pentru un gateway cu spend limit, după primul răspuns API; o fereastră dispare după resets_at.

### Evenimente stream-json: rate_limit_event, system/init apiKeySource, result total_cost_usd și modelUsage (`an-usage-stream-json-events`)

- **Sursă oficială:** https://code.claude.com/docs/en/agent-sdk/typescript
- **Documentație tehnică:** https://code.claude.com/docs/en/headless
- **Ce face:** rate_limit_event conține status (allowed, allowed_warning, rejected), resetsAt, utilization și, la respingere cu credite necesare, errorCode credits_required, canUserPurchaseCredits, hasChargeableSavedPaymentMethod (≥2.1.181). system/init raportează apiKeySource (ANTHROPIC_API_KEY, apiKeyHelper, /login managed key sau none). result include total_cost_usd și modelUsage (estimări locale). system/api_retry raportează categorii precum rate_limit și billing_error.
- **Plan necesar:** Orice
- **Platformă:** claude -p --output-format stream-json; Agent SDK
- **Rollout:** GA
- **Eligibilitate cont:** Disponibil în adaptorul V2; câmpurile de credite lipsesc în 2.1.175.
- **Autentificare:** OAuth claude.ai
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Parsarea evenimentelor JSONL din stdout-ul procesului claude -p.
- **Suprafață nativă:** n/a
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Sursa principală de stare pentru limite, verificarea facturării și modelul efectiv în timpul rulărilor Hub.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Notificările de rate limit din Codex app-server
- **Ce face unic / mai bine:** În bandă, fără apeluri suplimentare
- **Securitate:** total_cost_usd este o estimare la preț de listă; nu trebuie prezentat ca facturare.
- **Cale de implementare:** Abort dacă apiKeySource ≠ none; oprirea programării la rejected; alertă la allowed_warning; stocarea resetsAt pentru reluare.
- **Test necesar:** Test simulat cu evenimente; un turn live aprobat pentru confirmarea formatului în CLI.
- **Status:** DOCUMENTED
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** high
- **Note:** Tipurile sunt documentate pentru Agent SDK, care folosește același protocol stream-json ca CLI-ul.
- **Surse citite:** https://code.claude.com/docs/en/agent-sdk/typescript · https://code.claude.com/docs/en/headless · https://code.claude.com/docs/en/agent-sdk/cost-tracking
- **Verificare adversarială:** CONFIRMED — Agent SDK TypeScript (citit brut): rate_limit_event conține rate_limit_info cu status allowed/allowed_warning/rejected, resetsAt, utilization, errorCode credits_required, canUserPurchaseCredits și hasChargeableSavedPaymentMethod (câmpurile de credite din 2.1.181). ApiKeySource: ANTHROPIC_API_KEY, apiKeyHelper, /login managed key sau none. headless confirmă categoriile system/api_retry. Atenție: apiKeySource=none apare și la bearer token sau cloud provider, deci nu dovedește singur autentificarea prin abonament.

### claude.ai Settings → Usage și inelul de utilizare din Claude Desktop (`an-usage-settings-page`)

- **Sursă oficială:** https://support.claude.com/en/articles/9797557-usage-limit-best-practices
- **Documentație tehnică:** https://code.claude.com/docs/en/desktop
- **Ce face:** Settings → Usage afișează bare pentru sesiunea de 5 ore și pentru limitele săptămânale (toate modelele și Fable), orele de resetare, totalurile de usage credits și secțiunea Resets. În tab-ul Code din Claude Desktop, inelul de lângă selectorul de model arată contextul sesiunii și utilizarea planului. Sesiunile Code din Claude Desktop au și un instrument intern read-only (get_usage) care a raportat plan Max, ferestrele de mai sus și extraUsage dezactivat.
- **Plan necesar:** Planuri plătite
- **Platformă:** Web, Claude Desktop
- **Rollout:** GA
- **Eligibilitate cont:** Verificat prin get_usage (30.09.2026).
- **Autentificare:** Sesiune claude.ai
- **Allowance:** n/a
- **Utilizare partajată:** Vedere agregată pe toate suprafețele
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul
- **Risc de facturare API:** none
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Nu există API public; get_usage este disponibil doar în interiorul sesiunilor Claude Desktop, nu ca endpoint pentru Hub.
- **Suprafață nativă:** claude.ai/settings/usage; Claude Desktop → Code → inelul de utilizare
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Sursa de adevăr pentru starea usage credits și pentru nivelul de consum, confirmată de proprietar.
- **Suprafață de execuție:** anthropic.claude_account_settings
- **Echivalent la celălalt ecosistem:** Pagina de utilizare Codex și account/rateLimits/read
- **Ce face unic / mai bine:** Singura vedere completă, inclusiv credite și resetări
- **Securitate:** Niciuna
- **Cale de implementare:** Snapshot confirmat de proprietar sau solicitat unei sesiuni Claude Desktop, înregistrat în auditul Hub cu dată.
- **Test necesar:** Niciunul
- **Status:** AVAILABLE
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Procentele citite la 30.09.2026 nu sunt reținute ca stare persistentă; se recitesc înaintea fiecărei aprobări.
- **Surse citite:** https://support.claude.com/en/articles/9797557-usage-limit-best-practices · https://code.claude.com/docs/en/desktop · local: Claude Desktop get_usage (30.09.2026)
- **Verificare adversarială:** CONFIRMED — Articolul 9797557 confirmă Settings → Usage, cu bare pentru sesiune și pentru limitele săptămânale (toate modelele și Fable). Documentația desktop: inelul de utilizare arată contextul sesiunii și utilizarea planului. get_usage, recitit acum, confirmă planul Max, cele trei ferestre și extraUsage dezactivat.

### Enterprise Analytics API și Claude Code Analytics API (`an-usage-analytics-apis`)

- **Sursă oficială:** https://code.claude.com/docs/en/costs
- **Documentație tehnică:** https://platform.claude.com/docs/en/build-with-claude/claude-code-analytics-api
- **Ce face:** API-uri care returnează utilizare și costuri per utilizator: Enterprise Analytics API pentru planurile Enterprise (cheie read:analytics) și Claude Code Analytics API pentru organizațiile Console (Admin API key).
- **Plan necesar:** Enterprise sau organizație Console
- **Platformă:** API
- **Rollout:** GA
- **Eligibilitate cont:** Neaplicabil pentru un cont individual Max.
- **Autentificare:** Chei admin sau de analytics
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Ar necesita plan enterprise sau cont Console
- **Risc de facturare API:** high
- **Integrare programatică:** NONE
- **Detaliu integrare:** n/a pentru acest cont
- **Suprafață nativă:** Console, admin claude.ai
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** NONE
- **Rol propus:** Niciunul
- **Suprafață de execuție:** anthropic.console_api
- **Echivalent la celălalt ecosistem:** API-urile admin OpenAI
- **Ce face unic / mai bine:** Raportare per utilizator
- **Securitate:** n/a
- **Cale de implementare:** Niciuna
- **Test necesar:** Niciunul
- **Status:** NOT_APPLICABLE
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** high
- **Note:** Pe planurile individuale Pro/Max nu există organizație de administrat.
- **Surse citite:** https://code.claude.com/docs/en/costs
- **Verificare adversarială:** CONFIRMED — Documentația costs confirmă: Enterprise Analytics API folosește o cheie read:analytics creată de Primary Owner, iar Claude Code Analytics API folosește un Admin API key în Console. Pe Pro/Max nu există o organizație de administrat.

### Estimări de cost (total_cost_usd) și --max-budget-usd (`an-cost-estimates-budget`)

- **Sursă oficială:** https://code.claude.com/docs/en/cli-reference
- **Documentație tehnică:** https://code.claude.com/docs/en/agent-sdk/cost-tracking
- **Ce face:** Claude Code calculează local costul estimat la prețul de listă (sau la tarife din modelPricing gestionat); --max-budget-usd oprește o rulare -p când estimarea atinge plafonul, inclusiv pentru subagenți.
- **Plan necesar:** Orice
- **Platformă:** Claude Code -p, Agent SDK
- **Rollout:** GA
- **Eligibilitate cont:** Disponibil; help-ul local 2.1.175 spune „only works with --print”. Oprirea subagenților de fundal și refuzul unor noi subagenți la atingerea plafonului cer ≥2.1.217, deci pe 2.1.175 plafonul nu garantează oprirea subagenților.
- **Autentificare:** Orice
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul; estimările nu sunt facturi.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** --max-budget-usd <sumă>; câmpul total_cost_usd din result; câmpul cost.total_cost_usd din status line.
- **Suprafață nativă:** /usage (blocul Session)
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Indicator relativ de consum per turn; posibil plafon local suplimentar.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Nespecificat în sursele OpenAI citite
- **Ce face unic / mai bine:** Plafon local pe rulare
- **Securitate:** Confuzia dintre estimare și facturare în rapoarte.
- **Cale de implementare:** Afișare ca „estimare la preț de listă”; menținerea interdicției actuale asupra flag-ului până la o decizie documentată.
- **Test necesar:** Verificarea comportamentului plafonului pe abonament (nedocumentat explicit).
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Adaptorul V2 interzice acum --max-budget-usd; flag-ul ar putea deveni o siguranță suplimentară dacă se confirmă că nu are efecte de facturare.
- **Surse citite:** https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/agent-sdk/cost-tracking · https://code.claude.com/docs/en/costs · local: claude --help (2.1.175)
- **Verificare adversarială:** CORRECTED (corectat: accountEligibility (https://code.claude.com/docs/en/cli-reference; https://code.claude.com/docs/en/changelog; local: claude --help (2.1.175))) — cli-reference confirmă că --max-budget-usd funcționează doar în print mode și include subagenții. Documentațiile costs și statusline confirmă că estimările sunt la preț de listă (sau la tarifele din modelPricing), nu facturi.

### Consumatori de fundal ai limitelor (prompt suggestions, /insights, /loop, goal check-ins, subagenți, workflows, agent teams) (`an-background-usage-consumers`)

- **Sursă oficială:** https://code.claude.com/docs/en/costs
- **Documentație tehnică:** https://code.claude.com/docs/en/interactive-mode
- **Ce face:** Unele funcții consumă din plan fără prompt explicit: sugestiile de prompt după fiecare răspuns, rezumatele pentru --resume, /insights, taskurile /loop care rulează și în repaus, mesajele între sesiuni, verificările de goal (maximum 3 în repaus), subagenții, workflow-urile și agent teams (aproximativ 7x tokeni în plan mode), compactarea.
- **Plan necesar:** Orice
- **Platformă:** Claude Code
- **Rollout:** GA
- **Eligibilitate cont:** Se aplică sesiunilor proprietarului și rulărilor Hub.
- **Autentificare:** OAuth claude.ai
- **Allowance:** Din limitele planului
- **Utilizare partajată:** Pool comun cu munca interactivă a proprietarului
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Consum ascuns care poate epuiza fereastra săptămânală.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Controale: CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false, crossSessionInbound=hold, CLAUDE_CODE_GOAL_CHECKIN_MINUTES=0 și CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1 (oprește cererea de fundal pentru titlul sesiunii) sau CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1. În -p, sugestiile de prompt sunt oprite implicit; doar --prompt-suggestions le pornește. Cererea Haiku de auto-titlu din -p a fost eliminată abia în 2.1.277. Defalcarea din /usage arată buclele și subagenții.
- **Suprafață nativă:** /usage (atribuire și bucle)
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Buget: Hub-ul dezactivează în mediul copil funcțiile de fundal care nu sunt necesare.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Nespecificat în sursele OpenAI citite
- **Ce face unic / mai bine:** n/a
- **Securitate:** Sesiunile Hub care rămân deschise pot porni turnuri în repaus.
- **Cale de implementare:** Rulări -p scurte, fără /loop sau goal, cu subagenți doar la cerere și înregistrarea consumului per turn.
- **Test necesar:** Niciunul fără model
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Anthropic estimează procesele de fundal la sub 0,04 USD per sesiune la preț de listă.
- **Surse citite:** https://code.claude.com/docs/en/costs · https://code.claude.com/docs/en/interactive-mode
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://code.claude.com/docs/en/interactive-mode; https://code.claude.com/docs/en/env-vars; https://code.claude.com/docs/en/changelog)) — Documentația costs confirmă consumatorii de fundal: rezumate pentru --resume, comenzi precum /usage (sub 0,04 USD pe sesiune), scheduled tasks, mesaje cross-session, goal check-ins (maximum 3 în repaus), subagenți, workflows, agent teams (~7x tokeni în plan mode) și compactare.

### Vizibilitatea consumului (/usage, /status, statusline rate_limits, total_cost_usd) (`an-cc-usage-visibility`)

- **Sursă oficială:** https://code.claude.com/docs/en/costs
- **Documentație tehnică:** https://code.claude.com/docs/en/statusline
- **Ce face:** Arată barele de limită ale planului, atribuirea consumului pe skills/subagenți/MCP, rândul de usage credits și costul estimat local.
- **Plan necesar:** Toate; rate_limits doar pentru Pro/Max.
- **Platformă:** Local.
- **Rollout:** GA
- **Eligibilitate cont:** Max eligibil.
- **Autentificare:** claude.ai.
- **Allowance:** Fără consum (unele comenzi fac cereri mici de stare).
- **Utilizare partajată:** Nu se aplică.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** none
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Mecanism: interactiv /usage, /status, /usage-credits (deschide claude.ai). Programatic: scriptul statusLine primește JSON cu rate_limits.five_hour/seven_day.used_percentage și resets_at (Pro/Max, după primul răspuns), cost.total_cost_usd (estimare), context_window, prompt_cache; în -p: result.usage și total_cost_usd (estimare client, nu factură), system/api_retry cu rate_limit/billing_error; SDK accountInfo()/getContextUsage(). Nu există o comandă CLI documentată care returnează JSON cu limitele planului sau starea usage credits. \| Disponibil pe plan: da. \| Controlabil programatic: parțial. \| Reutilizabil din Hub: Hub poate injecta prin --settings un statusLine în sesiunile interactive lansate de el, care scrie rate_limits într-un fișier local. \| Interacțiune: confirmarea stării usage credits rămâne manuală. \| Securitate: nu se expune identitatea.
- **Suprafață nativă:** /usage, status line.
- **Cerințe locale:** Script statusLine (Node) pentru capturare.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Indicator de cotă în Hub și oprire preventivă la praguri.
- **Suprafață de execuție:** anthropic.claude_code_interactive
- **Echivalent la celălalt ecosistem:** Codex account/rateLimits/read.
- **Ce face unic / mai bine:** Ferestre 5h/7 zile cu momentul resetării.
- **Securitate:** total_cost_usd poate fi confundat cu o factură.
- **Cale de implementare:** MIRROR_STATE prin statusLine în sesiuni interactive; în -p doar evenimente api_retry și usage.
- **Test necesar:** Test simulat al parserului statusline; live doar cu grant.
- **Status:** AVAILABLE
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** medium
- **Note:** Starea usage credits nu poate fi citită programatic din documentația disponibilă.
- **Surse citite:** https://code.claude.com/docs/en/costs · https://code.claude.com/docs/en/statusline · https://code.claude.com/docs/en/headless · https://code.claude.com/docs/en/agent-sdk/typescript
- **Verificare adversarială:** CONFIRMED — costs (/usage cu bare de plan și atribuire pe skills/subagenți/pluginuri/MCP, /usage-credits spre claude.ai Settings > Usage), statusline (rate_limits doar Pro/Max, după primul răspuns; câmp prezent din v2.1.80, deci și pe 2.1.175), headless (total_cost_usd estimare client).

### Usage credits (extra usage) pe suprafețele Claude și regimul Fable (`an-usage-credits-app-surfaces`)

- **Sursă oficială:** https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans
- **Documentație tehnică:** https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan
- **Ce face:** Pe Pro și Max, după atingerea limitelor incluse, lucrul poate continua la tarife API standard plătite din credite; dezactivate implicit; se activează din Settings > Usage cu metodă de plată, plafon lunar sau nelimitat și auto-reload. Pe Max modelele Fable intră în limite până la 50% din limita săptămânală; peste acest prag se continuă cu credite sau alt model.
- **Plan necesar:** Pro, Max 5x, Max 20x.
- **Platformă:** Toate suprafețele claude.ai, Cowork, Claude Code
- **Rollout:** GA; Fable pentru Pro trecut pe credite în iulie 2026.
- **Eligibilitate cont:** Starea nu poate fi citită programatic de Hub; proprietarul o confirmă în Settings > Usage sau prin /usage într-o sesiune interactivă Claude Code (rândul usage-credits apare doar dacă sunt active).
- **Autentificare:** Setare de cont claude.ai.
- **Allowance:** Consum peste plan, la tarife API.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** În claude -p și în Agent SDK, o cerere Fable facturabilă din credite se trimite fără prompt de consimțământ; rutinele și proiectele pot continua pe credite dacă sunt activate.
- **Risc de facturare API:** high
- **Integrare programatică:** NONE
- **Detaliu integrare:** Nicio interfață programatică de citire documentată pentru Hub. Interactiv, /usage din Claude Code afișează un rând usage-credits doar cât timp creditele sunt active (verificare locală, fără inferență), iar /usage-credits deschide Settings > Usage în browser pe Pro/Max; comanda nu funcționează cu cheie API.
- **Suprafață nativă:** Settings > Usage.
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Gardă de politică: Hub-ul nu selectează Fable în workeri și cere confirmarea scrisă a proprietarului că usage credits sunt dezactivate.
- **Suprafață de execuție:** none
- **Echivalent la celălalt ecosistem:** Creditele/limitele suplimentare ChatGPT și Codex (neverificat în această sesiune).
- **Ce face unic / mai bine:** Nu se aplică
- **Securitate:** Cheltuieli neautorizate prin rulări nesupravegheate.
- **Cale de implementare:** BillingPolicy: availableModels (setare documentată, inclusiv în managed settings) fără Fable pentru workeri și fără selectarea Fable prin --model; întrebare obligatorie în checklistul de activare live privind dezactivarea usage credits.
- **Test necesar:** Test simulat al allowlist-ului de modele.
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Limita zilnică de răscumpărare a creditelor este 2.000 USD conform articolului.
- **Surse citite:** https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans · https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan · https://code.claude.com/docs/en/model-config · https://claude.com/pricing · https://code.claude.com/docs/en/routines · https://code.claude.com/docs/en/claude-projects · https://support.claude.com/en/articles/14604416-get-started-with-claude-design
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://code.claude.com/docs/en/costs), accountEligibility (https://code.claude.com/docs/en/costs), implementationPath (https://code.claude.com/docs/en/model-config)) — Confirmat textual: credite pentru Pro, Max 5x, Max 20x, dezactivate implicit, la tarife API standard, plafon lunar sau nelimitat și auto-reload, limită zilnică de 2.000 USD; pe Max Fable până la 50% din limita săptămânală, pe Pro Fable 5 trecut pe credite din 2026-07-19; în -p și Agent SDK Claude Code facturează Fable din credite fără prompt de consimțământ.

## models

### Claude Opus 5.5 (`an-model-opus-5-5`)

- **Sursă oficială:** https://www.anthropic.com/claude-opus-5-5
- **Documentație tehnică:** https://platform.claude.com/docs/en/models/opus-5-5/overview
- **Ce face:** Primul model din familia 5.5 (22.09.2026), pentru coding agentic de lungă durată și muncă de cunoaștere; conform Anthropic, la nivelul Fable 5.1 pe majoritatea sarcinilor și cu 40% mai ieftin de rulat decât Opus 5; rezultate raportate la code review, migrări mari de cod și rapoarte de cercetare; scriere mai concisă. Adaptive thinking mereu activ, effort implicit medium, context 1M, output 128K, intrare text și imagini.
- **Plan necesar:** Planuri plătite; model implicit în Claude Code pentru Pro, Max, Team, Enterprise și API (CLI ≥2.1.280)
- **Platformă:** Aplicații Claude, Claude Code, Claude API, Bedrock, Google Cloud, Microsoft Foundry, Claude Platform on AWS
- **Rollout:** GA din 22.09.2026; retragere nu mai devreme de 22.09.2027
- **Eligibilitate cont:** Disponibil contului (sesiunea Claude Desktop curentă rulează pe claude-opus-5-5), dar CLI-ul npm folosit de Hub (2.1.175) este anterior suportului adăugat în 2.1.280.
- **Autentificare:** OAuth claude.ai
- **Allowance:** Din limitele incluse ale planului
- **Utilizare partajată:** Pool comun
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Fast mode pe Opus 5.5 se plătește doar din credite; nu se activează.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** claude -p --model opus (sau claude-opus-5-5) --effort low\|medium\|high\|xhigh\|max --output-format stream-json; modelul efectiv apare în system/init și în modelUsage din result.
- **Suprafață nativă:** Selectorul de model din aplicații; /model în Claude Code
- **Cerințe locale:** Claude Code ≥2.1.280 (ultima: 2.1.285, 29.09.2026); actualizarea necesită aprobarea proprietarului
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Model implicit pentru Architect, Builder pe sarcini complexe și Reviewer.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** GPT-6.1 Sol / GPT-6 Astra în Codex
- **Ce face unic / mai bine:** Raport foarte bun cost/capabilitate; effort implicit medium economisește limitele.
- **Securitate:** Clasificatori cyber/bio cu fallback automat (bio → Opus 5, cyber → Opus 4.8); preserved thinking anti-distilare; pe API nu mai acceptă unealta computer_20251124.
- **Cale de implementare:** După actualizarea aprobată a CLI: alias opus cu effort explicit per rol și înregistrarea modelului efectiv la fiecare turn.
- **Test necesar:** Un turn live read-only aprobat după actualizare, cu verificarea system/init.model.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Benchmarkuri citate de Anthropic (raportate de furnizor): Terminal-Bench 4.0, FrontierCode v1.1, CursorBench 4.0, GDPval-AA v2.1, AutomationBench, WANDR, OSWorld 2.1, Chartography, Humanity's Last Exam.
- **Surse citite:** https://www.anthropic.com/claude-opus-5-5 · https://platform.claude.com/docs/en/models/opus-5-5/overview · https://platform.claude.com/docs/en/about-claude/models/overview · https://code.claude.com/docs/en/model-config · https://code.claude.com/docs/en/changelog · https://support.claude.com/en/articles/12138966-release-notes · https://claude.com/blog/claude-model-and-effort-level-in-claude-code
- **Verificare adversarială:** CONFIRMED — Anunțul (22.09.2026) confirmă: primul model 5.5, la nivelul Fable 5.1 pe majoritatea muncii, cu 40% mai ieftin decât Opus 5, fast mode la 8/40 USD. Overview-ul API confirmă: 1M context, 128K output, effort implicit medium, adaptive thinking mereu activ, intrare text și imagini. Tot acolo: computer_20251124 nu este acceptat pe Claude API și Google Cloud, forced tool use întoarce eroare, retragere nu mai devreme de 22.09.2027. model-config și changelog: model implicit pe Pro/Max/Team/Enterprise/API din 2.1.280.

### Claude Sonnet 5.5 (`an-model-sonnet-5-5`)

- **Sursă oficială:** https://www.anthropic.com/claude-sonnet-5-5
- **Documentație tehnică:** https://platform.claude.com/docs/en/about-claude/models/overview
- **Ce face:** Al doilea model 5.5 (28.09.2026), complement mai rapid și mai ieftin pentru Opus 5.5; conform anunțului, peste 30% mai rapid decât Sonnet 5 și până la 30% mai ieftin pe sarcină. Puncte forte raportate: coding agentic eficient, computer use (OSWorld 2.1), viziune și grafice, muncă de cunoaștere aproape de Opus 5.5 (GDPval-AA), finisare de UI și prezentări. Context 1M nativ, output 128K.
- **Plan necesar:** Planuri Claude (pagina de prețuri listează Sonnet și pe Free); aliasul sonnet în Claude Code pe API-ul Anthropic
- **Platformă:** Aplicații Claude, Claude Code, Claude API și cloud providers
- **Rollout:** GA din 28.09.2026; retragere nu mai devreme de 28.09.2027
- **Eligibilitate cont:** Disponibil pe Max; CLI local 2.1.175 nu îl cunoaște (adăugat în 2.1.284), iar acolo aliasul sonnet indică un Sonnet mai vechi.
- **Autentificare:** OAuth claude.ai
- **Allowance:** Din limitele incluse; 1M fără credite pe orice plan
- **Utilizare partajată:** Pool comun
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul specific (fast mode nu există pe Sonnet).
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** claude -p --model sonnet --effort …; effort implicit medium în Claude Code și aplicații, high pe API; auto-compact la aproximativ 967K tokeni.
- **Suprafață nativă:** Selectorul de model; /model
- **Cerințe locale:** Claude Code ≥2.1.284
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Builder pentru rutină, Tester, generare UI și documente, subagenți.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** GPT-6.1 Sol
- **Ce face unic / mai bine:** Viteză, cost mic pe sarcină, 1M fără credite
- **Securitate:** Semnalare bio → refuz (fără fallback); semnalare cyber → Sonnet 5.
- **Cale de implementare:** După actualizarea CLI: rol implicit pentru sarcini mecanice, cu effort medium.
- **Test necesar:** Un turn live aprobat după actualizare.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** WRAP
- **Încredere:** medium
- **Note:** Cifrele de benchmark provin din rezumatul automat al anunțului (raportate de furnizor); anunțul precizează că Claude Haiku 5.5 va urma în săptămânile următoare.
- **Surse citite:** https://www.anthropic.com/claude-sonnet-5-5 · https://platform.claude.com/docs/en/about-claude/models/overview · https://code.claude.com/docs/en/model-config · https://code.claude.com/docs/en/changelog · https://claude.com/pricing
- **Verificare adversarială:** CONFIRMED — Anunțul (28.09.2026) confirmă: peste 30% mai rapid, până la 30% mai ieftin, effort implicit medium în Claude Code și aplicații și high pe Claude Platform; Haiku 5.5 urmează „în săptămânile următoare”. Overview: 1M context, 128K output, retragere nu mai devreme de 28.09.2027. model-config: cyber → Sonnet 5, bio → refuz; 1M fără credite; auto-compact la ~967K. Changelog: adăugat în 2.1.284. Sonnet 5 a apărut abia în 2.1.197, deci pe 2.1.175 aliasul sonnet indică generația 4.6.

### Claude Fable 5.1 (`an-model-fable-5-1`)

- **Sursă oficială:** https://www.anthropic.com/claude-fable-and-mythos-5-1
- **Documentație tehnică:** https://platform.claude.com/docs/en/models/fable-5-1/overview
- **Ce face:** Cel mai capabil model disponibil general (01.09.2026), pentru raționament solicitant și muncă agentică de lungă durată; documentația Claude Code îl recomandă pentru sarcini mai mari decât o ședință, investigații de cauză, depanare de incidente și decizii de arhitectură; documentația API evidențiază coding agentic lung, cercetare în mai mulți pași și lucru cu documente, foi de calcul și prezentări. Effort implicit high, 1M context, 128K output, latență mai mare.
- **Plan necesar:** Max (până la 50% din limita săptămânală), Team/Enterprise Premium; Pro și Team Standard doar cu credite
- **Platformă:** Aplicații Claude, Claude Code, Claude API și cloud providers
- **Rollout:** GA din 01.09.2026; predecesorul Fable 5 a fost suspendat între 12.06 și 30.06.2026 printr-o directivă de control al exporturilor, apoi redistribuit global
- **Eligibilitate cont:** Fereastra „Weekly · Fable” există pe cont; CLI 2.1.175 suportă doar Fable 5 (Fable 5.1 cere ≥2.1.257).
- **Autentificare:** OAuth claude.ai
- **Allowance:** Maximum 50% din limita săptămânală pe Max
- **Utilizare partajată:** Pool săptămânal comun
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** Peste plafonul Fable se trece pe credite; în -p fără prompt dacă acestea sunt activate.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** claude -p --model fable (sau claude-fable-5-1) --effort high; forced tool use returnează eroare; clasificatorii redirecționează cyber → Opus 4.8 și bio → Opus 5.
- **Suprafață nativă:** Selectorul de model; /model fable
- **Cerințe locale:** Claude Code ≥2.1.257
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Investigator și arhitect pentru misiuni grele, cu grant separat și buget Fable.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** GPT-6 Astra
- **Ce face unic / mai bine:** Sesiuni autonome lungi, investigare înainte de acțiune, verificare proprie mai frecventă
- **Securitate:** Facturare silențioasă pe credite în -p dacă acestea sunt activate. Risc regulatoriu dovedit de suspendarea Fable 5 (12.06.2026; acces restabilit la 01.07.2026). Clasificatorii redirecționează cererile cyber/bio spre Opus 4.8/Opus 5. Afirmația „indisponibil sub ZDR” nu este susținută: anunțul spune că clienții eligibili pot folosi Fable 5.1 cu zero data retention până devine disponibil EFS (oricum nerelevant pentru un cont Max).
- **Cale de implementare:** Politică: Fable doar cu grant explicit, după verificarea stării creditelor și a ferestrei Fable; fallback documentat spre Opus 5.5.
- **Test necesar:** Turn live aprobat după actualizarea CLI; verificarea modelului efectiv.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Anunțul evidențiază și descoperirea vulnerabilităților, analiza de cauză și cercetarea științifică; cache read de 0,25 USD/MTok pe API.
- **Surse citite:** https://www.anthropic.com/claude-fable-and-mythos-5-1 · https://platform.claude.com/docs/en/models/fable-5-1/overview · https://code.claude.com/docs/en/model-config · https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan · https://www.anthropic.com/news/fable-mythos-access · https://www.anthropic.com/news/redeploying-fable-5
- **Verificare adversarială:** CORRECTED (corectat: securityConcerns (https://www.anthropic.com/claude-fable-and-mythos-5-1; https://support.claude.com/en/articles/12138966-release-notes)) — Celelalte câmpuri sunt confirmate. Overview-ul API: lansat la 01.09.2026, retragere nu mai devreme de 01.09.2027, effort implicit high, forced tool use întoarce eroare, Mythos 5.1 doar pe invitație (Project Glasswing). model-config: potrivit pentru sarcini mai mari decât o ședință de lucru; niciun model Fable nu este implicit. Anunțul: vulnerabilități, cauze rădăcină, cercetare științifică. Help Center confirmă includerea pe Max. Redeploying Fable 5 confirmă suspendarea din 12.06.

### Claude Haiku 4.5 (`an-model-haiku-4-5`)

- **Sursă oficială:** https://platform.claude.com/docs/en/about-claude/models/overview
- **Documentație tehnică:** https://code.claude.com/docs/en/model-config
- **Ce face:** Cel mai rapid model actual, cu inteligență aproape de frontieră; 200K context, 64K output, extended thinking, fără parametru effort; potrivit pentru răspunsuri rapide, rezumate, extracții și subagenți ieftini.
- **Plan necesar:** Toate planurile, inclusiv Free
- **Platformă:** Aplicații Claude, Claude Code, API, cloud providers
- **Rollout:** GA; retragere nu mai devreme de 15.10.2026
- **Eligibilitate cont:** Disponibil; CLI 2.1.175 acceptă aliasul haiku.
- **Autentificare:** OAuth claude.ai
- **Allowance:** Din limitele incluse
- **Utilizare partajată:** Pool comun
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul specific
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** claude -p --model haiku; CLAUDE_CODE_SUBAGENT_MODEL=haiku pentru subagenți; fără --effort.
- **Suprafață nativă:** Selectorul de model; /model haiku
- **Cerințe locale:** Niciuna suplimentară
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Triere loguri, rezumate, clasificări interne ieftine.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** GPT-6 Luna
- **Ce face unic / mai bine:** Cea mai mică latență
- **Securitate:** Capabilitate mai redusă; nu trebuie folosit pentru decizii de securitate.
- **Cale de implementare:** Rol dedicat de sumarizare cu prompturi scurte.
- **Test necesar:** Un turn live aprobat de sumarizare.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Aliasul haiku va trece probabil pe Haiku 5.5 după lansare și actualizarea CLI; fallbackModel din setările proiectului include haiku.
- **Surse citite:** https://platform.claude.com/docs/en/about-claude/models/overview · https://code.claude.com/docs/en/model-config · https://claude.com/blog/claude-model-and-effort-level-in-claude-code · https://academy.claude.com/tutorials/choosing-the-right-claude-model
- **Verificare adversarială:** CONFIRMED — Overview-ul API: „The fastest model with near-frontier intelligence”, 200K context, 64K output, extended thinking, effort nesuportat. Retragerea este programată nu mai devreme de 15.10.2026, adică peste aproximativ două săptămâni; aliasul haiku trebuie monitorizat. Pricing: Haiku este inclus și pe Free.

### Claude Haiku 5.5 (anunțat) (`an-model-haiku-5-5`)

- **Sursă oficială:** https://www.anthropic.com/claude-sonnet-5-5
- **Documentație tehnică:** https://platform.claude.com/docs/en/about-claude/models/overview
- **Ce face:** Model din familia 5.5 pentru aplicații cu volum mare și sensibile la cost, anunțat pentru săptămânile următoare lansării Sonnet 5.5.
- **Plan necesar:** Nepublicat
- **Platformă:** Nepublicat
- **Rollout:** Anunțat; fără dată
- **Eligibilitate cont:** Necunoscută
- **Autentificare:** OAuth claude.ai (presupus, ca pentru celelalte modele)
- **Allowance:** Nepublicat
- **Utilizare partajată:** Nepublicat
- **Inclus în abonament?:** unknown
- **Risc de facturare suplimentară (credite/extra usage):** Necunoscut
- **Risc de facturare API:** unknown
- **Integrare programatică:** UNKNOWN
- **Detaliu integrare:** Se va descoperi prin alias haiku după lansare și actualizarea CLI.
- **Suprafață nativă:** Nepublicat
- **Cerințe locale:** Probabil o versiune nouă de Claude Code
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Posibil înlocuitor pentru Haiku 4.5 în triere.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** GPT-6 Luna
- **Ce face unic / mai bine:** Necunoscute
- **Securitate:** Niciuna cunoscută
- **Cale de implementare:** Reevaluare la lansare.
- **Test necesar:** După lansare
- **Status:** ROLLOUT_PENDING
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Menționat doar în anunțul Sonnet 5.5.
- **Surse citite:** https://www.anthropic.com/claude-sonnet-5-5 · https://platform.claude.com/docs/en/about-claude/models/overview
- **Verificare adversarială:** CONFIRMED — Anunțul Sonnet 5.5: Claude Haiku 5.5, gândit pentru aplicații cu volum mare și sensibile la cost, va intra în familia 5.5 în săptămânile următoare. Modelul nu apare încă în models overview.

### Claude Mythos 5.1 (`an-model-mythos-5-1`)

- **Sursă oficială:** https://www.anthropic.com/claude-fable-and-mythos-5-1
- **Documentație tehnică:** https://platform.claude.com/docs/en/models/fable-5-1/overview
- **Ce face:** Aceleași capabilități și specificații ca Fable 5.1, cu salvgarduri mai permisive; acces doar pe invitație (Project Glasswing) sau prin programe de verificare pentru securitate defensivă și științele vieții.
- **Plan necesar:** Program restricționat pentru organizații verificate; nu este oferit pe abonamentele consumer
- **Platformă:** API și cloud providers pentru participanți
- **Rollout:** Acces restricționat
- **Eligibilitate cont:** Neeligibil
- **Autentificare:** n/a
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Ar necesita facturare API separată
- **Risc de facturare API:** high
- **Integrare programatică:** NONE
- **Detaliu integrare:** n/a
- **Suprafață nativă:** n/a
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** NONE
- **Rol propus:** Niciunul
- **Suprafață de execuție:** none
- **Echivalent la celălalt ecosistem:** Posibil analog: accesul la modele Daybreak din Codex Security Cloud (neverificat)
- **Ce face unic / mai bine:** Salvgarduri permisive pentru domenii dual-use
- **Securitate:** n/a
- **Cale de implementare:** Niciuna
- **Test necesar:** Niciunul
- **Status:** PLAN_RESTRICTED
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** high
- **Note:** Documentația API și anunțul descriu căi de acces ușor diferite (Project Glasswing vs. programe de verificare); ambele sunt restricționate.
- **Surse citite:** https://www.anthropic.com/claude-fable-and-mythos-5-1 · https://platform.claude.com/docs/en/models/fable-5-1/overview · https://www.anthropic.com/news/life-sciences-verification-program · https://www.anthropic.com/news/expanding-project-glasswing
- **Verificare adversarială:** CONFIRMED — Overview-ul API: aceleași specificații ca Fable 5.1, disponibil doar pe invitație, prin Project Glasswing. Anunțul: acces prin Cyber Verification Program și Life Sciences Verification Program, momentan doar pentru un set de organizații din SUA. Nu este oferit pe abonamentele consumer.

### Modele anterioare încă disponibile (Fable 5, Opus 5, Sonnet 5, Opus 4.8, Opus 4.7, Opus 4.6, Sonnet 4.6, Sonnet 4.5, Opus 4.5) (`an-models-legacy`)

- **Sursă oficială:** https://platform.claude.com/docs/en/about-claude/models/overview
- **Documentație tehnică:** https://code.claude.com/docs/en/model-config
- **Ce face:** Rămân selectabile prin ID complet; servesc drept ținte de fallback pentru clasificatori (Opus 5 pentru bio, Opus 4.8 pentru cyber) și sunt modelele pe care le folosește implicit un CLI vechi.
- **Plan necesar:** Planuri plătite (Fable 5 cu aceleași reguli ca Fable 5.1)
- **Platformă:** Claude Code, API
- **Rollout:** Legacy active
- **Eligibilitate cont:** Documentat în model-config: între v2.1.154 și v2.1.218, aliasul default pe Max rezolva la Opus 4.8, deci CLI 2.1.175 rulează implicit Opus 4.8. Aliasul fable indică Fable 5 (introdus în 2.1.170). Sonnet 5 a apărut abia în 2.1.197 (30.06.2026), așa că aliasul sonnet din 2.1.175 indică cel mai probabil Sonnet 4.6 (neverificat printr-o rulare).
- **Autentificare:** OAuth claude.ai
- **Allowance:** Din limitele incluse
- **Utilizare partajată:** Pool comun
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Variantele [1m] ale modelelor 4.6 pot cere credite (Sonnet 4.6 [1m] pe orice plan).
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** claude -p --model <ID complet>, de ex. claude-fable-5, claude-opus-5; ID-ul efectiv apare în system/init.
- **Suprafață nativă:** /model
- **Cerințe locale:** Versiunea CLI trebuie să cunoască modelul
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Doar ținte de fallback documentate; nu se aleg explicit.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Modele GPT anterioare în Codex
- **Ce face unic / mai bine:** Stabilitate pentru comparații
- **Securitate:** Hub-ul poate primi răspunsuri de la un model mai vechi decât cel presupus dacă CLI-ul nu este actualizat.
- **Cale de implementare:** Înregistrarea modelului efectiv la fiecare turn; alertă când diferă de modelul cerut.
- **Test necesar:** Turn live aprobat pentru a confirma modelul implicit al CLI-ului local.
- **Status:** AVAILABLE
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Fast mode pentru Opus 4.7 a fost eliminat la 24.07.2026.
- **Surse citite:** https://platform.claude.com/docs/en/about-claude/models/overview · https://code.claude.com/docs/en/model-config · https://code.claude.com/docs/en/fast-mode · https://registry.npmjs.org/@anthropic-ai/claude-code
- **Verificare adversarială:** CORRECTED (corectat: accountEligibility (https://code.claude.com/docs/en/model-config; https://code.claude.com/docs/en/changelog)) — Lista modelelor legacy este confirmată în models overview, iar țintele de fallback ale clasificatorilor în model-config. Pagina fast-mode confirmă că fast mode pentru Opus 4.7 a fost depreciat la 25.06.2026 și eliminat la 24.07.2026.

### Selecția modelului în Claude Code (aliasuri, precedență, variabile de mediu) (`an-claude-code-model-selection`)

- **Sursă oficială:** https://code.claude.com/docs/en/model-config
- **Documentație tehnică:** https://code.claude.com/docs/en/cli-reference
- **Ce face:** Ordine: /model în sesiune > --model > ANTHROPIC_MODEL > setarea model > ANTHROPIC_DEFAULT_MODEL > implicitul contului sau organizației. Aliasuri: default, best (Fable unde e disponibil), fable, opus, sonnet, haiku, sonnet[1m], opus[1m], opusplan. ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL redirecționează aliasurile; CLAUDE_CODE_SUBAGENT_MODEL setează subagenții; /model scrie în setările utilizatorului.
- **Plan necesar:** Orice plan cu Claude Code
- **Platformă:** Claude Code CLI
- **Rollout:** GA
- **Eligibilitate cont:** Disponibil; implicitul Opus 5.5 pe Max apare doar din CLI 2.1.280.
- **Autentificare:** OAuth claude.ai
- **Allowance:** Din limitele modelului ales
- **Utilizare partajată:** Pool comun
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Aliasul best sau o variabilă moștenită poate selecta Fable sau o variantă [1m] care consumă credite.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** --model <alias\|ID> la fiecare rulare -p. În -p (≥2.1.205), /model se aplică doar sesiunii curente și nu se salvează; interactiv, /model salvează modelul ca implicit în setările utilizatorului. Gardă nativă suplimentară: availableModels și enforceAvailableModels au scope „Any file” și pot fi trimise prin --settings; deniedModels și availableModelsMatch funcționează doar în managed settings.
- **Suprafață nativă:** /model, /config
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Selecție deterministă per rol, controlată de Hub.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** model/list și turn/start cu model în Codex app-server
- **Ce face unic / mai bine:** Aliasuri stabile între versiuni
- **Securitate:** Variabilele ANTHROPIC_MODEL și ANTHROPIC_DEFAULT_* moștenite ar putea schimba modelul fără știrea Hub-ului.
- **Cale de implementare:** Mediu controlat fără ANTHROPIC_MODEL, ANTHROPIC_DEFAULT_*_MODEL și CLAUDE_CODE_SUBAGENT_MODEL, inclusiv în blocul env al setărilor. --model explicit la fiecare rulare. Interzicerea aliasurilor best și opusplan și a sufixului [1m]. Opțional, availableModels prin --settings, cu lista modelelor aprobate pentru rol.
- **Test necesar:** Test unitar al construcției argumentelor și al filtrării mediului.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Adminii pot restricționa modele prin availableModels, enforceAvailableModels și deniedModels în managed settings.
- **Surse citite:** https://code.claude.com/docs/en/model-config · https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/costs
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://code.claude.com/docs/en/model-config; https://code.claude.com/docs/en/settings-reference), implementationPath (https://code.claude.com/docs/en/settings-reference)) — Precedența, aliasurile și variabilele ANTHROPIC_DEFAULT_*_MODEL și CLAUDE_CODE_SUBAGENT_MODEL sunt confirmate în model-config. Corecții: motivul „/model persistă” nu se aplică în -p. Nota despre admini este parțial greșită: doar deniedModels și availableModelsMatch sunt exclusiv managed; availableModels poate fi folosit și de Hub.

### Niveluri de effort și adaptive thinking (`an-effort-levels`)

- **Sursă oficială:** https://code.claude.com/docs/en/model-config
- **Documentație tehnică:** https://platform.claude.com/docs/en/build-with-claude/effort
- **Ce face:** Effort controlează cât gândește și cât verifică modelul: low, medium, high, xhigh, max pe Fable 5.x, Opus 5.5, Sonnet 5.5, Opus 5, Sonnet 5, Opus 4.8/4.7 (Opus 4.6/Sonnet 4.6 fără xhigh). Implicit medium pe Opus 5.5 și Sonnet 5.5, high pe celelalte, xhigh pe Opus 4.7. max se aplică doar sesiunii curente și poate duce la raționament excesiv. Thinking nu poate fi oprit pe Opus 5.5, Sonnet 5.5 și Fable; cuvântul ultrathink cere mai mult raționament pe un singur turn.
- **Plan necesar:** Toate planurile cu Claude Code; pe Enterprise adminii pot plafona effort
- **Platformă:** Claude Code; aplicațiile Claude (implicit medium pentru Sonnet 5.5)
- **Rollout:** GA
- **Eligibilitate cont:** Disponibil: help-ul CLI 2.1.175 listează low, medium, high, xhigh, max.
- **Autentificare:** OAuth claude.ai
- **Allowance:** Effort mai mare consumă limitele mai repede
- **Utilizare partajată:** Pool comun
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul direct; doar consum mai rapid din plan.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** --effort <level> per rulare; CLAUDE_CODE_EFFORT_LEVEL; modelSettings și effortLevel în setări; maxEffortLevel ca plafon; /effort în -p nu se salvează; effort în frontmatter-ul skill-urilor și subagenților.
- **Suprafață nativă:** /effort, slider-ul din /model, controlul de effort din Remote Control
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Politică de effort per rol: low/medium pentru rutină, high pentru bugfix, xhigh pentru arhitectură, max doar cu aprobare.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Reasoning effort în Codex (turn/start effort)
- **Ce face unic / mai bine:** Scala este calibrată per model. Pe Terminal-Bench 4.0, Opus 5.5 la effort implicit (medium) depășește Opus 5 la max, la aproximativ o cincime din cost (raportat de Anthropic).
- **Securitate:** Effort mare mărește autonomia și numărul de decizii luate singur.
- **Cale de implementare:** Hub-ul trimite mereu --effort explicit și elimină CLAUDE_CODE_EFFORT_LEVEL din mediu, pentru că variabila are prioritate față de --effort și /effort. Opțional, plafon nativ prin maxEffortLevel în --settings (scope Any file, ≥2.1.195).
- **Test necesar:** Test unitar al mapării rol → effort.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Blogul Anthropic recomandă pornirea de la effort-ul implicit și creșterea lui doar când modelul sare pași sau abandonează lucrul.
- **Surse citite:** https://code.claude.com/docs/en/model-config · https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/commands · https://www.anthropic.com/claude-sonnet-5-5 · https://claude.com/blog/claude-model-and-effort-level-in-claude-code · local: claude --help (2.1.175)
- **Verificare adversarială:** CORRECTED (corectat: uniqueStrengths (https://www.anthropic.com/claude-opus-5-5), implementationPath (https://code.claude.com/docs/en/env-vars; https://code.claude.com/docs/en/model-config)) — Confirmate în model-config: nivelurile pe model; implicitele (medium pe Opus/Sonnet 5.5, xhigh pe Opus 4.7, high în rest); max se aplică doar sesiunii (excepție: CLAUDE_CODE_EFFORT_LEVEL); /effort în -p nu se salvează. Documentația costs: thinking nu poate fi oprit pe Opus 5.5, Sonnet 5.5 și Fable. Help-ul local 2.1.175 listează low…max. Blogul Anthropic recomandă pornirea de la effort-ul implicit.

### Fast mode pentru Opus (research preview) (`an-fast-mode`)

- **Sursă oficială:** https://code.claude.com/docs/en/fast-mode
- **Documentație tehnică:** https://platform.claude.com/docs/en/build-with-claude/fast-mode
- **Ce face:** Configurație de viteză pentru Opus 5.5, Opus 5 și Opus 4.8, până la 2,5x mai rapidă, cu aceeași calitate și preț per token mai mare (8/40 USD per MTok pe Opus 5.5).
- **Plan necesar:** Pe abonamente doar prin usage credits, niciodată din limitele incluse; Team/Enterprise necesită activarea de către Owner
- **Platformă:** Claude Code CLI, VS Code, sesiuni cloud (≥2.1.271) și claude.ai/code; Claude Console API cu acces provizionat. Indisponibil pe Amazon Bedrock, Google Cloud Agent Platform, Microsoft Foundry și Claude Platform on AWS.
- **Rollout:** Research preview
- **Eligibilitate cont:** Blocat: creditele sunt dezactivate, deci /fast ar raporta că fast mode necesită usage credits.
- **Autentificare:** OAuth claude.ai
- **Allowance:** Niciuna inclusă
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Se facturează din credite chiar dacă mai există utilizare în plan; prima activare într-o conversație plătește tot contextul la preț necache-uit.
- **Risc de facturare API:** high
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** /fast sau setarea fastMode. În -p funcționează doar dacă sesiunea pornește cu fastMode true în --settings (≥2.1.205), fără salvare. fastModePerSessionOptIn poate fi pus în orice fișier de setări (Owners Team/Enterprise îl pot impune prin server-managed). CLAUDE_CODE_DISABLE_FAST_MODE=1 dezactivează complet funcția.
- **Suprafață nativă:** /fast; meniul de model din claude.ai/code
- **Cerințe locale:** Usage credits activate
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Niciunul
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Ultrafast (GPT-6 Astra Ultrafast, exclusiv Pro 500 USD) și funcția fast_mode din Codex
- **Ce face unic / mai bine:** Latență mică pentru iterații interactive
- **Securitate:** Cost ascuns dacă fastMode rămâne salvat în setările utilizatorului.
- **Cale de implementare:** CLAUDE_CODE_DISABLE_FAST_MODE=1 în mediul copil, ca gardă nativă. În plus: respingerea /fast și a oricărui --settings cu fastMode, și verificarea că setările user/project/local nu conțin fastMode true.
- **Test necesar:** Test unitar al filtrului.
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Pe Pro și Max cheltuiala de fast mode apare în Settings → Usage → Usage credits, fără defalcare separată.
- **Surse citite:** https://code.claude.com/docs/en/fast-mode · https://code.claude.com/docs/en/model-config · https://www.anthropic.com/claude-opus-5-5
- **Verificare adversarială:** CORRECTED (corectat: platform (https://code.claude.com/docs/en/fast-mode), programmaticDetail (https://code.claude.com/docs/en/fast-mode; https://code.claude.com/docs/en/env-vars), implementationPath (https://code.claude.com/docs/en/env-vars)) — Confirmate în fast-mode: Opus 5.5, Opus 5 și Opus 4.8; până la 2,5x mai rapid; 8/40 USD pe Opus 5.5 (10/50 pe Opus 5 și 4.8); research preview. Pe abonamente se plătește doar din credite, chiar dacă mai există utilizare în plan. Activarea în mijlocul conversației plătește tot contextul necache-uit. Cheltuiala apare în Settings → Usage, fără defalcare separată.

### Fereastra de context de 1M tokeni (`an-1m-context`)

- **Sursă oficială:** https://code.claude.com/docs/en/model-config
- **Documentație tehnică:** https://platform.claude.com/docs/en/build-with-claude/context-windows
- **Ce face:** Fable 5.x, Sonnet 5/5.5 și Opus 4.7+ rulează nativ cu 1M pe toate planurile, fără sufix [1m] și fără credite, pe API-ul Anthropic direct; Opus 4.6 [1m] este inclus pe Max; Sonnet 4.6 [1m] cere credite pe orice plan. Auto-compact la aproximativ 967K; fără suprapreț peste 200K.
- **Plan necesar:** Inclus pe Max pentru modelele native și Opus 4.6 [1m]
- **Platformă:** Claude Code, API
- **Rollout:** GA
- **Eligibilitate cont:** Pe Max inclus pentru modelele native după actualizarea CLI. Cu CLI 2.1.175, aliasul sonnet[1m] ar viza probabil Sonnet 4.6 [1m], care cere credite (eroare fără cost cu creditele dezactivate).
- **Autentificare:** OAuth claude.ai
- **Allowance:** Din limitele incluse (contextul lung consumă mai mult)
- **Utilizare partajată:** Pool comun
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** Variantele [1m] ale modelelor 4.6 pot factura credite dacă acestea sunt activate.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Selecție implicită pentru modelele native; CLAUDE_CODE_DISABLE_1M_CONTEXT=1 dezactivează; CLAUDE_CODE_AUTO_COMPACT_WINDOW alege pragul de compactare.
- **Suprafață nativă:** /model, /context
- **Cerințe locale:** CLI actualizat pentru modelele 5.5
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Context mare pentru analize de cod întregi, cu buget controlat.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Context mare al modelelor GPT-6 (nespecificat în sursele citite)
- **Ce face unic / mai bine:** 1M inclus în abonament pentru modelele actuale
- **Securitate:** Contextul lung crește consumul la fiecare cerere și ratele de cache miss.
- **Cale de implementare:** Interzicerea sufixului [1m] în adaptor; monitorizarea context_window din stream; compactare controlată.
- **Test necesar:** Niciunul fără model
- **Status:** DOCUMENTED
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Planul de verificare a creditelor pentru [1m] se aplică doar la conectare directă la API-ul Anthropic.
- **Surse citite:** https://code.claude.com/docs/en/model-config · https://code.claude.com/docs/en/errors · https://platform.claude.com/docs/en/about-claude/models/overview
- **Verificare adversarială:** CONFIRMED — model-config confirmă: 1M nativ pe Fable 5.x, Sonnet 5/5.5 și Opus 4.7+, pe API-ul Anthropic, pe toate planurile. Opus 4.6 [1m] este inclus pe Max/Team/Enterprise; Sonnet 4.6 [1m] cere credite pe orice abonament. Auto-compact la ~967K. Verificarea planului se face doar la conectare directă. Sonnet 5 a apărut în 2.1.197, deci estimarea „sonnet[1m] = Sonnet 4.6 [1m]” pe 2.1.175 este plauzibilă.

### Fallback automat la semnalarea clasificatorilor de siguranță (`an-classifier-fallback`)

- **Sursă oficială:** https://code.claude.com/docs/en/model-config
- **Documentație tehnică:** https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback
- **Ce face:** Pe Fable 5.x, Opus 5.5, Sonnet 5.5 și Opus 5, cererile semnalate (în special cyber și bio) sunt rerulate automat pe alt model. Fable și Opus 5.5 → Opus 5 pentru bio și Opus 4.8 pentru cyber. Sonnet 5.5 → Sonnet 5 pentru cyber, refuz pentru bio. Opus 5 → Opus 4.8 pentru cyber, refuz pentru bio. După fallback, sesiunea continuă pe modelul de rezervă. Cu switchModelsOnFlag=false, sesiunea interactivă se oprește și oferă alegerea, iar în -p sau SDK turul se încheie cu refuz.
- **Plan necesar:** Toate planurile
- **Platformă:** Claude Code (≥2.1.219 pentru fallback pe categorii)
- **Rollout:** GA
- **Eligibilitate cont:** Se aplică automat.
- **Autentificare:** OAuth claude.ai
- **Allowance:** Rerularea consumă din plan
- **Utilizare partajată:** Pool comun
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul direct
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Setarea switchModelsOnFlag; notificare în transcript; modelul efectiv apare în modelUsage.
- **Suprafață nativă:** /config (Switch models when a message is flagged)
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Transparență: fiecare turn cu fallback este marcat în audit.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Nespecificat în sursele OpenAI citite
- **Ce face unic / mai bine:** Continuitate în loc de refuz
- **Securitate:** Review-urile de securitate ale Hub-ului pot declanșa fallback frecvent; rezultatul provine de la alt model decât cel aprobat.
- **Cale de implementare:** Înregistrarea modelului efectiv și marcarea turnurilor cu fallback. --model explicit la fiecare --resume, altfel sesiunea rămâne pe modelul de rezervă. Opțional, switchModelsOnFlag=false prin --settings, ca turnurile semnalate să eșueze explicit în loc să schimbe modelul fără anunț.
- **Test necesar:** Comportamentul în -p cu switchModelsOnFlag=false este documentat: turul se încheie cu refuz/eroare. Rămâne de confirmat doar formatul evenimentului în stream-json, printr-un turn aprobat.
- **Status:** DOCUMENTED
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Pentru munca biologică substanțială pe Fable sau Opus 5.5, sesiunea trece pe Opus 5 la prima semnalare.
- **Surse citite:** https://code.claude.com/docs/en/model-config · https://code.claude.com/docs/en/settings-reference · https://www.anthropic.com/news/fable-safeguards-jailbreak-framework · https://www.anthropic.com/news/redeploying-fable-5
- **Verificare adversarială:** CORRECTED (corectat: whatItDoes (https://code.claude.com/docs/en/model-config), testRequired (https://code.claude.com/docs/en/settings-reference), implementationPath (https://code.claude.com/docs/en/model-config)) — Nuanțe din model-config: înainte de 2.1.219 (deci și pe 2.1.175 local), orice cerere Fable 5 semnalată rula pe Opus-ul implicit al furnizorului. Contextul repository-ului (CLAUDE.md, git status) poate declanșa clasificatorul încă de la primul turn.

### Lanț de fallback la indisponibilitate (fallbackModel / --fallback-model) (`an-fallback-model-chain`)

- **Sursă oficială:** https://code.claude.com/docs/en/model-config
- **Documentație tehnică:** https://code.claude.com/docs/en/cli-reference
- **Ce face:** Când modelul principal este supraîncărcat sau indisponibil, Claude Code încearcă în ordine modelele din lanț (maximum 3), doar pentru turnul curent; se aplică și subagenților și compactării; /status nu afișează lanțul.
- **Plan necesar:** Orice plan
- **Platformă:** Claude Code
- **Rollout:** GA
- **Eligibilitate cont:** Setările proiectului definesc fallbackModel [opus, haiku]. Setarea există din 2.1.166 (array, maximum 3 modele), deci 2.1.175 o aplică. În 2.1.175 compactarea nu respecta lanțul (reparat în 2.1.178), iar failover-ul subagenților există abia din 2.1.247. Adaptorul V2 interzice doar flag-ul --fallback-model.
- **Autentificare:** OAuth claude.ai
- **Allowance:** Din limitele modelelor de rezervă
- **Utilizare partajată:** Pool comun
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul direct
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Setarea fallbackModel (array) și flag-ul --fallback-model (listă separată prin virgulă), flag-ul are prioritate; prima notificare de comutare este singurul semn vizibil.
- **Suprafață nativă:** Notificare în transcript
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Doar cu înregistrarea modelului efectiv.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Nespecificat în sursele OpenAI citite
- **Ce face unic / mai bine:** Reziliență la supraîncărcare
- **Securitate:** Hub-ul poate primi un răspuns de la un model mai slab (haiku) pentru o sarcină complexă fără să știe.
- **Cale de implementare:** Înregistrarea modelului efectiv per turn; decizia proprietarului dacă fallbackModel rămâne în setările proiectului.
- **Test necesar:** Test unitar al argumentelor: --setting-sources user (exclude setările project/local, inclusiv fallbackModel, hooks și env din repository) sau un lanț explicit prin --settings/--fallback-model, care au prioritate. Apoi confirmarea live aprobată a modelului efectiv.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** medium
- **Note:** Neutralizarea fără modificarea fișierului este documentată: prin precedența setărilor (--settings și --fallback-model au prioritate față de setările proiectului) sau prin --setting-sources. Fișierul cu precedența cea mai mare furnizează întregul lanț. /status nu afișează lanțul.
- **Surse citite:** https://code.claude.com/docs/en/model-config · https://code.claude.com/docs/en/cli-reference · local: .claude/settings.json fallbackModel [opus, haiku] (sources-anthropic-local.md)
- **Verificare adversarială:** CORRECTED (corectat: accountEligibility (https://code.claude.com/docs/en/changelog; https://code.claude.com/docs/en/model-config), testRequired (https://code.claude.com/docs/en/cli-reference; https://code.claude.com/docs/en/settings-reference), notes (https://code.claude.com/docs/en/settings-reference)) — Afirmația „nu este clar dacă 2.1.175 acceptă forma array” este infirmată de changelog-ul 2.1.166. Restul este confirmat în model-config: comutarea durează doar turul curent și lanțul se aplică subagenților și compactării.

### Modele disponibile în aplicațiile Claude pe plan (`an-models-in-claude-apps`)

- **Sursă oficială:** https://claude.com/pricing
- **Documentație tehnică:** https://academy.claude.com/tutorials/choosing-the-right-claude-model
- **Ce face:** Free: Sonnet și Haiku. Pro: plus Opus și Fable (Fable doar prin credite). Max: Opus, Sonnet, Haiku și Fable (până la 50% din limita săptămânală). Ghidul Anthropic: Haiku pentru răspunsuri rapide și extracții, Sonnet pentru coding, scriere și analiză, Opus pentru cercetare profundă și raționament complex, Fable pentru sarcini lungi și complexe. Sonnet 5.5 rulează implicit cu effort medium în aplicații.
- **Plan necesar:** Conform planului
- **Platformă:** Web, desktop, mobil
- **Rollout:** GA
- **Eligibilitate cont:** Max: toate familiile disponibile.
- **Autentificare:** OAuth claude.ai
- **Allowance:** Din limitele planului
- **Utilizare partajată:** Pool comun cu Claude Code
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Fable peste plafon doar cu credite.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Doar selectorul de model din UI; nu există API de abonament pentru aplicații.
- **Suprafață nativă:** Selectorul de model din claude.ai și Claude Desktop
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Suprafață ASSISTED: Hub-ul pregătește brief-uri, proprietarul rulează în aplicație și aduce rezultatul.
- **Suprafață de execuție:** anthropic.claude_chat
- **Echivalent la celălalt ecosistem:** Selectorul de modele ChatGPT (GPT-6.1 Sol încă neexpus în Chat, conform DevDay)
- **Ce face unic / mai bine:** Aceleași modele ca în Claude Code, cu Cowork și artefacte
- **Securitate:** Memoria Claude (activă implicit pe Max) poate reține informații în afara Hub-ului.
- **Cale de implementare:** Export Markdown al brief-urilor și import manual al rezultatelor.
- **Test necesar:** Niciunul
- **Status:** AVAILABLE
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Tutorialul Academy nu are dată și menționează încă Sonnet 5 și Opus 5; modelul implicit din aplicații pentru Max nu apare în sursele citite.
- **Surse citite:** https://claude.com/pricing · https://academy.claude.com/tutorials/choosing-the-right-claude-model · https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan · https://www.anthropic.com/claude-sonnet-5-5
- **Verificare adversarială:** CONFIRMED — Pricing: Free are Sonnet și Haiku; Pro are Opus, Sonnet, Haiku și Fable prin credite; Max are Fable până la 50% săptămânal. Tutorialul Academy nu are dată și menționează încă Sonnet 5 și Opus 5. Anunțul Sonnet 5.5: effort implicit medium în aplicații. Release notes din 25.08.2026: memoria este activă implicit pe Free, Pro și Max.

### Selecția modelului și a efortului (`--model`, aliasuri, `--effort`, fallbackModel) (`an-cc-model-effort`)

- **Sursă oficială:** https://code.claude.com/docs/en/model-config
- **Documentație tehnică:** https://code.claude.com/docs/en/cli-reference
- **Ce face:** Alege modelul per sesiune (fable, opus, sonnet, haiku, best, opusplan, sufix [1m]) și nivelul de efort low până la max.
- **Plan necesar:** Max: Opus, Sonnet, Haiku incluse; Fable separat (vezi an-cc-fable-access).
- **Platformă:** Toate.
- **Rollout:** GA
- **Eligibilitate cont:** Max verificat; Opus 5.5, Sonnet 5.5, Haiku 4.5 și Fable 5.1 sunt modelele raportate de sesiunea Desktop curentă, nu de CLI-ul local 2.1.175, pe care aliasurile rezolvă la versiuni mai vechi; modelul efectiv se confirmă din system/init la primul turn aprobat.
- **Autentificare:** claude.ai.
- **Allowance:** Modelele mai mari și efortul ridicat epuizează cota mai repede.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Sonnet 4.6[1m] cere usage credits pe Max, iar pe 2.1.175 aliasul sonnet = Sonnet 4.6, deci `sonnet[1m]` ar factura credite; Sonnet 5+ și Fable au 1M nativ fără credite; Fable poate factura pe credite și, în -p, fără prompt de consimțământ; aliasul `best` poate selecta Fable.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: `--model opus\|sonnet\|haiku\|fable\|best\|opusplan\|<id>`; aliasurile rezolvă la versiunea încorporată în build-ul CLI: pe 2.1.175, după CHANGELOG, opus → Opus 4.8, sonnet → Sonnet 4.6, fable → Fable 5 (help-ul local dă exemplul claude-fable-5); Opus 5.5 cere v2.1.280+, Sonnet 5.5 v2.1.284+, Fable 5.1 v2.1.257+; `best` rezolvă la Fable unde e disponibil. `--effort low\|medium\|high\|xhigh\|max` (ultracode din v2.1.203); Opus 5.5/Sonnet 5.5 au efort implicit medium, Opus 4.8 high. `--fallback-model` funcționează doar cu --print pe 2.1.175 (interzis în V2); setarea fallbackModel din proiect ([opus, haiku]) rămâne activă; fallback automat la semnalări de siguranță (switchModelsOnFlag); availableModels și deniedModels (v2.1.283+) în managed; SDK setModel/supportedModels. \| Disponibil pe plan: da. \| Controlabil programatic: da. \| Reutilizabil din Hub: da. \| Interacțiune: nu. \| Securitate: aliasurile se mută odată cu versiunea CLI — Hub înregistrează ID-ul efectiv și respinge `fable`, `best`, `claude-fable-*` și sufixul [1m] pe modele 4.6.
- **Suprafață nativă:** /model, /effort.
- **Cerințe locale:** Niciuna.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Rutare de model per task, cu înregistrarea modelului efectiv.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Codex model/list + turn/start (model, effort).
- **Ce face unic / mai bine:** opusplan, advisor, efort pe 5 niveluri.
- **Securitate:** Fallback-ul de proiect schimbă modelul fără ca Hub să ceară asta.
- **Cale de implementare:** WRAP existent; de adăugat: interzicerea aliasului fable și a sufixului [1m] pentru modele 4.6 până la verificare.
- **Test necesar:** Test simulat de validare a modelului cerut; live: comparație model cerut vs. system/init.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Proprietarul decide dacă păstrează fallbackModel în .claude/settings.json al proiectului.
- **Surse citite:** https://code.claude.com/docs/en/model-config · https://code.claude.com/docs/en/cli-reference · local: claude --help (--model, --effort, --fallback-model) · local: sources-anthropic-local.md (fallbackModel în .claude/settings.json)
- **Verificare adversarială:** CORRECTED (corectat: accountEligibility (https://code.claude.com/docs/en/advisor ; CHANGELOG 2.1.257, 2.1.280, 2.1.284), programmaticDetail (https://code.claude.com/docs/en/model-config ; https://code.claude.com/docs/en/cli-reference ; CHANGELOG 2.1.154, 2.1.197, 2.1.257, 2.1.280, 2.1.284), extraBillingRisk (https://code.claude.com/docs/en/model-config)) — model-config și advisor: aliasurile rezolvă la versiunea implicită încorporată în build și avansează cu fiecare release. CHANGELOG: Opus 4.8 în v2.1.154, Sonnet 5 în v2.1.197, Fable 5.1 în v2.1.257, Opus 5.5 în v2.1.280, Sonnet 5.5 în v2.1.284. Help-ul local 2.1.175 marchează --fallback-model ca doar --print.

### Modele Fable (Fable 5.1) în Claude Code (`an-cc-fable-access`)

- **Sursă oficială:** https://code.claude.com/docs/en/model-config
- **Documentație tehnică:** https://code.claude.com/docs/en/advisor
- **Ce face:** Cel mai capabil model pentru sarcini lungi; nu este implicit pe niciun plan și se alege explicit.
- **Plan necesar:** Acces Fable; pe unele planuri și niveluri de loc se facturează pe usage credits cu consimțământ unic.
- **Platformă:** Toate.
- **Rollout:** GA pentru conturile cu acces
- **Eligibilitate cont:** Necunoscut pentru acest cont Max.
- **Autentificare:** claude.ai.
- **Allowance:** Necunoscut: fie limitele planului, fie usage credits.
- **Utilizare partajată:** Posibil.
- **Inclus în abonament?:** unknown
- **Risc de facturare suplimentară (credite/extra usage):** În -p și Agent SDK, o cerere Fable care s-ar factura pe usage credits se facturează fără prompt; interactiv, după un consimțământ unic promptul nu mai apare.
- **Risc de facturare API:** unknown
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: `--model fable` / `/model fable` (sau aliasul `best`, care rezolvă la Fable unde e disponibil); în sesiunile interactive apare un prompt de consimțământ înainte ca o cerere Fable să fie facturată pe usage credits, dar în -p și prin Agent SDK nu există prompt: cererea este facturată fără întrebare; în sesiuni de fundal/Remote Control promptul expiră după dialogExpiry și turn-ul se încheie; Fable 5.1 cere v2.1.257+ (pe 2.1.175 aliasul fable = Fable 5); advisor Fable se aplică doar după consimțământ. \| Disponibil pe plan: neverificat (planul și nivelul locului decid între limitele planului și credite). \| Controlabil programatic: da. \| Reutilizabil din Hub: nu până la confirmarea încadrării în Max. \| Interacțiune: consimțământ doar interactiv. \| Securitate: risc de facturare silențioasă în -p.
- **Suprafață nativă:** /model.
- **Cerințe locale:** Niciuna.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Blocat în run-urile Hub până la verificare.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** GPT-6 Astra în Codex (nivel premium).
- **Ce face unic / mai bine:** Capacitate maximă pentru investigații lungi.
- **Securitate:** Facturare pe credite.
- **Cale de implementare:** REJECT temporar: Hub respinge `fable`, `best`, `claude-fable-*` și un advisorModel Fable, pasează mereu `--model` explicit, setează CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1 și oprește run-ul dacă system/init raportează un model Fable; opțional availableModels/deniedModels în managed settings.
- **Test necesar:** Verificare manuală de către proprietar în claude.ai/settings/usage și la /model fable (fără a continua).
- **Status:** ELIGIBILITY_UNKNOWN
- **Decizie Hub:** REJECT
- **Încredere:** medium
- **Note:** Politica de model a proiectului menționează fable pentru investigații grele; aceasta trebuie aliniată cu BillingPolicy.
- **Surse citite:** https://code.claude.com/docs/en/model-config · https://code.claude.com/docs/en/advisor · local: claude --help (alias fable)
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://code.claude.com/docs/en/model-config), extraBillingRisk (https://code.claude.com/docs/en/model-config), implementationPath (https://code.claude.com/docs/en/model-config ; https://code.claude.com/docs/en/advisor)) — model-config (Work with Fable; Fable and usage credits) confirmă facturarea fără consimțământ în -p/SDK și rezolvarea aliasului best la Fable. Încadrarea pe Max rămâne neverificată: CHANGELOG v2.1.251 menționează o alocare Fable pe Max, fără detalii publice.

### Fast mode (/fast) (`an-cc-fast-mode`)

- **Sursă oficială:** https://code.claude.com/docs/en/fast-mode
- **Documentație tehnică:** https://code.claude.com/docs/en/fast-mode
- **Ce face:** Configurație Opus de până la 2,5x mai rapidă la preț per token mai mare (Opus 5.5: 8/40 USD per MTok).
- **Plan necesar:** Pe abonamente doar prin usage credits; nu intră în limitele planului.
- **Platformă:** API Anthropic și abonamente; nu Bedrock/Vertex/Foundry.
- **Rollout:** Research preview
- **Eligibilitate cont:** Max eligibil doar cu usage credits activate.
- **Autentificare:** claude.ai.
- **Allowance:** Nu consumă din limitele planului; consumă direct usage credits.
- **Utilizare partajată:** Nu.
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Usage credits la fiecare cerere, inclusiv cost unic la activarea în mijlocul conversației.
- **Risc de facturare API:** high
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: `/fast`, setarea fastMode: true; în -p doar dacă --settings conține fastMode; dezactivare CLAUDE_CODE_DISABLE_FAST_MODE=1 sau fastMode: false în managed. \| Disponibil pe plan: doar cu usage credits. \| Controlabil programatic: da. \| Reutilizabil din Hub: nu. \| Interacțiune: nu. \| Securitate: încalcă INCLUDED_SUBSCRIPTION_ONLY.
- **Suprafață nativă:** /fast.
- **Cerințe locale:** Nu se aplică.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Interzis.
- **Suprafață de execuție:** anthropic.claude_code_interactive
- **Echivalent la celălalt ecosistem:** Codex fast_mode / Ultrafast (Pro 500 USD).
- **Ce face unic / mai bine:** Latență mică.
- **Securitate:** Facturare suplimentară.
- **Cale de implementare:** REJECT: env CLAUDE_CODE_DISABLE_FAST_MODE=1 în buildChildEnv și fastMode false în --settings.
- **Test necesar:** Test simulat al env-ului.
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Dacă proprietarul a activat fastMode în setările user, sesiunile interactive ar folosi credite.
- **Surse citite:** https://code.claude.com/docs/en/fast-mode · https://code.claude.com/docs/en/feature-availability
- **Verificare adversarială:** CONFIRMED — fast-mode: research preview, până la 2,5x, Opus 5.5 la 8/40 USD per MTok, pe abonamente doar prin usage credits chiar dacă planul mai are cotă, /fast în -p doar cu fastMode în --settings (v2.1.205+), CLAUDE_CODE_DISABLE_FAST_MODE sau fastMode false în managed. Pe 2.1.175 fast mode ar viza Opus 4.8 (10/50 USD).

### Advisor tool (`--advisor`, /advisor) (`an-cc-advisor`)

- **Sursă oficială:** https://code.claude.com/docs/en/advisor
- **Documentație tehnică:** https://code.claude.com/docs/en/advisor
- **Ce face:** Modelul principal consultă un model mai puternic (unealtă server-side) la puncte de decizie; consilierul primește toată conversația.
- **Plan necesar:** Abonament sau API Anthropic; nu Bedrock/Vertex/Foundry.
- **Platformă:** Toate suprafețele cu API Anthropic.
- **Rollout:** Experimental
- **Eligibilitate cont:** Max eligibil; necesită feature-flag fetching.
- **Autentificare:** claude.ai.
- **Allowance:** Consumul advisor intră în limitele planului; excepție: advisor Fable pe credite unde Fable se facturează așa.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** Advisor Fable pe usage credits.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: `--advisor opus\|sonnet\|fable` (nelistat în help), setarea advisorModel, `/advisor` în -p din v2.1.260; dezactivare CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1. \| Disponibil pe plan: da. \| Controlabil programatic: da. \| Reutilizabil din Hub: posibil ulterior. \| Interacțiune: nu. \| Securitate: un advisorModel setat de utilizator se aplică și run-urilor Hub.
- **Suprafață nativă:** /advisor.
- **Cerințe locale:** Niciuna.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință; dezactivat în run-urile Hub până la decizie.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Nu există echivalent direct documentat aici.
- **Ce face unic / mai bine:** Calitate de plan mai bună la cost moderat.
- **Securitate:** Cost suplimentar ascuns.
- **Cale de implementare:** REFERENCE: env CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1 în run-urile Hub.
- **Test necesar:** Test simulat al env-ului.
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Versiunea locală conține stringul, dar comportamentul pe 2.1.175 nu este confirmat.
- **Surse citite:** https://code.claude.com/docs/en/advisor · https://code.claude.com/docs/en/feature-availability · local: scanare stringuri claude.exe (--advisor prezent)
- **Verificare adversarială:** CONFIRMED — advisor: experimental, doar API Anthropic, --advisor nelistat în help, /advisor în -p din v2.1.260, pe abonament consumul se numără în limitele planului cu excepția advisor-ului Fable (credite), necesită feature-flag fetching, subagenții moștenesc advisor-ul, CLAUDE_CODE_DISABLE_ADVISOR_TOOL îl dezactivează.

### Retragerea modelelor Anthropic și semnalele din Claude Code (pagina model-deprecations, avertisment de retragere, claude_code_version_too_old) (`an-gap-model-retirement-signals`)

- **Sursă oficială:** https://platform.claude.com/docs/en/about-claude/model-deprecations
- **Documentație tehnică:** https://code.claude.com/docs/en/model-config
- **Ce face:** Pagina oficială listează starea fiecărui model (Active, Legacy, Deprecated, Retired) și data tentativă de retragere; Anthropic promite cel puțin 60 de zile de preaviz. La 30.09.2026: Haiku 4.5 activ, retragere nu mai devreme de 15.10.2026; Sonnet 4.5 activ cu data „nu mai devreme de 29.09.2026” deja depășită; Opus 4.5 nu mai devreme de 24.11.2026; Mythos Preview deprecated; Opus 4.1, Opus 4 și Sonnet 4 retrase; Opus 5.5 și Sonnet 5.5 până în septembrie 2027. Claude Code afișează un avertisment pentru modele cu dată de retragere sau remapate (notificare la pornire în interactiv; pe stderr în -p cu output text de la 2.1.182; suprimat în json/stream-json, unde modelul real se citește din modelUsage). Un CLI prea vechi pentru un model primește 400 claude_code_version_too_old. O sesiune reluată pe un model retras cade pe precedența normală.
- **Plan necesar:** Oricare
- **Platformă:** Claude API, Claude Code, aplicațiile Claude
- **Rollout:** GA
- **Eligibilitate cont:** Aplicabil
- **Autentificare:** N/A (informație publică; semnalele CLI apar și cu OAuth)
- **Allowance:** N/A
- **Utilizare partajată:** N/A
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Nu
- **Risc de facturare API:** none
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Nu există API de deprecations pentru abonament. Hub: citește modelul din system/init și modelUsage (stream-json), mapează ID-ul la un tabel de retrageri actualizat din pagina publică (disponibilă ca .md), tratează 400 claude_code_version_too_old ca „necesită upgrade”, nu ca eșec de model, și semnalează din timp modelele cu dată apropiată.
- **Suprafață nativă:** Pagina de documentație; notificarea de pornire din Claude Code; e-mail către clienții API
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Registru de ciclu de viață al modelelor în router, echivalent cu oa-model-retirements.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** oa-model-retirements (retragerea GPT-5.5 la 14.10.2026).
- **Ce face unic / mai bine:** Tabel oficial cu date și înlocuitori recomandați; semnal CLI explicit pentru versiune prea veche.
- **Securitate:** Niciuna directă.
- **Cale de implementare:** Tabel de retrageri în Hub, actualizat manual cu sursa și data citirii; alertă în UI pentru modelele cu retragere sub 30 de zile; parsarea erorii claude_code_version_too_old.
- **Test necesar:** Test unitar de parsare a evenimentelor init/result și a erorii 400; fără model.
- **Status:** DOCUMENTED
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** high
- **Note:** .claude/settings.json al proiectului are fallbackModel ["opus","haiku"]: Haiku 4.5 poate fi retras după 15.10.2026. Hub-ul exclude setările de proiect și interzice --fallback-model, dar sesiunile interactive ale proprietarului în acest proiect folosesc lanțul. Pe CLI 2.1.175 avertismentul pe stderr nu există (introdus în 2.1.182).
- **Surse citite:** https://platform.claude.com/docs/en/about-claude/model-deprecations.md · https://code.claude.com/docs/en/model-config.md · https://code.claude.com/docs/en/errors.md
- **Verificare adversarială:** CONFIRMED — Pagina model-deprecations confirmă stările și datele: Haiku 4.5 nu mai devreme de 15.10.2026, Sonnet 4.5 nu mai devreme de 29.09.2026, Opus 4.5 24.11.2026, Mythos Preview deprecated, Opus 4.1/Opus 4/Sonnet 4 retrase, Opus 5.5 nu mai devreme de 22.09.2027, Sonnet 5.5 28.09.2027, preaviz de minimum 60 de zile. Datele se aplică platformelor operate de Anthropic (API); aplicabilitatea directă la abonament nu este declarată. model-config confirmă avertismentul pe stderr de la 2.1.182 doar în output text și citirea modelului din modelUsage în json/stream-json. Relevant pentru 2.1.175: Opus 4.6 și Sonnet 4.6 sunt active până cel puțin în februarie 2027.

### Risc de disponibilitate: suspendarea Fable 5 și Mythos 5 prin directivă de export (12.06.2026) și redeploy-ul din 30.06/01.07.2026 (`an-gap-model-availability-regulatory-risk`)

- **Sursă oficială:** https://www.anthropic.com/news/fable-mythos-access
- **Documentație tehnică:** https://www.anthropic.com/news/redeploying-fable-5
- **Ce face:** Pe 12.06.2026 guvernul SUA a emis o directivă de control al exporturilor care cerea blocarea accesului cetățenilor străini la Fable 5 și Mythos 5; fără verificare a cetățeniei în timp real, Anthropic a suspendat ambele modele pentru toți utilizatorii, fără impact asupra altor modele. Controalele au fost ridicate pe 30.06; Fable 5 a revenit global pe 01.07, inclus pe Pro/Max/Team până la 50% din limita săptămânală până pe 07.07, apoi disponibil prin usage credits. Pentru modelele Mythos-class, traficul clienților business are retenție obligatorie de 30 de zile.
- **Plan necesar:** N/A
- **Platformă:** Claude Platform, claude.ai, Claude Code, Cowork; cloud-urile partenere au revenit ulterior
- **Rollout:** Eveniment încheiat; risc recurent
- **Eligibilitate cont:** Afectează orice cont care folosește modele Mythos-class
- **Autentificare:** N/A
- **Allowance:** După 07.07.2026, Fable 5 pe Max trece pe usage credits
- **Utilizare partajată:** N/A
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Fable pe abonament poate trece pe usage credits; în -p se facturează fără consimțământ dacă usage credits sunt active.
- **Risc de facturare API:** none
- **Integrare programatică:** NONE
- **Detaliu integrare:** Nu există semnal programatic dedicat; indisponibilitatea apare ca eroare de model. Hub: tratarea modelului ca indisponibil, fără fallback plătit.
- **Suprafață nativă:** Anunțuri anthropic.com/news, release notes
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Risc consemnat în router: modelele de vârf pot dispărea brusc din motive de reglementare.
- **Suprafață de execuție:** none
- **Echivalent la celălalt ecosistem:** oa-model-daybreak-cyber (rerutare cyber la OpenAI).
- **Ce face unic / mai bine:** Transparență publică asupra motivului și a cronologiei.
- **Securitate:** Retenția de 30 de zile pentru traficul business pe modele Mythos-class.
- **Cale de implementare:** Starea de disponibilitate per model în router, cu marcaj manual „suspendat” și rutare către modele incluse în plan.
- **Test necesar:** Test unitar al routerului pentru un model marcat indisponibil.
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Hub-ul refuză deja modelele fable/best, deci impactul direct este redus.
- **Surse citite:** https://www.anthropic.com/news/fable-mythos-access · https://www.anthropic.com/news/redeploying-fable-5 · https://www.anthropic.com/news/claude-fable-5-mythos-5 · https://support.claude.com/en/articles/12138966-release-notes
- **Verificare adversarială:** CONFIRMED — Anunțurile confirmă: directiva de export din 12.06.2026 (17:21 ET) privind accesul cetățenilor străini; fără verificare a naționalității în timp real, Anthropic a suspendat ambele modele pentru toți utilizatorii, fără impact asupra celorlalte modele; controalele au fost ridicate pe 30.06; Fable 5 inclus până la 50% din limita săptămânală până pe 07.07, apoi prin usage credits; Mythos 5 redat unui set de organizații din SUA. Retenția obligatorie de 30 de zile pentru tot traficul clienților business pe modele Mythos-class apare în anunțul Fable 5/Mythos 5 și în anunțul EFS.

### Acces restricționat la modelele Mythos-class: Mythos 5, Project Glasswing, Life Sciences Verification Program și programele de trusted access (`an-gap-mythos-trusted-access-programs`)

- **Sursă oficială:** https://www.anthropic.com/news/claude-fable-5-mythos-5
- **Documentație tehnică:** https://www.anthropic.com/news/life-sciences-verification-program
- **Ce face:** Mythos 5 este același model ca Fable 5, cu anumite safeguards ridicate; a fost livrat inițial partenerilor Project Glasswing (securitate cibernetică), ca upgrade al Mythos Preview. Glasswing s-a extins pe 02.06.2026 la aproximativ 150 de organizații noi din peste 15 țări. Life Sciences Verification Program (17.09.2026, beta) dă profesioniștilor verificați acces la modele Mythos, Opus și Sonnet cu safeguards de biologie mai permisive, inițial pentru echipe și instituții, cu extindere planificată la Pro/Max. Mythos 5.1 este disponibil doar prin programele de trusted access. Pe API, Mythos 5 este activ până cel puțin la 09.06.2027.
- **Plan necesar:** Program de acces verificat (nu un plan de abonament)
- **Platformă:** Claude Platform, Claude.ai, Claude Code și Claude Science (pentru granturile LSVP); Mythos 5.1 doar prin programele de trusted access
- **Rollout:** Acces limitat, extindere graduală
- **Eligibilitate cont:** Nu este disponibil contului Max.
- **Autentificare:** N/A
- **Allowance:** N/A
- **Utilizare partajată:** N/A
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Neclar: granturile LSVP pot fi folosite pe toate suprafețele (Claude Science, Claude.ai, Claude Code și API), deci accesul nu este limitat la facturare API; modul de facturare pe abonament nu este documentat. Irelevant azi, pentru că proprietarul nu este eligibil.
- **Risc de facturare API:** unknown
- **Integrare programatică:** NONE
- **Detaliu integrare:** Indisponibil pentru abonamentul proprietarului.
- **Suprafață nativă:** Aplicații la programe pe anthropic.com
- **Cerințe locale:** N/A
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință; nu se rutează nimic către Mythos.
- **Suprafață de execuție:** none
- **Echivalent la celălalt ecosistem:** oa-model-daybreak-cyber (modele cyber cu acces controlat la OpenAI).
- **Ce face unic / mai bine:** Capabilități maxime de securitate cibernetică și științe ale vieții, cu verificare.
- **Securitate:** Modele cu safeguards reduse; incidentele raportate pe 30.07 și 31.08.2026 au implicat modele rulate fără safeguards cyber în evaluări.
- **Cale de implementare:** Niciuna; routerul Hub refuză ID-urile Mythos.
- **Test necesar:** Test unitar: routerul refuză claude-mythos-*.
- **Status:** PLAN_RESTRICTED
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** high
- **Note:** Se suprapune parțial cu an-model-mythos-5-1; Mythos 5 lipsea din an-models-legacy.
- **Surse citite:** https://www.anthropic.com/news/claude-fable-5-mythos-5 · https://www.anthropic.com/news/expanding-project-glasswing · https://www.anthropic.com/news/glasswing-initial-update · https://www.anthropic.com/news/life-sciences-verification-program · https://www.anthropic.com/claude-fable-and-mythos-5-1 · https://platform.claude.com/docs/en/about-claude/model-deprecations.md
- **Verificare adversarială:** CORRECTED (corectat: apiBillingRisk (https://www.anthropic.com/news/life-sciences-verification-program), extraBillingRisk (https://www.anthropic.com/news/life-sciences-verification-program), platform (https://www.anthropic.com/news/life-sciences-verification-program ; https://www.anthropic.com/claude-fable-and-mythos-5-1)) — Confirmat: Mythos 5 = același model ca Fable 5 cu safeguards ridicate, livrat inițial partenerilor Glasswing ca upgrade al Mythos Preview; Glasswing extins pe 02.06.2026 la aproximativ 150 de organizații din peste 15 țări; LSVP (17.09.2026, beta, inițial pentru echipe și instituții, extindere planificată la Pro/Max); Mythos 5.1 doar prin trusted access; claude-mythos-5 activ pe API cel puțin până la 09.06.2027. Corectat: afirmația că accesul este în principal pe Claude Platform (facturare API).

## coding

### Versiunea Claude Code CLI folosită de adaptorul Hub (`an-claude-code-cli-version`)

- **Sursă oficială:** https://code.claude.com/docs/en/changelog
- **Documentație tehnică:** https://code.claude.com/docs/en/model-config
- **Ce face:** Capabilitățile de model și de raportare a utilizării depind de versiune: Opus 5.5 din 2.1.280, Sonnet 5.5 din 2.1.284, Fable 5.1 din 2.1.257, continuarea automată din 2.1.234, câmpurile credits_required din rate_limit_event din 2.1.181, ultracode din 2.1.203.
- **Plan necesar:** n/a
- **Platformă:** Windows, instalare npm globală
- **Rollout:** Ultima versiune npm: 2.1.285 (29.09.2026); locală: 2.1.175 (publicată 12.06.2026)
- **Eligibilitate cont:** Verificat: claude --version → 2.1.175.
- **Autentificare:** OAuth claude.ai
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Actualizarea nu costă și nu schimbă planul.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** claude update sau instalarea unei versiuni fixate prin npm; ambele sunt instalări de pachete și cer aprobarea proprietarului.
- **Suprafață nativă:** Terminal
- **Cerințe locale:** Node și npm; drept de scriere în profilul utilizatorului
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Precondiție pentru modelele 5.5 și Fable 5.1 în Hub.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Codex CLI 0.158.0-alpha.2.1 livrat cu Codex desktop
- **Ce face unic / mai bine:** n/a
- **Securitate:** Actualizarea schimbă comportamentul implicit (model implicit, rezolvarea aliasurilor, effort implicit); versiunea trebuie fixată și testată.
- **Cale de implementare:** Aprobare explicită → instalarea unei versiuni fixate (canalul stable are acum 2.1.280, latest 2.1.285) → blocarea actualizărilor automate în mediul Hub (DISABLE_AUTOUPDATER=1 sau DISABLE_UPDATES; opțional autoUpdatesChannel stable și minimumVersion) → npm run test:v2 → verificări fără inferență (--version, auth status) → un turn live aprobat.
- **Test necesar:** Suita V2 fără modele după actualizare; handshake stream-json.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Claude Desktop folosește propria versiune de Claude Code (sesiunea curentă rulează Opus 5.5), independent de CLI-ul npm.
- **Surse citite:** https://code.claude.com/docs/en/changelog · https://registry.npmjs.org/@anthropic-ai/claude-code · https://code.claude.com/docs/en/model-config · https://code.claude.com/docs/en/agent-sdk/typescript · local: claude --version → 2.1.175 (30.09.2026)
- **Verificare adversarială:** CORRECTED (corectat: implementationPath (https://registry.npmjs.org/@anthropic-ai/claude-code; https://code.claude.com/docs/en/env-vars; https://code.claude.com/docs/en/settings-reference)) — Versiunile sunt confirmate în changelog și pe npm: Opus 5.5 în 2.1.280 (22.09), Sonnet 5.5 în 2.1.284 (28.09), Fable 5.1 în 2.1.257 (01.09), auto-continue în 2.1.234, câmpurile credits_required în 2.1.181, ultracode în 2.1.203. npm: latest 2.1.285 (29.09.2026), dist-tag stable 2.1.280. Local: claude --version → 2.1.175 (publicat 12.06.2026). Fără blocarea actualizărilor automate, versiunea fixată poate deriva.

### Claude Code CLI interactiv (terminal/TUI) (`an-cc-cli-interactive`)

- **Sursă oficială:** https://code.claude.com/docs/en/cli-reference
- **Documentație tehnică:** https://code.claude.com/docs/en/cli-reference
- **Ce face:** Sesiune agentică în terminal care citește și editează cod, rulează comenzi, folosește comenzi slash, skills, subagenți, MCP, hooks și checkpoint-uri, cu moduri de permisiune comutabile (Shift+Tab).
- **Plan necesar:** Pro, Max, Team, Enterprise (claude.ai) sau Console (API); contul proprietarului este Max.
- **Platformă:** Windows 11 nativ (claude.exe 2.1.175 din pachetul npm), macOS, Linux, WSL.
- **Rollout:** GA
- **Eligibilitate cont:** Verificat local: authMethod claude.ai, apiProvider firstParty, subscriptionType max.
- **Autentificare:** OAuth claude.ai prin /login; fără ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN sau apiKeyHelper în mediu/setări.
- **Allowance:** Limitele planului Max (5x sau 20x față de Pro; nivelul exact neverificat), cu fereastră de 5 ore și fereastră săptămânală.
- **Utilizare partajată:** Da: aceeași cotă cu Claude app, Desktop, IDE, sesiuni cloud și routines.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Usage credits (claude.ai Settings > Usage) permit continuarea peste limită la tarif API dacă proprietarul le-a activat; fast mode, Fable (pe unele planuri) și ultrareview facturează pe credite; un ANTHROPIC_API_KEY aprobat interactiv mută sesiunea pe facturare API.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Mecanism: `claude` sau `claude "prompt"` pornește TUI-ul; pornire cu prompt pre-completat și prin deep link claude-cli://open. \| Disponibil pe plan: da (Max). \| Controlabil programatic: nu direct; controlul programatic se face prin -p/stream-json sau Remote Control. \| Reutilizabil din Hub: Hub poate lansa sesiunea (deep link) și o poate observa prin `claude agents --json`; nu conduce TUI-ul. \| Interacțiune utilizator: da, proprietarul scrie și aprobă. \| Constrângeri de securitate: dialog de workspace trust la primul rulaj; modul de start implicit este Manual pe 2.1.175, dar pe planurile Pro/Max/Team modul auto devine modul de start implicit încă din v2.1.228 (macOS/Linux/WSL) și v2.1.233 (Windows nativ) în sesiunile care preiau feature flags; v2.1.283 îl extinde la toate planurile și furnizorii; `--permission-mode` sau `permissions.defaultMode` din ~/.claude/settings.json îl suprascriu (valoarea auto din .claude/settings.json de proiect este ignorată); rulează cu privilegiile utilizatorului.
- **Suprafață nativă:** Terminal (Windows Terminal/PowerShell) sau terminalul integrat al IDE.
- **Cerințe locale:** claude.exe real din %APPDATA%/npm/node_modules/@anthropic-ai/claude-code/bin; acces HTTPS la api.anthropic.com; Git Bash opțional.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Suprafață operator pentru lucru asistat: Hub pregătește contextul și promptul, proprietarul execută, Hub înregistrează rezultatul.
- **Suprafață de execuție:** anthropic.claude_code_interactive
- **Echivalent la celălalt ecosistem:** Codex CLI interactiv (`codex`, TUI redesenat anunțat la DevDay).
- **Ce face unic / mai bine:** Checkpoint-uri /rewind, subagenți cu fork, hooks deterministe, skills/plugins, agent view, Remote Control.
- **Securitate:** Modurile permisive (bypass, auto) execută fără confirmare; orice update la ≥2.1.233 pe Windows face ca sesiunile interactive ale contului Max să pornească implicit în auto (nu abia din 2.1.283); înainte de update trebuie fixat `permissions.defaultMode` în ~/.claude/settings.json sau `disableAutoMode` în managed settings.
- **Cale de implementare:** ASSISTED: Hub generează deep link cu cwd și prompt; leagă sesiunea de task prin sessionId din `claude agents --json`; transcriptul se reia doar cu acordul proprietarului.
- **Test necesar:** Test manual: deep link deschide sesiunea în proiectul corect, iar promptul nu se trimite fără Enter.
- **Status:** AVAILABLE
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** CLI local 2.1.175 este mult în urma documentației (CHANGELOG la 2.1.285); multe opțiuni documentate cer v2.1.200+; `claude update` necesită aprobarea proprietarului.
- **Surse citite:** https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/authentication · https://code.claude.com/docs/en/feature-availability · https://code.claude.com/docs/en/permission-modes · local: claude --version / --help (2.1.175) · local: sources-anthropic-local.md (claude auth status)
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://code.claude.com/docs/en/permission-modes), securityConcerns (https://code.claude.com/docs/en/permission-modes)) — Verificat în permission-modes: pragul v2.1.283 extinde auto la toate planurile, dar pentru Pro/Max/Team auto este deja modul de start implicit din v2.1.228/v2.1.233 (Windows nativ) în sesiunile cu feature flags; pe 2.1.175 implicitul este Manual. Planurile, autentificarea, deep link-ul, usage credits și aprobarea ANTHROPIC_API_KEY sunt confirmate în authentication, cli-reference, deep-links și costs.

### Claude Code headless `claude -p` (Agent SDK prin CLI) (`an-cc-headless-print`)

- **Sursă oficială:** https://code.claude.com/docs/en/headless
- **Documentație tehnică:** https://code.claude.com/docs/en/cli-reference
- **Ce face:** Rulează bucla agentică neinteractiv cu ieșire text, json sau stream-json, prompt pe stdin, reluare de sesiune, restricții de unelte și moduri de permisiune; ieșire cu cod 0/non-zero.
- **Plan necesar:** Orice cont Claude Code; pe abonament folosește OAuth claude.ai.
- **Platformă:** Windows 11, CLI 2.1.175.
- **Rollout:** GA
- **Eligibilitate cont:** Max verificat; -p folosește abonamentul doar dacă nu există o sursă cu rang superior: variabile de furnizor cloud (CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY), ANTHROPIC_AUTH_TOKEN, ANTHROPIC_API_KEY, apiKeyHelper (inclusiv din settings-urile proiectului), CLAUDE_CODE_OAUTH_TOKEN, profil Anthropic numit, variabile de federație sau un profil activ oidc_federation, ori o sesiune Claude apps gateway.
- **Autentificare:** OAuth claude.ai; în -p un ANTHROPIC_API_KEY prezent este folosit întotdeauna, fără întrebare.
- **Allowance:** Cota Max partajată (5 ore + săptămânal).
- **Utilizare partajată:** Da, cu toate suprafețele Claude.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN, apiKeyHelper sau blocul `env` din settings (inclusiv din .claude/settings.json al proiectului, folosit în -p fără workspace trust) mută facturarea pe API; în -p și prin Agent SDK o cerere Fable care s-ar factura pe usage credits este facturată fără prompt de consimțământ (inclusiv prin aliasul `best` sau printr-un `model` setat în user settings); usage credits dacă sunt activate; `--betas` vizează doar utilizatorii cu API key, iar `--max-budget-usd` este doar un plafon de cost estimat client-side (print mode).
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: `claude -p --output-format stream-json --verbose --include-partial-messages --permission-mode dontAsk\|acceptEdits --tools <listă> --strict-mcp-config --mcp-config <obiect mcpServers gol> --session-id <uuid> \| --resume <id> [--model] [--effort]`, prompt pe stdin (max 10 MB). Evenimente: system/init (model, tools, mcp_servers, plugins, capabilities din v2.1.205), stream_event, assistant/user cu parent_tool_use_id, system/api_retry (error: rate_limit, billing_error, authentication_failed...), system/permission_denied, result (session_id, usage, total_cost_usd ca estimare client, permission_denials, num_turns). SIGTERM → exit 143 cu turn neterminat. \| Disponibil pe plan: da. \| Controlabil programatic: complet. \| Reutilizabil din Hub: da, adaptorul V2 îl folosește. \| Interacțiune: nu; prompturile de permisiune fără gazdă sunt refuzate. \| Securitate: -p sare peste workspace trust și rulează hooks/MCP din proiect; setările invalide sunt ignorate silențios; binarul trebuie rulat nemodificat.
- **Suprafață nativă:** Niciuna (proces fără UI).
- **Cerințe locale:** Binar real (nu shim-ul npm), env controlat fără variabile ANTHROPIC_*, cwd verificat.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Ruta principală de execuție Claude în Hub, un turn per grant, cu audit al evenimentelor.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** `codex exec` și Codex app-server turn/start.
- **Ce face unic / mai bine:** Stream bogat (api_retry cu categorii, permission_denied, capabilities), --session-id preasignat, --json-schema, --include-hook-events.
- **Securitate:** Credențialele cu rang superior schimbă facturarea; în -p, într-un folder fără trust, se folosesc hooks din settings, blocul `env` și helperele (apiKeyHelper, awsAuthRefresh), hooks și allowed-tools din skills de proiect și serverele din .mcp.json (un `env` de proiect poate redirecționa ANTHROPIC_BASE_URL); pentru proiecte neverificate: `--setting-sources user` + `--strict-mcp-config`; background shells oprite la ~5 s după rezultat; subagenții/workflow-urile de fundal țin procesul deschis până la 10 minute de inactivitate; pe 2.1.175 `permission_denials` poate omite refuzurile Read/Edit/Write din reguli pe căi (remediat în v2.1.269).
- **Cale de implementare:** WRAP existent în v2/server/providers/claude.mjs; de adăugat după verificare pe 2.1.175: `--no-chrome`, env CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1, CLAUDE_CODE_DISABLE_CRON=1, CLAUDE_CODE_DISABLE_AUTO_MEMORY=1, CLAUDE_CODE_DISABLE_FAST_MODE=1, CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1.
- **Test necesar:** Un turn live read-only aprobat (LIVE_VALIDATION): init arată modelul, niciun api_retry billing, result fără is_error; apoi test de anulare.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** `--permission-prompts` (v2.1.259+) și `--restricted` (v2.1.248+) lipsesc în 2.1.175; inspectInstallation din V2 caută `--permission-prompts` în help și nu îl va găsi. Documentația anunță că --bare va deveni implicit pentru -p, ceea ce ar exclude abonamentul: de monitorizat la fiecare update. Politică: OAuth este destinat uzului obișnuit al Claude Code, iar limitele Pro/Max presupun uz individual obișnuit al Claude Code și al Agent SDK; utilizatorul final se poate autentifica cu propriul abonament în binarul nemodificat, deci ruta e permisă pentru uz personal, dar volumul automatizat trebuie ținut la acest nivel. Hub pasează mereu `--model` explicit și oprește run-ul dacă system/init raportează un model Fable.
- **Surse citite:** https://code.claude.com/docs/en/headless · https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/authentication · https://code.claude.com/docs/en/legal-and-compliance · https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan · local: claude --help (2.1.175) · local: v2/server/providers/claude.mjs
- **Verificare adversarială:** CORRECTED (corectat: accountEligibility (https://code.claude.com/docs/en/authentication), extraBillingRisk (https://code.claude.com/docs/en/model-config ; https://code.claude.com/docs/en/permissions ; https://code.claude.com/docs/en/cli-reference), securityConcerns (https://code.claude.com/docs/en/permissions ; https://code.claude.com/docs/en/headless ; CHANGELOG 2.1.269), notes (https://code.claude.com/docs/en/legal-and-compliance ; https://code.claude.com/docs/en/headless)) — Confirmat: --bare va deveni implicit pentru -p, stdin 10MB, SIGTERM → 143, fundal ~5 s / 10 min, capabilities din v2.1.205, categoriile api_retry, ANTHROPIC_API_KEY folosit mereu în -p. Corectat: Fable facturat fără consimțământ în -p, setările proiectului (env/apiKeyHelper) folosite fără trust, lista completă a credențialelor cu rang superior și nota de politică. Observație de platformă (inferență, nu din docs): pe Windows kill() din Node termină forțat procesul, deci semantica SIGTERM documentată nu e garantată.

### Intrare stream-json bidirecțională (`--input-format stream-json`, `--replay-user-messages`, protocol de control) (`an-cc-stream-json-input`)

- **Sursă oficială:** https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
- **Documentație tehnică:** https://code.claude.com/docs/en/cli-reference
- **Ce face:** Proces -p de lungă durată care primește mesaje utilizator JSONL pe stdin (inclusiv imagini), permite mesaje în coadă, întreruperi și cereri de control, iar cu --replay-user-messages re-emite mesajele cu UUID.
- **Plan necesar:** Toate planurile.
- **Platformă:** Windows 11, CLI 2.1.175.
- **Rollout:** GA (canalul folosit de Agent SDK)
- **Eligibilitate cont:** Max verificat.
- **Autentificare:** OAuth claude.ai (același proces ca -p).
- **Allowance:** Cota Max partajată.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** La fel ca -p.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: `claude -p --input-format stream-json --output-format stream-json --verbose [--replay-user-messages] [--include-partial-messages] [--prompt-suggestions]`; stdin: linii JSON de tip user cu message.role și message.content (+ parent_tool_use_id); SDK-ul folosește același canal pentru control_request/control_response (interrupt, set_permission_mode, set_model, aprobări canUseTool). Cu --max-turns, mesajele din coadă pornesc un turn nou. \| Disponibil pe plan: da. \| Controlabil programatic: da, prin stdio. \| Reutilizabil din Hub: da — sesiune persistentă pe mai multe turn-uri și anulare prin interrupt în loc de oprirea procesului. \| Interacțiune: nu. \| Securitate: formatul brut al control_request nu este documentat complet public (SDK-ul îl încapsulează); pe Windows lipsesc semnalele POSIX, deci SIGINT nu este o alternativă fiabilă.
- **Suprafață nativă:** Niciuna.
- **Cerințe locale:** Același binar; Hub trebuie să scrie JSONL pe stdin fără a închide stream-ul.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Transport pentru sesiuni Claude de lungă durată și anulare curată (HUB-018).
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Codex app-server JSON-RPC (turn/start, turn/interrupt) — protocol documentat.
- **Ce face unic / mai bine:** Mesaje în coadă în timpul unui turn; UUID-uri de mesaje pentru checkpoint; schimbare de mod/model la runtime.
- **Securitate:** Hub trebuie să marcheze originea mesajelor; un protocol nedocumentat poate varia între versiuni.
- **Cale de implementare:** WRAP în adaptorul Claude: mod opțional stream-json-input cu interrupt; până la documentare completă, feature-detect prin system/init.capabilities (disponibil din v2.1.205, nu pe 2.1.175).
- **Test necesar:** Test simulat al protocolului; apoi un test live aprobat de interrupt care confirmă turn încheiat și sesiune reluabilă.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** medium
- **Note:** Pe 2.1.175 interrupt() nu returnează confirmare (interrupt_receipt_v1 apare în v2.1.205). Relevant direct pentru eșecul anulării Claude din HUB-018.
- **Surse citite:** https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode · https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/headless · https://code.claude.com/docs/en/agent-sdk/typescript · local: claude --help (2.1.175) · local: scanare stringuri claude.exe (control_request, set_permission_mode prezente; interrupt_receipt_v1 absent)
- **Verificare adversarială:** CONFIRMED — Verificat: cli-reference (--input-format, --replay-user-messages, mesaje în coadă cu --max-turns), streaming-vs-single-mode (forma mesajelor user cu parent_tool_use_id), typescript (interrupt() întoarce SDKControlInterruptResponse doar pe CLI v2.1.205+). Protocolul control_request nu este documentat public. CHANGELOG: v2.1.208 remediază blocarea la un set_model cu payload ne-string, v2.1.257 creșterea nelimitată a memoriei la date non-JSONL pe stdin — pe 2.1.175 Hub trebuie să scrie strict JSONL valid.

### Ieșire structurată `--json-schema` (`an-cc-json-schema`)

- **Sursă oficială:** https://code.claude.com/docs/en/headless
- **Documentație tehnică:** https://code.claude.com/docs/en/agent-sdk/structured-outputs
- **Ce face:** După bucla agentică returnează JSON validat față de o schemă, în câmpul structured_output al mesajului result, cu reîncercări la nepotrivire.
- **Plan necesar:** Toate planurile.
- **Platformă:** Windows 11, CLI 2.1.175.
- **Rollout:** GA
- **Eligibilitate cont:** Max verificat.
- **Autentificare:** OAuth claude.ai.
- **Allowance:** Cota Max; reîncercările de validare consumă tokeni suplimentari.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar usage credits dacă sunt activate.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: `claude -p --output-format json\|stream-json --json-schema '<JSON Schema draft-07>'`; succes: result.subtype success + structured_output; eșec: error_max_structured_output_retries (MAX_STRUCTURED_OUTPUT_RETRIES). \| Disponibil pe plan: da. \| Controlabil programatic: da. \| Reutilizabil din Hub: da — verdicte tipizate, liste de fișiere, rapoarte de revizie. \| Interacțiune: nu. \| Securitate: pe 2.1.175 (înainte de v2.1.205) o schemă invalidă era ignorată silențios și orice schemă care conținea cuvântul cheie `format` era tratată ca invalidă (deci tot ignorată, cu ieșire nestructurată); abia din v2.1.205 `format` devine doar adnotare; înainte de v2.1.187 modelul putea reapela StructuredOutput la nesfârșit, iar turn-urile ulterioare nu returnau fiabil ieșire structurată. Hub evită `format`, își validează singur schema și rezultatul și tratează lipsa structured_output ca eșec.
- **Suprafață nativă:** Niciuna.
- **Cerințe locale:** Validator JSON Schema în Hub.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Contract de ieșire pentru task-uri Hub (review, clasificare, planuri).
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Ieșire structurată în Codex exec/app-server (de confirmat în slice-ul OpenAI).
- **Ce face unic / mai bine:** Validare după utilizarea uneltelor, nu doar pe un singur răspuns.
- **Securitate:** Rezultatul poate lipsi chiar cu subtype success; Hub trebuie să trateze acest caz ca eșec.
- **Cale de implementare:** WRAP: parametru opțional outputSchema în startTurn, validare Hub înainte de orice acțiune.
- **Test necesar:** Test simulat cu result conținând/lipsind structured_output; test live read-only aprobat.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Fișierele de schemă mari se pot pasa inline; atenție la escaparea pe Windows.
- **Surse citite:** https://code.claude.com/docs/en/headless · https://code.claude.com/docs/en/agent-sdk/structured-outputs · https://code.claude.com/docs/en/cli-reference · local: claude --help (2.1.175)
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://code.claude.com/docs/en/headless ; https://code.claude.com/docs/en/agent-sdk/structured-outputs ; CHANGELOG 2.1.187, 2.1.205)) — headless și structured-outputs confirmă draft-07, câmpul structured_output, error_max_structured_output_retries și cazul success fără structured_output. Corectat comportamentul versiunii locale 2.1.175.

### Checkpoint-uri și /rewind (interactiv) (`an-cc-checkpoint-rewind`)

- **Sursă oficială:** https://code.claude.com/docs/en/checkpointing
- **Documentație tehnică:** https://code.claude.com/docs/en/checkpointing
- **Ce face:** Înainte de fiecare prompt care pornește un turn salvează starea fișierelor editate cu uneltele de editare; /rewind (Esc Esc) restaurează cod, conversație sau ambele și poate rezuma de la un punct.
- **Plan necesar:** Toate planurile.
- **Platformă:** Local.
- **Rollout:** GA
- **Eligibilitate cont:** Max verificat.
- **Autentificare:** OAuth claude.ai.
- **Allowance:** Rezumarea consumă cotă; restaurarea nu.
- **Utilizare partajată:** Da (pentru rezumare).
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** none
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Mecanism: /rewind (sau Esc Esc) în TUI; păstrează snapshots pentru cele mai recente 100 de checkpoint-uri, șterse de retention sweep la ~30 de zile (cleanupPeriodDays). NU acoperă: comenzi Bash (rm, mv, cp), editările subagenților (excepție skill cu context: fork în prim-plan), modificări externe sau din alte sesiuni, mesaje venite în timpul unui turn. Link-uri: abia din v2.1.216 /rewind sare peste căile urmărite care sunt symlink/hardlink; pe 2.1.175 restaurarea putea scrie sau șterge prin link-uri, iar până la v2.1.260 putea raporta succes fără să restaureze nimic. \| Disponibil pe plan: da. \| Controlabil programatic: nu în TUI (pentru -p/SDK vezi an-cc-sdk-file-checkpointing). \| Reutilizabil din Hub: nu ca garanție de rollback. \| Interacțiune: da. \| Securitate: nu înlocuiește git sau backup-ul Hub.
- **Suprafață nativă:** Meniul /rewind.
- **Cerințe locale:** Niciuna.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Undo rapid al proprietarului în sesiuni asistate; backup-ul Hub rămâne sursa de adevăr.
- **Suprafață de execuție:** anthropic.claude_code_interactive
- **Echivalent la celălalt ecosistem:** Mecanisme de undo în Codex (neverificate în acest slice).
- **Ce face unic / mai bine:** Restaurare separată cod/conversație; rezumare țintită a contextului.
- **Securitate:** Iluzia de reversibilitate pentru efecte Bash sau externe.
- **Cale de implementare:** REUSE_NATIVE în sesiunile interactive; Hub păstrează gate-ul de backup înainte de orice execuție.
- **Test necesar:** Niciun test automat; verificare manuală opțională.
- **Status:** AVAILABLE
- **Decizie Hub:** REUSE_NATIVE
- **Încredere:** high
- **Note:** Explicație pentru utilizator: ce se poate și ce nu se poate anula.
- **Surse citite:** https://code.claude.com/docs/en/checkpointing · https://code.claude.com/docs/en/sub-agents · https://code.claude.com/docs/en/skills · local: director ~/.claude/file-history existent (doar listare)
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://code.claude.com/docs/en/checkpointing ; CHANGELOG 2.1.216, 2.1.260)) — checkpointing confirmă 100 de checkpoint-uri, ~30 de zile și excluderile (Bash, subagenți, modificări externe, mesaje mid-turn). Corectat comportamentul pe versiunea locală pentru link-uri și raportarea falsă de succes.

### File checkpointing în -p/SDK (`CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING`, `--rewind-files`) (`an-cc-sdk-file-checkpointing`)

- **Sursă oficială:** https://code.claude.com/docs/en/agent-sdk/file-checkpointing
- **Documentație tehnică:** https://code.claude.com/docs/en/agent-sdk/file-checkpointing
- **Ce face:** În sesiuni neinteractive face backup fișierelor înainte de Write/Edit/NotebookEdit; UUID-ul fiecărui mesaj user devine punct de restaurare; rewind-ul șterge fișierele create și restaurează pe cele modificate.
- **Plan necesar:** Toate planurile.
- **Platformă:** Local.
- **Rollout:** GA (flag nelistat în help)
- **Eligibilitate cont:** Max verificat.
- **Autentificare:** OAuth claude.ai.
- **Allowance:** Rewind-ul nu trimite prompt (fără consum).
- **Utilizare partajată:** Nu se aplică.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: env CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=true + `--input-format stream-json --output-format stream-json --replay-user-messages` pentru UUID-uri; restaurare: același env + `claude -p --resume <session> --rewind-files <uuid>` (tipărește confirmarea și iese fără prompt). SDK: enableFileCheckpointing + rewindFiles(). \| Disponibil pe plan: da. \| Controlabil programatic: da. \| Reutilizabil din Hub: ca strat suplimentar de undo pentru editările Claude. \| Interacțiune: nu. \| Securitate: nu acoperă Bash, subagenți, directoare sau fișiere de rețea; saltul peste symlink/hardlink apare din v2.1.216 — pe 2.1.175 rewind-ul putea scrie prin link-uri în afara proiectului.
- **Suprafață nativă:** Niciuna.
- **Cerințe locale:** Mod stream-json input; Hub stochează perechea sessionId/UUID.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Undo automat al editărilor unui run eșuat, după gate-ul de backup Hub.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Nu există echivalent documentat în slice-ul curent.
- **Ce face unic / mai bine:** Rewind fără inferență, per mesaj.
- **Securitate:** Pe 2.1.175 rewind-ul scrie și șterge prin symlink/hardlink la căile urmărite (saltul apare în v2.1.216) și poate raporta succes când lipsesc backup-urile (remediat în v2.1.260); nu e backup complet: fără Bash, subagenți, directoare sau fișiere de rețea.
- **Cale de implementare:** WRAP opțional după update-ul CLI (≥2.1.216) și test; până atunci doar REFERENCE practic.
- **Test necesar:** Test live aprobat pe un repo de probă fără symlink-uri: creare/modificare fișier, rewind, verificare diff.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** medium
- **Note:** Checkpoint-urile sunt legate de sesiunea care le-a creat.
- **Surse citite:** https://code.claude.com/docs/en/agent-sdk/file-checkpointing · https://code.claude.com/docs/en/checkpointing · local: scanare stringuri claude.exe (rewind-files și CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING prezente)
- **Verificare adversarială:** CORRECTED (corectat: securityConcerns (https://code.claude.com/docs/en/agent-sdk/file-checkpointing ; CHANGELOG 2.1.260)) — agent-sdk/file-checkpointing confirmă CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING, --rewind-files nelistat în help, UUID-urile prin replay-user-messages, ștergerea fișierelor create și limitările. hubDecision WRAP rămâne condiționat de update (≥2.1.260).

### Worktrees (`--worktree`/-w, EnterWorktree, isolation: worktree) (`an-cc-worktrees`)

- **Sursă oficială:** https://code.claude.com/docs/en/worktrees
- **Documentație tehnică:** https://code.claude.com/docs/en/worktrees
- **Ce face:** Izolează sesiuni și subagenți în git worktrees sub .claude/worktrees/<nume>, pe ramuri worktree-<nume>, cu verificări care blochează scrieri și git în checkout-ul principal.
- **Plan necesar:** Toate planurile.
- **Platformă:** Local; necesită git (sau hooks WorktreeCreate/WorktreeRemove).
- **Rollout:** GA
- **Eligibilitate cont:** Max verificat.
- **Autentificare:** Nu depinde.
- **Allowance:** Nu consumă în sine.
- **Utilizare partajată:** Nu se aplică.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: `claude -p -w <nume>` (în -p fără trust check și fără curățare; lock-ul rămâne), `--worktree '#123'` din PR; `--tmux` (nu pe Windows Terminal); `.worktreeinclude` copiază fișiere ignorate; worktree.baseRef fresh\|head; hooks WorktreeCreate/WorktreeRemove; curățare periodică după cleanupPeriodDays. \| Disponibil pe plan: da. \| Controlabil programatic: da. \| Reutilizabil din Hub: da, cu Hub proprietar al numelui și al curățării. \| Interacțiune: nu în -p. \| Securitate: .worktreeinclude poate copia .env și secrete; pe Windows, protecția la junction-uri la ștergere a apărut în v2.1.205 (versiunea locală e mai veche) — nicio ștergere de worktree fără aprobare.
- **Suprafață nativă:** Prompt de păstrare/ștergere la ieșire.
- **Cerințe locale:** Git; .claude/worktrees în .gitignore.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Izolarea run-urilor de scriere ale Hub-ului, cu ciclu de viață deținut de Hub.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Codex worktrees (activ local).
- **Ce face unic / mai bine:** Verificări de izolare pentru comenzi git redirecționate.
- **Securitate:** `.worktreeinclude` poate copia .env și secrete; pe 2.1.175 lipsesc remedieri ulterioare: înainte de v2.1.205 ștergerea pe Windows putea șterge fișiere din afara worktree-ului prin junction-uri/symlink-uri de director (fix parțial pentru worktree-urile de job în v2.1.147); înainte de v2.1.212 un symlink comis la .claude sau .claude/worktrees făcea crearea să scrie în afara repo-ului; înainte de v2.1.222 sesiunile izolate și subagenții lor puteau rula comenzi git distructive asupra checkout-ului principal; înainte de v2.1.247 driverele de filtru git din config-ul repo-ului (comenzi shell) rulau la crearea worktree-ului. Nicio creare/ștergere de worktree în repo-uri neverificate înainte de update.
- **Cale de implementare:** WRAP: Hub alege numele (hub-<runId>), pasează -w, păstrează worktree-ul după run și cere aprobare pentru `git worktree remove`.
- **Test necesar:** Test simulat al argumentelor; test live aprobat pe repo de probă.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Nu se folosește .worktreeinclude pentru fișiere cu secrete.
- **Surse citite:** https://code.claude.com/docs/en/worktrees · https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/agent-view · local: claude --help (-w, --tmux)
- **Verificare adversarială:** CORRECTED (corectat: securityConcerns (https://code.claude.com/docs/en/worktrees ; CHANGELOG 2.1.147, 2.1.205, 2.1.212, 2.1.222, 2.1.247)) — worktrees confirmă .claude/worktrees/<nume>, ramura worktree-<nume>, -p fără trust check și fără curățare (lock-ul rămâne), --fork-session în directorul de lansare, .worktreeinclude, worktree.baseRef, hooks WorktreeCreate/WorktreeRemove. Corectat securityConcerns pentru versiunea locală.

### Fluxuri Git/PR (commit, push, gh, `--from-pr`, /install-github-app) (`an-cc-git-workflows`)

- **Sursă oficială:** https://code.claude.com/docs/en/cli-reference
- **Documentație tehnică:** https://code.claude.com/docs/en/headless
- **Ce face:** Claude poate face commit, push și PR prin Bash și gh, poate relua sesiuni legate de un PR și poate instala Claude GitHub App.
- **Plan necesar:** Toate planurile.
- **Platformă:** Local.
- **Rollout:** GA
- **Eligibilitate cont:** Max verificat.
- **Autentificare:** Git/gh ale utilizatorului.
- **Allowance:** Cota Max pentru turn-uri.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** /install-github-app poate crea secrete și workflow-uri GitHub (minute Actions).
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: fără comandă dedicată; reguli de permisiune pe Bash (ex. allow Bash(git diff *), deny Bash(git push *), Bash(git commit *)); `--from-pr <nr\|url>`; includeGitInstructions și attribution în settings. \| Disponibil pe plan: da. \| Controlabil programatic: da, prin reguli. \| Reutilizabil din Hub: Hub păstrează commit/push/deploy ca acțiuni proprii cu aprobare. \| Interacțiune: aprobare. \| Securitate: push și PR sunt efecte externe; auto-fix din cloud poate posta sub identitatea GitHub a proprietarului.
- **Suprafață nativă:** Terminal.
- **Cerințe locale:** Git, gh opțional.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Claude pregătește diff-uri; Hub execută commit/push doar după aprobare explicită.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Codex (commit/PR prin shell, `codex apply`).
- **Ce face unic / mai bine:** Legare sesiune-PR automată.
- **Securitate:** Push neautorizat; mesaje de commit cu atribuire.
- **Cale de implementare:** WRAP: deny explicit pentru git commit/push/tag și gh pr create în toate run-urile Hub; acțiune Hub separată pentru commit.
- **Test necesar:** Test simulat: deny prezent în argumente; live doar cu grant.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Adaptorul V2 permite doar git status/diff/log.
- **Surse citite:** https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/headless · https://code.claude.com/docs/en/github-actions · https://code.claude.com/docs/en/claude-code-on-the-web
- **Verificare adversarială:** CONFIRMED — cli-reference (--from-pr), github-actions (/install-github-app instalează app-ul, salvează secretul și pregătește workflow-ul), claude-code-on-the-web (auto-fix postează sub contul GitHub al proprietarului), memory (includeGitInstructions, attribution).

### Unelte de fișiere și shell (Read/Edit/Write/Glob/Grep/NotebookEdit/Bash/PowerShell, `--tools`) (`an-cc-file-tools`)

- **Sursă oficială:** https://code.claude.com/docs/en/tools-reference
- **Documentație tehnică:** https://code.claude.com/docs/en/cli-reference
- **Ce face:** Unelte încorporate de citire, editare, căutare și shell; pe Windows unealta PowerShell poate deveni shell principal.
- **Plan necesar:** Toate planurile.
- **Platformă:** Windows 11 (Glob/Grep în setul implicit pe Windows).
- **Rollout:** GA
- **Eligibilitate cont:** Max verificat.
- **Autentificare:** Nu depinde.
- **Allowance:** Nu consumă în sine.
- **Utilizare partajată:** Nu se aplică.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: `--tools "Read,Glob,Grep"` restrânge setul încorporat (nu și MCP); `--allowedTools`/`--disallowedTools` cu sintaxă de reguli (Bash(git diff *), Edit(//cale/**)); pe Windows cu Git Bash, PowerShell tool este activ implicit pentru conturi claude.ai și rulează cu ExecutionPolicy Bypass la nivel de proces (CLAUDE_CODE_USE_POWERSHELL_TOOL=0 îl oprește). \| Disponibil pe plan: da. \| Controlabil programatic: da. \| Reutilizabil din Hub: da, V2 folosește liste stricte. \| Interacțiune: nu. \| Securitate: regulile Bash au limite de potrivire; unelte precum Artifact, WebFetch, WebSearch, PushNotification, SendUserFile și RemoteTrigger trebuie excluse în run-urile Hub (lista --tools din V2 le exclude).
- **Suprafață nativă:** Nu se aplică.
- **Cerințe locale:** Git Bash sau PowerShell 5.1/7.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Suprafața de unelte controlată de Hub per nivel de acces.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Codex shell_tool și apply_patch.
- **Ce face unic / mai bine:** Liste per unealtă și per pattern.
- **Securitate:** Regulile Bash nu acoperă PowerShell; bypass de ExecutionPolicy la nivel de proces.
- **Cale de implementare:** WRAP: menținerea listelor explicite; env CLAUDE_CODE_USE_POWERSHELL_TOOL=0 dacă Hub nu vrea PowerShell.
- **Test necesar:** Test simulat: argumentele --tools; verificare în system/init a listei efective de unelte.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Disponibilitatea implicită a PowerShell tool pe 2.1.175 trebuie confirmată din system/init la primul turn aprobat.
- **Surse citite:** https://code.claude.com/docs/en/tools-reference · https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/permission-modes · local: claude --help (--tools)
- **Verificare adversarială:** CONFIRMED — tools-reference: PowerShell tool activ implicit pe Windows cu Git Bash pentru conturi claude.ai/Console, ExecutionPolicy Bypass la nivel de proces, încă în preview; cli-reference: --tools nu afectează MCP, Glob/Grep sunt în setul implicit pe Windows nativ. Cu PowerShell activ, acceptEdits aprobă și Set-Content/Add-Content/Clear-Content/Remove-Item în directorul de lucru.

### Extensia VS Code Claude Code (`an-cc-vscode`)

- **Sursă oficială:** https://code.claude.com/docs/en/vs-code
- **Documentație tehnică:** https://code.claude.com/docs/en/vs-code
- **Ce face:** Interfață grafică nativă în VS Code: revizuirea planurilor, diff-uri inline, @-mention cu linii, istoric, conversații multiple, Chrome.
- **Plan necesar:** Pro, Max, Team, Enterprise sau Console.
- **Platformă:** VS Code 1.94+ pe Windows.
- **Rollout:** GA
- **Eligibilitate cont:** Max eligibil; instalarea extensiei neverificată.
- **Autentificare:** claude.ai sau Console.
- **Allowance:** Cota Max partajată.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Mecanism: extensie din marketplace; handler vscode://anthropic.claude-code/open pentru deschidere cu prompt; aceleași setări ca CLI. \| Disponibil pe plan: da. \| Controlabil programatic: nu. \| Reutilizabil din Hub: ASSISTED prin link. \| Interacțiune: da. \| Securitate: acceptEdits poate modifica fișiere de configurare IDE.
- **Suprafață nativă:** Panou VS Code.
- **Cerințe locale:** VS Code instalat.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Suprafață alternativă pentru lucru asistat.
- **Suprafață de execuție:** anthropic.claude_code_ide
- **Echivalent la celălalt ecosistem:** Extensia Codex pentru IDE.
- **Ce face unic / mai bine:** Revizuire vizuală a planurilor și diff-urilor.
- **Securitate:** Configurări IDE auto-executabile.
- **Cale de implementare:** ASSISTED.
- **Test necesar:** Niciunul.
- **Status:** DOCUMENTED
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Instalarea extensiei nu a fost verificată local.
- **Surse citite:** https://code.claude.com/docs/en/vs-code · https://code.claude.com/docs/en/feature-availability · https://code.claude.com/docs/en/deep-links
- **Verificare adversarială:** CONFIRMED — vs-code: VS Code 1.94.0+, orice abonament plătit sau cont Console; deep-links: vscode://anthropic.claude-code/open.

### Pluginul JetBrains Claude Code (beta) (`an-cc-jetbrains`)

- **Sursă oficială:** https://code.claude.com/docs/en/jetbrains
- **Documentație tehnică:** https://code.claude.com/docs/en/jetbrains
- **Ce face:** Rulează `claude` în terminalul IDE și îl conectează la IDE pentru diff-uri native, partajarea selecției și diagnostice.
- **Plan necesar:** Pro, Max, Team, Enterprise sau Console.
- **Platformă:** IntelliJ, PyCharm, WebStorm etc.; WSL cu configurări speciale.
- **Rollout:** Beta
- **Eligibilitate cont:** Max eligibil; neinstalat (neverificat).
- **Autentificare:** claude.ai.
- **Allowance:** Cota Max.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Mecanism: plugin JetBrains + CLI; `/ide`, `--ide`; server MCP 'ide' pe WebSocket loopback cu token într-un fișier lock sub ~/.claude/ide (secret local, nu se citește); unealta mcp__ide__getDiagnostics. \| Disponibil pe plan: da. \| Controlabil programatic: nu. \| Reutilizabil din Hub: nu. \| Interacțiune: da. \| Securitate: opțiunea de ascultare pe toate interfețele expune portul în rețea cu trafic necriptat.
- **Suprafață nativă:** IDE JetBrains.
- **Cerințe locale:** IDE JetBrains.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Suprafață opțională pentru proprietar.
- **Suprafață de execuție:** anthropic.claude_code_ide
- **Echivalent la celălalt ecosistem:** Integrări IDE Codex.
- **Ce face unic / mai bine:** Diagnostice IDE pentru Claude.
- **Securitate:** Token de conexiune local; expunere în rețea dacă e configurat greșit.
- **Cale de implementare:** ASSISTED.
- **Test necesar:** Niciunul.
- **Status:** DOCUMENTED
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Hub nu citește fișierele lock ale IDE.
- **Surse citite:** https://code.claude.com/docs/en/jetbrains
- **Verificare adversarială:** CONFIRMED — jetbrains: plugin marcat Beta, rulează CLI-ul din terminalul IDE, server MCP ide cu token în ~/.claude/ide/<port>.lock, singura unealtă vizibilă getDiagnostics, avertismentul privind ascultarea pe toate interfețele.

### Claude Code Desktop (tab Code): sesiuni paralele, worktrees, cloud/SSH/WSL (`an-cc-desktop-code-tab`)

- **Sursă oficială:** https://code.claude.com/docs/en/desktop
- **Documentație tehnică:** https://code.claude.com/docs/en/desktop
- **Ce face:** Aplicație desktop cu sesiuni Claude Code paralele (Local, Cloud, SSH, WSL), izolare worktree, panouri de diff/terminal/browser, side chats și mesaje între sesiunile Desktop.
- **Plan necesar:** Abonament claude.ai.
- **Platformă:** Windows x64/ARM64, macOS, Linux (beta).
- **Rollout:** GA
- **Eligibilitate cont:** Max; aplicația este folosită local.
- **Autentificare:** claude.ai (OAuth).
- **Allowance:** Cota Max partajată.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Bypass permissions necesită toggle; nu afectează facturarea.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Mecanism: UI Desktop; unelte de gestionare a sesiunilor disponibile doar în sesiunile Desktop; poate relua sesiuni CLI (/desktop). \| Disponibil pe plan: da. \| Controlabil programatic: nu din Hub. \| Reutilizabil din Hub: ASSISTED. \| Interacțiune: da. \| Securitate: sesiunile Desktop nu văd sesiunile CLI ale Hub-ului și invers.
- **Suprafață nativă:** Claude Desktop, tab Code.
- **Cerințe locale:** Claude Desktop instalat.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Suprafața principală de lucru asistat a proprietarului.
- **Suprafață de execuție:** anthropic.claude_code_desktop
- **Echivalent la celălalt ecosistem:** Codex desktop app.
- **Ce face unic / mai bine:** Panouri integrate, computer use pe Windows, scheduled tasks locale.
- **Securitate:** Al doilea loc în care se pot porni sesiuni paralele.
- **Cale de implementare:** ASSISTED.
- **Test necesar:** Niciunul.
- **Status:** AVAILABLE
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Desktop are propria versiune a runtime-ului Claude Code, independentă de CLI-ul npm 2.1.175.
- **Surse citite:** https://code.claude.com/docs/en/desktop · https://code.claude.com/docs/en/feature-availability · local: sources-anthropic-local.md (sesiunea curentă rulează în Desktop)
- **Verificare adversarială:** CONFIRMED — desktop: Windows x64/ARM64, macOS, Linux beta; sesiuni Local/Cloud/SSH/WSL; același motor ca CLI-ul, cu liste de sesiuni separate; /desktop pe macOS și Windows x64 cu abonament; toggle separat pentru bypass permissions.

### Guvernanța și fixarea versiunii Claude Code folosite de Hub (autoUpdatesChannel, minimumVersion, DISABLE_AUTOUPDATER, DISABLE_UPDATES, requiredMinimumVersion/requiredMaximumVersion) (`an-gap-cc-version-governance`)

- **Sursă oficială:** https://code.claude.com/docs/en/setup
- **Documentație tehnică:** https://code.claude.com/docs/en/settings-reference
- **Ce face:** Controlează actualizările: canal stable (aprox. o săptămână în urmă, fără regresii majore) sau latest; minimumVersion este doar o podea pentru update-uri; DISABLE_AUTOUPDATER oprește update-ul de fundal (claude update manual funcționează); DISABLE_UPDATES blochează și claude update/claude install; requiredMinimumVersion/requiredMaximumVersion (managed-only, ≥2.1.163) refuză pornirea în afara intervalului. Instalarea unei versiuni exacte: installerul nativ acceptă număr de versiune; npm install -g @anthropic-ai/claude-code@<versiune>. Serverul refuză modelele noi pe CLI vechi (400 claude_code_version_too_old): Opus 5.5 cere ≥2.1.280, Sonnet 5.5 ≥2.1.284, Fable 5.1 ≥2.1.257. Aliasurile depind de versiune: pe 2.1.175, opus → Opus 4.8, fable → Fable 5, iar sonnet → un model anterior Sonnet 5 (schimbare la 2.1.197).
- **Plan necesar:** Oricare
- **Platformă:** Claude Code CLI (npm, installer nativ, WinGet, Homebrew, apt/dnf/apk); Claude Desktop își livrează propriul binar
- **Rollout:** GA
- **Eligibilitate cont:** Aplicabil
- **Autentificare:** Independent; OAuth neafectat.
- **Allowance:** N/A
- **Utilizare partajată:** N/A
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Nu direct; indirect, un update necontrolat poate schimba aliasurile de model și implicit costul în limite.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Per proces, fără schimbare globală: DISABLE_AUTOUPDATER=1 (sau DISABLE_UPDATES=1) în mediul fiecărui copil, ca un run Hub să nu declanșeze update; Hub citește claude --version înainte de rutare și refuză versiunile în afara intervalului aprobat (reimplementare locală a requiredMin/Max, care altfel cer managed settings, adică o schimbare globală: fișier în C:\Program Files\ClaudeCode sau valoare Settings sub HKLM/HKCU\SOFTWARE\Policies\ClaudeCode). autoUpdatesChannel/minimumVersion pot fi date prin --settings, dar afectează doar update-urile. Upgrade-ul este o acțiune separată, aprobată de proprietar.
- **Suprafață nativă:** /config (Auto-update channel), claude update, claude install stable\|latest\|<versiune>, claude doctor
- **Cerințe locale:** Local: npm CLI 2.1.175 (binar din 12.06.2026). npm dist-tags la 30.09.2026: stable=2.1.280, latest=next=2.1.285. Claude Desktop 2.16120.0 (29.09.2026) include Claude Code 2.1.284, iar local există %APPDATA%\Claude\claude-code\2.1.281 și 2.1.284. Nu există managed settings locale (nici fișier, nici HKLM/HKCU).
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Poartă de versiune în adaptorul Claude: interval aprobat, versiune înregistrată per run, niciun update automat din rulările Hub.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Codex CLI 0.158: versiunea app-server raportată în handshake; oa-codex-shared-daemon (pornire automată din 0.157.0).
- **Ce face unic / mai bine:** Controale oficiale de canal, podea și interval; eroare explicită claude_code_version_too_old.
- **Securitate:** Auto-update-ul unei instalări npm poate schimba binarul între rulări dacă directorul global npm este scriibil. Binarul inclus în Desktop nu este un punct de intrare documentat pentru terți și se schimbă odată cu aplicația.
- **Cale de implementare:** 1) DISABLE_AUTOUPDATER=1 în mediul copilului; 2) verificare de versiune la pornirea adaptorului; 3) propunere către proprietar: upgrade aprobat la o versiune fixă (≥2.1.284 pentru Sonnet 5.5) și înregistrarea ei în Hub.
- **Test necesar:** Fără model: claude --version înainte/după o rulare cu DISABLE_AUTOUPDATER=1. După upgrade aprobat: rulare LIVE_VALIDATION cu model explicit claude-opus-5-5.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Contradicție de semnalat: Hub-ul rulează CLI 2.1.175, deci nu poate folosi Opus 5.5 sau Sonnet 5.5 (400 claude_code_version_too_old), iar aliasurile opus/sonnet produc modele mai vechi; stable (2.1.280) acoperă Opus 5.5, dar nu Sonnet 5.5. Motivul pentru care npm a rămas la 2.1.175 nu a fost verificat (claude doctor pornește servere stdio din .mcp.json, deci nu a fost rulat). an-cc-version-updates și an-claude-code-cli-version acoperă actualizarea, nu fixarea.
- **Surse citite:** https://code.claude.com/docs/en/setup.md · https://code.claude.com/docs/en/settings-reference.md · https://code.claude.com/docs/en/env-vars.md · https://code.claude.com/docs/en/model-config.md · https://code.claude.com/docs/en/errors.md · https://code.claude.com/docs/en/managed-settings.md · https://registry.npmjs.org/-/package/@anthropic-ai/claude-code/dist-tags · https://claude.com/docs/cowork/changelog.md · local: claude --version, Get-AppxPackage Claude, listarea %APPDATA%\Claude\claude-code
- **Verificare adversarială:** CONFIRMED — Confirmat: autoUpdatesChannel (stable aprox. o săptămână în urmă), minimumVersion doar podea pentru update-uri, DISABLE_AUTOUPDATER (claude update rămâne funcțional), DISABLE_UPDATES (blochează și claude update/claude install), requiredMinimumVersion/requiredMaximumVersion managed-only ≥2.1.163, locațiile Windows (C:\Program Files\ClaudeCode, valoarea Settings sub HKLM/HKCU\SOFTWARE\Policies\ClaudeCode), eroarea claude_code_version_too_old, Opus 5.5 ≥2.1.280, Sonnet 5.5 ≥2.1.284, Fable 5.1 ≥2.1.257, aliasul sonnet → Sonnet 5 abia de la 2.1.197. npm dist-tags citite acum: stable=2.1.280, latest=next=2.1.285. Nuanță: documentația arată fixarea exactă prin claude install <versiune> (care instalează binarul nativ, deci schimbă tipul instalării); forma npm @<versiune> nu apare explicit, doar @latest. Cheia HKCU este scriibilă de utilizator, dar rămâne o schimbare globală.

### claude import / /import: preluarea configurației din OpenAI Codex, Gemini CLI sau Cursor (`an-gap-cc-import`)

- **Sursă oficială:** https://code.claude.com/docs/en/commands
- **Documentație tehnică:** https://code.claude.com/docs/en/cli-reference
- **Ce face:** Aduce în Claude Code fișierele de instrucțiuni, serverele MCP, comenzile, subagenții și skill-urile din Codex, Gemini CLI sau Cursor de pe mașină. --dry-run previzualizează fără să scrie, --yes sare peste selector; în -p comanda listează ce a găsit și dă comanda de confirmare. /init poate propune importul când găsește configurație Codex/Gemini.
- **Plan necesar:** Oricare plan pe Claude API (nu pe Bedrock, Agent Platform, Foundry, Claude Platform on AWS sau gateway)
- **Platformă:** Claude Code CLI
- **Rollout:** ≥2.1.213; import din Cursor ≥2.1.265; indisponibil fără feature flags
- **Eligibilitate cont:** Disponibil după upgrade
- **Autentificare:** OAuth de abonament
- **Allowance:** Nedocumentat dacă listarea în -p pornește inferență.
- **Utilizare partajată:** Alocarea comună Max
- **Inclus în abonament?:** unknown
- **Risc de facturare suplimentară (credite/extra usage):** Nu
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** claude import codex --dry-run (sesiune interactivă) sau /import codex --dry-run în -p. Scrierea configurației (MCP, skills, comenzi) modifică setări, deci este interzisă Hub-ului fără aprobare explicită.
- **Suprafață nativă:** claude import, /import, /init
- **Cerințe locale:** Lipsește în 2.1.175; necesită upgrade.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Referință de paritate Codex↔Claude; Hub-ul își păstrează propriul catalog canonic de skills/MCP și propune importuri ca acțiuni aprobate.
- **Suprafață de execuție:** anthropic.claude_code_interactive
- **Echivalent la celălalt ecosistem:** oa-codex-import-external-agent și oa-import-other-agent (Codex/ChatGPT importă din Claude Code).
- **Ce face unic / mai bine:** Traducere oficială a formatelor Codex/Gemini/Cursor în formatele Claude Code.
- **Securitate:** Poate importa servere MCP cu credențiale sau comenzi locale din alt agent; modifică configurația globală a utilizatorului.
- **Cale de implementare:** Hub prezintă proprietarului rezultatul unui --dry-run rulat de proprietar; importul real rămâne acțiune manuală.
- **Test necesar:** După upgrade și aprobare: --dry-run într-un profil de test.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Nu se știe dacă /import în -p consumă inferență.
- **Surse citite:** https://code.claude.com/docs/en/commands.md · https://code.claude.com/docs/en/cli-reference.md · https://code.claude.com/docs/en/env-vars.md · local: claude --help (2.1.175, comanda import lipsește)
- **Verificare adversarială:** CONFIRMED — commands.md și cli-reference confirmă: /import [codex\|gemini\|cursor] [--dry-run] [--yes], ≥2.1.213, Cursor ≥2.1.265, indisponibil pe Bedrock, Agent Platform, Foundry, Claude Platform on AWS, prin Claude apps gateway sau fără feature-flag fetching; în -p listează ce a găsit și dă comanda de confirmare; claude import pornește o sesiune interactivă. Dacă listarea în -p consumă inferență rămâne nedocumentat.

## agents

### Ultracode (orchestrare de dynamic workflows) (`an-ultracode`)

- **Sursă oficială:** https://code.claude.com/docs/en/model-config
- **Documentație tehnică:** https://code.claude.com/docs/en/workflows
- **Ce face:** Setare Claude Code (nu nivel de effort) care planifică pentru fiecare sarcină substanțială un dynamic workflow cu mulți subagenți; --effort ultracode pornește sesiunea la xhigh cu ultracode activ.
- **Plan necesar:** Orice plan cu Claude Code; modelul trebuie să suporte xhigh
- **Platformă:** Claude Code ≥2.1.203 (comportamentul actual ≥2.1.284)
- **Rollout:** GA
- **Eligibilitate cont:** Flag-ul --effort ultracode și setarea ultracode cer ≥2.1.203 și lipsesc în 2.1.175. Totuși, cuvântul-cheie „ultracode” (redenumit din „workflow” în 2.1.160) există în 2.1.175. Înainte de 2.1.210, el pornea un dynamic workflow și dintr-un prompt -p sau din conținut relayat.
- **Autentificare:** OAuth claude.ai
- **Allowance:** Fiecare agent din workflow consumă separat din limite
- **Utilizare partajată:** Pool comun
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Consum mare și rapid al limitelor de plan.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** --effort ultracode, setarea ultracode sau effortLevel ultracode în Agent SDK.
- **Suprafață nativă:** /effort ultracode
- **Cerințe locale:** CLI ≥2.1.203
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Niciunul implicit; Hub-ul își orchestrează singur sarcinile.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** multi_agent și vizualizarea /agents din Codex CLI
- **Ce face unic / mai bine:** Paralelism nativ pentru audituri mari și migrări
- **Securitate:** Multiplică acțiunile autonome și consumul; greu de auditat pas cu pas.
- **Cale de implementare:** CLAUDE_CODE_DISABLE_WORKFLOWS=1 (sau disableWorkflows: true prin --settings) în mediul copil. Interzicerea --effort ultracode și a setării ultracode. Workflow lipsește din --tools. Pe CLI < 2.1.210, cuvântul „ultracode” este filtrat din prompturi.
- **Test necesar:** Niciunul
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Workflow-urile dinamice sunt enumerate de documentația de costuri printre cauzele consumului ridicat.
- **Surse citite:** https://code.claude.com/docs/en/model-config · https://code.claude.com/docs/en/commands · https://code.claude.com/docs/en/costs
- **Verificare adversarială:** CORRECTED (corectat: accountEligibility (https://code.claude.com/docs/en/workflows; https://code.claude.com/docs/en/changelog), implementationPath (https://code.claude.com/docs/en/env-vars; https://code.claude.com/docs/en/workflows), status (https://code.claude.com/docs/en/workflows)) — NEEDS_SETUP contrazice decizia REJECT și ignoră faptul că declanșatorul prin cuvânt-cheie există deja local; statusul corect este blocarea prin politica Hub. Pagina workflows mai arată că, în -p, un Workflow trece prin evaluarea permisiunilor (dontAsk și regulile deny se aplică) și că rulările pot consuma masiv din plan.

### Subagenți (Explore/Plan/general-purpose, .claude/agents, `--agents` JSON, fundal, imbricați, fork) (`an-cc-subagents`)

- **Sursă oficială:** https://code.claude.com/docs/en/sub-agents
- **Documentație tehnică:** https://code.claude.com/docs/en/sub-agents
- **Ce face:** Deleagă sub-sarcini în ferestre de context separate, în prim-plan sau fundal; în versiunile curente permite imbricare până la 3 niveluri (implicit din v2.1.219) și maximum 20 de subagenți concurenți (plafon introdus în v2.1.217) — valori care nu există pe CLI-ul local 2.1.175; fork-urile (`/subtask`, v2.1.212+) moștenesc conversația.
- **Plan necesar:** Toate planurile.
- **Platformă:** Local și cloud.
- **Rollout:** GA
- **Eligibilitate cont:** Max verificat.
- **Autentificare:** OAuth claude.ai.
- **Allowance:** Fiecare subagent consumă separat din cota Max.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu în sine; modelul subagentului poate fi Fable dacă e configurat.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: definiții în .claude/agents, ~/.claude/agents, plugin sau `--agents '<json>'` (description, prompt, tools, disallowedTools, model, permissionMode, maxTurns, skills, mcpServers, hooks, memory, background, isolation: worktree, effort); `--agent <nume>` pentru firul principal; control: deny `Agent` sau `Agent(Explore)`, CLAUDE_CODE_SUBAGENT_MODEL, CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH, CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS (v2.1.217+), CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 (forțează prim-planul). Observare în stream-json prin parent_tool_use_id; `--forward-subagent-text` apare în v2.1.211 (absent local). \| Disponibil pe plan: da. \| Controlabil programatic: da. \| Reutilizabil din Hub: Hub poate furniza roluri per run prin --agents fără fișiere. \| Interacțiune: nu. \| Securitate: subagenții rulează în modul părintelui când acesta e bypassPermissions/acceptEdits/auto; hooks din frontmatter-ul agenților de proiect cer workspace trust abia din v2.1.218, iar mcpServers inline abia din v2.1.238 — pe 2.1.175 se încarcă fără trust; editările lor nu intră în checkpoint-uri; pe 2.1.175 nu există plafonul de concurență.
- **Suprafață nativă:** /agents, /tasks, @-mention de agent.
- **Cerințe locale:** Niciuna.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Paralelism intern al unui run Claude; Hub rămâne unicul proprietar al task-ului, subagenții sunt copii observați, nu sub-task-uri Hub.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Codex multi_agent (activ local).
- **Ce face unic / mai bine:** Fork cu cache partajat, memorie persistentă per agent, izolare worktree per subagent.
- **Securitate:** Propagarea permisiunilor; cost multiplicat; editări nerecuperabile prin rewind.
- **Cale de implementare:** REUSE_NATIVE: Hub pasează --agents definite de Hub, interzice Agent în run-urile read-only simple și înregistrează subagenții din stream ca evenimente ale aceluiași run.
- **Test necesar:** Test simulat de parsare a parent_tool_use_id; live doar cu grant.
- **Status:** AVAILABLE
- **Decizie Hub:** REUSE_NATIVE
- **Încredere:** high
- **Note:** Regula unui singur proprietar al ciclului de viață: nu se creează task-uri Hub duplicate pentru subagenți.
- **Surse citite:** https://code.claude.com/docs/en/sub-agents · https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/headless · https://code.claude.com/docs/en/checkpointing · local: claude --help (--agent, --agents)
- **Verificare adversarială:** CORRECTED (corectat: whatItDoes (https://code.claude.com/docs/en/sub-agents ; CHANGELOG 2.1.217, 2.1.219), programmaticDetail (https://code.claude.com/docs/en/sub-agents ; https://code.claude.com/docs/en/permissions)) — sub-agents confirmă locațiile și precedența, câmpurile, moștenirea permisiunilor, restricțiile pentru subagenții din pluginuri și efectul CLAUDE_CODE_DISABLE_BACKGROUND_TASKS. Corectate pragurile de versiune și cerințele de trust.

### Comenzi în fundal (`run_in_background`), Monitor, TaskStop, /tasks (`an-cc-background-tasks`)

- **Sursă oficială:** https://code.claude.com/docs/en/tools-reference
- **Documentație tehnică:** https://code.claude.com/docs/en/headless
- **Ce face:** Claude poate porni procese lungi în fundal (dev server, watch), le poate urmări ieșirea și le poate opri; comenzile care depășesc timeout-ul trec automat în fundal.
- **Plan necesar:** Toate planurile.
- **Platformă:** Local.
- **Rollout:** GA
- **Eligibilitate cont:** Max verificat.
- **Autentificare:** OAuth claude.ai.
- **Allowance:** Monitor și reacțiile la evenimente consumă turn-uri.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: unelte Bash (run_in_background), Monitor (linii sau WebSocket), TaskStop, TaskOutput (depreciat). În -p: shell-urile de fundal se opresc ~5 s după rezultat; subagenții/workflow-urile de fundal țin procesul deschis până la 10 min de inactivitate (CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS); la SIGTERM arborele de procese Bash este terminat. Dezactivare: CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1. \| Disponibil pe plan: da. \| Controlabil programatic: indirect, prin env și procesul părinte. \| Reutilizabil din Hub: Hub își păstrează supervisorul propriu și dezactivează fundalul implicit. \| Interacțiune: nu. \| Securitate: procese orfane pe Windows dacă claude este ucis brutal; porturi deschise.
- **Suprafață nativă:** /tasks.
- **Cerințe locale:** Supervisor Hub care curăță arborele de procese.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Dezactivat implicit în run-urile Hub pentru ciclu de viață determinist; activat doar prin grant explicit.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Codex unified_exec (activ local).
- **Ce face unic / mai bine:** Monitor reacționează la loguri fără polling.
- **Securitate:** Procese care supraviețuiesc run-ului.
- **Cale de implementare:** WRAP: env CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 în buildChildEnv; opțiune de grant pentru activare.
- **Test necesar:** Test simulat: env setat în procesul copil; verificare curățare procese la anulare.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Aceeași variabilă forțează și subagenții/skill-urile fork în prim-plan.
- **Surse citite:** https://code.claude.com/docs/en/tools-reference · https://code.claude.com/docs/en/headless · https://code.claude.com/docs/en/sub-agents
- **Verificare adversarială:** CONFIRMED — tools-reference și headless confirmă run_in_background, mutarea automată în fundal la timeout (cu excepția sleep), Monitor (existent din v2.1.98; sursa WebSocket din v2.1.195), TaskOutput depreciat, oprirea la ~5 s în -p, plafonul de 10 minute (CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS), terminarea arborelui Bash la SIGTERM și efectul CLAUDE_CODE_DISABLE_BACKGROUND_TASKS.

### Agent view și sesiuni de fundal (`claude agents`, `--bg`, supervisor) (`an-cc-agent-view`)

- **Sursă oficială:** https://code.claude.com/docs/en/agent-view
- **Documentație tehnică:** https://code.claude.com/docs/en/cli-reference
- **Ce face:** Un supervisor local găzduiește sesiuni Claude independente de terminal; agent view le listează, le trimite prompturi, se atașează și le oprește; sesiunile trec automat în worktree înainte de editări.
- **Plan necesar:** Toate planurile (research preview).
- **Platformă:** Local; persistă peste închiderea terminalului și sleep, nu peste oprire.
- **Rollout:** Research preview
- **Eligibilitate cont:** Max verificat; directorul ~/.claude/daemon există.
- **Autentificare:** OAuth claude.ai.
- **Allowance:** Fiecare sesiune consumă separat; 10 agenți paraleli ≈ 10x consum.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu în sine; risc de consum ridicat nesupravegheat.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism verificat: `claude agents --json` (fără TTY) → [{pid, cwd, kind, startedAt, sessionId, name, status}], `--all` include sesiunile terminate, `--cwd` filtrează. Documentat, neconfirmat în help-ul 2.1.175: `claude --bg`, `--exec`, `claude attach\|logs\|stop\|rm\|respawn <id>`, `claude daemon status\|stop`, stare în ~/.claude/jobs/<id>/state.json. \| Disponibil pe plan: da. \| Controlabil programatic: listare da; dispatch prin --bg (neconfirmat local). \| Reutilizabil din Hub: MIRROR_STATE — Hub vede sesiunile native ale proprietarului, read-only. \| Interacțiune: dispatch-ul și răspunsurile vin de obicei de la proprietar. \| Securitate: sesiuni nesupravegheate de durată; ștergerea din agent view poate elimina worktree cu modificări necomise.
- **Suprafață nativă:** `claude agents` (TUI), Esc/← din sesiune, /bg.
- **Cerințe locale:** Niciuna pentru listare.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Oglindă read-only a sesiunilor Claude ale proprietarului în dashboard-ul Hub.
- **Suprafață de execuție:** anthropic.claude_code_background
- **Echivalent la celălalt ecosistem:** Codex /agents view și `codex agents` pe daemonul app-server.
- **Ce face unic / mai bine:** Listare JSON fără TTY; izolare automată în worktree.
- **Securitate:** Al doilea proprietar al ciclului de viață dacă Hub ar dispecerizeze sesiuni --bg.
- **Cale de implementare:** MIRROR_STATE: polling `claude agents --json --all` cu env controlat; Hub nu pornește și nu oprește sesiuni native fără aprobare.
- **Test necesar:** Test read-only existent (fără inferență): parsarea JSON-ului; testul a fost deja efectuat local.
- **Status:** AVAILABLE
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** high
- **Note:** Hub poate asocia declarativ un sessionId nativ unui task, fără a prelua controlul.
- **Surse citite:** https://code.claude.com/docs/en/agent-view · https://code.claude.com/docs/en/cli-reference · local: claude agents --help (2.1.175) · local: sources-anthropic-local.md (claude agents --json funcționează) · local: scanare stringuri claude.exe (--bg, --exec prezente)
- **Verificare adversarială:** CONFIRMED — agent-view: research preview, fără restricție de plan, supervisor care persistă peste închiderea terminalului și sleep (nu peste oprire), izolare automată în worktree, câmpurile JSON, ștergerea din agent view poate elimina modificări necomise. Local, `claude agents --help` pe 2.1.175 listează --json (fără TTY) și --all. CHANGELOG: agent view din v2.1.139, --json din v2.1.145; attach/logs/stop/rm/respawn apar în --help abia din v2.1.251.

### Agent teams (experimental) (`an-cc-agent-teams`)

- **Sursă oficială:** https://code.claude.com/docs/en/agent-teams
- **Documentație tehnică:** https://code.claude.com/docs/en/agent-teams
- **Ce face:** O sesiune lead coordonează sesiuni Claude teammate cu listă de task-uri partajată, mailbox și mesaje directe.
- **Plan necesar:** Toate planurile.
- **Platformă:** Local, interactiv (split panes necesită tmux/iTerm2, nu Windows Terminal).
- **Rollout:** Experimental, dezactivat implicit
- **Eligibilitate cont:** Max verificat.
- **Autentificare:** OAuth claude.ai.
- **Allowance:** Consum mare (circa 7x în plan mode).
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu, dar consum ridicat.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Mecanism: CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1; `--teammate-mode`; stare în ~/.claude/teams și ~/.claude/tasks; hooks TeammateIdle, TaskCreated, TaskCompleted. În -p/SDK nu se creează teammates. \| Disponibil pe plan: da. \| Controlabil programatic: nu. \| Reutilizabil din Hub: nu. \| Interacțiune: da. \| Securitate: teammates moștenesc modul lead-ului, inclusiv bypass; al doilea orchestrator de task-uri.
- **Suprafață nativă:** Panou de agenți în TUI.
- **Cerințe locale:** Nu se aplică pentru Hub.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Neutilizat de Hub; variabila rămâne 0 în run-urile Hub.
- **Suprafață de execuție:** anthropic.claude_code_interactive
- **Echivalent la celălalt ecosistem:** Codex multi_agent_v2 (dezactivat local).
- **Ce face unic / mai bine:** Comunicare directă între teammates.
- **Securitate:** Dublă proprietate a task-urilor; limitări de reluare.
- **Cale de implementare:** REJECT pentru run-urile Hub; proprietarul poate experimenta separat.
- **Test necesar:** Niciunul.
- **Status:** DOCUMENTED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Conflict cu regula unui singur proprietar al ciclului de viață.
- **Surse citite:** https://code.claude.com/docs/en/agent-teams · https://code.claude.com/docs/en/costs · local: scanare stringuri claude.exe (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS prezent)
- **Verificare adversarială:** CONFIRMED — agent-teams: experimental, dezactivat implicit (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1), fără teammates în -p/Agent SDK, split panes nesuportate în Windows Terminal, teammates pornesc în modul lead-ului (exceptând dontAsk), hooks TeammateIdle/TaskCreated/TaskCompleted, stare în ~/.claude/teams și ~/.claude/tasks; costs: ~7x tokeni în plan mode.

### Dynamic workflows (unealta Workflow, ultracode, /deep-research) (`an-cc-dynamic-workflows`)

- **Sursă oficială:** https://code.claude.com/docs/en/workflows
- **Documentație tehnică:** https://code.claude.com/docs/en/workflows
- **Ce face:** Claude scrie un script JavaScript care orchestrează zeci până la sute de subagenți în fundal, pe faze, reluabil în aceeași sesiune.
- **Plan necesar:** Toate planurile plătite (pe Pro cu opt-in).
- **Platformă:** Local și cloud.
- **Rollout:** GA pe planurile plătite
- **Eligibilitate cont:** Max eligibil; versiunea locală conține funcționalitatea (confirmare parțială).
- **Autentificare:** OAuth claude.ai.
- **Allowance:** Consum mare și greu de prevăzut; se numără în limitele planului.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu în sine; epuizarea rapidă a cotei.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: unealta Workflow; în -p nu apare prompt de aprobare — rulează doar cu regulă allow `Workflow`/`Workflow(<nume>)`, mod auto/bypass, hook PreToolUse sau --permission-prompt-tool; în dontAsk este refuzată fără regulă. Limite: 16 agenți concurenți, 1000 per run; scripturi în .claude/workflows sau ~/.claude/workflows; dezactivare CLAUDE_CODE_DISABLE_WORKFLOWS=1 / disableWorkflows. \| Disponibil pe plan: da. \| Controlabil programatic: prin permisiuni și env. \| Reutilizabil din Hub: doar ca parte a unui run Hub, cu opt-in explicit. \| Interacțiune: nu în -p. \| Securitate: agenții folosesc regulile de permisiune ale sesiunii; cost mare.
- **Suprafață nativă:** /workflows, /effort ultracode.
- **Cerințe locale:** Niciuna.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Capacitate opțională pentru task-uri mari (audit, migrare), aprobată explicit; Hub rămâne proprietarul task-ului.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Codex multi-agent (fără echivalent direct de script).
- **Ce face unic / mai bine:** Orchestrare codificată, reluabilă, cu verificare adversarială.
- **Securitate:** Consum necontrolat; conflict potențial de ownership.
- **Cale de implementare:** REUSE_NATIVE cu env CLAUDE_CODE_DISABLE_WORKFLOWS=1 implicit și regulă Workflow doar în grant-uri dedicate.
- **Test necesar:** Test simulat al env-ului; live doar cu grant și buget de timp.
- **Status:** AVAILABLE
- **Decizie Hub:** REUSE_NATIVE
- **Încredere:** medium
- **Note:** Lista --tools din V2 exclude deja Workflow.
- **Surse citite:** https://code.claude.com/docs/en/workflows · https://code.claude.com/docs/en/model-config · local: scanare stringuri claude.exe (ultracode, CLAUDE_CODE_DISABLE_WORKFLOWS prezente)
- **Verificare adversarială:** CONFIRMED — workflows: toate planurile plătite (pe Pro cu opt-in din /config), 16 agenți concurenți, 1.000 per run, comportamentul Workflow în -p (fără prompt; necesită allow, auto, bypass, hook sau --permission-prompt-tool), dezactivare CLAUDE_CODE_DISABLE_WORKFLOWS/disableWorkflows. CHANGELOG: introduse în v2.1.154, deci prezente pe 2.1.175; din v2.1.210 cuvântul ultracode nu mai pornește un workflow dintr-un prompt -p.

### Liste de task-uri interne (TaskCreate/TaskUpdate/TaskList, TodoWrite) (`an-cc-task-tools`)

- **Sursă oficială:** https://code.claude.com/docs/en/tools-reference
- **Documentație tehnică:** https://code.claude.com/docs/en/tools-reference
- **Ce face:** Checklist intern al sesiunii folosit de Claude pentru planificare, partajat între teammates în agent teams.
- **Plan necesar:** Toate planurile.
- **Platformă:** Local.
- **Rollout:** GA (implicit doar pe anumite modele)
- **Eligibilitate cont:** Max verificat.
- **Autentificare:** OAuth claude.ai.
- **Allowance:** Neglijabil.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: apeluri tool_use TaskCreate/TaskUpdate/TaskList/TodoWrite vizibile în stream-json; stare locală în ~/.claude/tasks. \| Disponibil pe plan: da. \| Controlabil programatic: observare. \| Reutilizabil din Hub: ca progres al run-ului. \| Interacțiune: nu. \| Securitate: nicio problemă specială.
- **Suprafață nativă:** Ctrl+T în TUI.
- **Cerințe locale:** Niciuna.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Afișare de progres în Hub, fără a deveni task-uri Hub.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Planul intern al agentului Codex (neverificat aici).
- **Ce face unic / mai bine:** Structură de progres gratuită.
- **Securitate:** Nu.
- **Cale de implementare:** MIRROR_STATE: parsarea tool_use-urilor de task în evenimente de progres.
- **Test necesar:** Test simulat de parsare.
- **Status:** AVAILABLE
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** medium
- **Note:** Nu se creează sub-task-uri Hub din aceste liste.
- **Surse citite:** https://code.claude.com/docs/en/tools-reference · https://code.claude.com/docs/en/agent-teams
- **Verificare adversarială:** CONFIRMED — tools-reference: TaskCreate/TaskGet/TaskUpdate/TaskList sunt implicite doar pe Claude 3.x, Opus 4–4.7, Sonnet 4–4.6 și Haiku 4.5 (altfel opt-in); TodoWrite e dezactivat în favoarea lor și revine cu CLAUDE_CODE_ENABLE_TASKS=0.

### Claude Agent SDK (TypeScript/Python) și autentificarea prin abonament (`an-cc-agent-sdk`)

- **Sursă oficială:** https://code.claude.com/docs/en/agent-sdk/overview
- **Documentație tehnică:** https://code.claude.com/docs/en/agent-sdk/typescript
- **Ce face:** Bibliotecă ce rulează binarul Claude Code cu query(), sesiuni, callback-uri de hooks, canUseTool, subagenți, MCP in-process, ieșiri structurate, checkpointing și control la runtime.
- **Plan necesar:** Documentația SDK trimite la API key (Console) sau cloud providers; login-ul claude.ai în produse terțe nu este permis fără aprobare.
- **Platformă:** Node/Python; bundle de binar nativ ca dependență opțională.
- **Rollout:** GA (Commercial Terms)
- **Eligibilitate cont:** Rută API interzisă de BillingPolicy; rută OAuth neclară din punct de vedere al politicii.
- **Autentificare:** API key/cloud provider documentat; OAuth doar ca utilizator final al binarului nemodificat.
- **Allowance:** Cu API key: facturare per token.
- **Utilizare partajată:** Nu se aplică pentru API key.
- **Inclus în abonament?:** unknown
- **Risc de facturare suplimentară (credite/extra usage):** Facturare API cu cheie Console.
- **Risc de facturare API:** high
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: pachete @anthropic-ai/claude-agent-sdk și claude-agent-sdk; Query: interrupt(), rewindFiles(), setPermissionMode(), setModel(), supportedModels(), mcpServerStatus(), accountInfo(), stopTask(), close(); opțiuni settingSources (implicit user, project, local), persistSession, enableFileCheckpointing, outputFormat, permissionPrompts, pathToClaudeCodeExecutable. Politică: pagina SDK spune că, fără aprobare prealabilă, terții nu pot oferi login claude.ai sau limitele de abonament în produsele lor; pagina legală cere API key pentru dezvoltatorii de produse, dar permite unui utilizator final să se autentifice cu propriul abonament în binarul Claude Code nemodificat și precizează că limitele Pro/Max presupun uz individual obișnuit al Claude Code și al SDK-ului. \| Disponibil pe plan: neclar pentru OAuth. \| Controlabil programatic: da. \| Reutilizabil din Hub: ca referință de protocol; Hub folosește subprocesul CLI nemodificat, ruta documentată pentru alte limbaje. \| Interacțiune: nu. \| Securitate: instalarea pachetului este interzisă acum; al doilea binar.
- **Suprafață nativă:** Niciuna.
- **Cerințe locale:** Instalare npm/pip (interzisă în BUILD_SAFE).
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Referință pentru semantica controlului (interrupt, permisiuni, sesiuni).
- **Suprafață de execuție:** anthropic.claude_code_sdk
- **Echivalent la celălalt ecosistem:** OpenAI Agents API (facturare API, respinsă) și Codex app-server.
- **Ce face unic / mai bine:** Control complet la runtime; hooks ca callback-uri.
- **Securitate:** Risc de politică și de facturare.
- **Cale de implementare:** REFERENCE: nu se integrează SDK-ul; se preiau conceptele în adaptorul CLI.
- **Test necesar:** Niciunul.
- **Status:** BLOCKED
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Recomandare: confirmare scrisă de la Anthropic pentru orchestrarea locală, personală, a binarului nemodificat prin abonament.
- **Surse citite:** https://code.claude.com/docs/en/agent-sdk/overview · https://code.claude.com/docs/en/legal-and-compliance · https://code.claude.com/docs/en/agent-sdk/typescript · https://code.claude.com/docs/en/agent-sdk/permissions · https://code.claude.com/docs/en/agent-sdk/sessions · https://code.claude.com/docs/en/headless
- **Verificare adversarială:** CONFIRMED — agent-sdk/overview: fără aprobare prealabilă, terții nu pot oferi login claude.ai sau limitele de abonament; Commercial Terms; SDK-ul rulează binarul Claude Code. legal-and-compliance: dezvoltatorii de produse folosesc API key, utilizatorul final se poate autentifica cu propriul abonament în binarul nemodificat, limitele Pro/Max presupun uz individual obișnuit al Claude Code și al SDK-ului.

### Projects în Claude Code (coordonarea sesiunilor cloud) (`an-cc-projects`)

- **Sursă oficială:** https://code.claude.com/docs/en/claude-projects
- **Documentație tehnică:** https://code.claude.com/docs/en/claude-projects
- **Ce face:** O conversație continuă în care Claude pornește thread-uri (sesiuni cloud sau, la cerere, pe computerul local prin Remote Control) pentru un flux de lucru comun.
- **Plan necesar:** Pro, Max (nu Team/Enterprise încă).
- **Platformă:** claude.ai/code, Desktop.
- **Rollout:** Beta publică, rollout gradual cu waitlist
- **Eligibilitate cont:** Necunoscut dacă rollout-ul a ajuns la cont.
- **Autentificare:** claude.ai; Claude GitHub App pe fiecare repo.
- **Allowance:** Cota Max, multiplicată de thread-uri.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu în sine.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Mecanism: UI claude.ai/code sau Desktop; tab Routines; thread-uri locale prin Remote Control. \| Disponibil pe plan: rollout neconfirmat. \| Controlabil programatic: nu. \| Reutilizabil din Hub: nu. \| Interacțiune: da. \| Securitate: al doilea plan de control al lucrului; cod în cloud.
- **Suprafață nativă:** claude.ai/code Projects.
- **Cerințe locale:** Nu se aplică.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință; conflict cu Hub ca plan de control canonic.
- **Suprafață de execuție:** anthropic.claude_code_web
- **Echivalent la celălalt ecosistem:** ChatGPT Space / echipe de dots.
- **Ce face unic / mai bine:** Coordonare persistentă nativă.
- **Securitate:** Dublă proprietate a task-urilor.
- **Cale de implementare:** REFERENCE.
- **Test necesar:** Niciunul.
- **Status:** ROLLOUT_PENDING
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Doar observare dacă proprietarul îl folosește.
- **Surse citite:** https://code.claude.com/docs/en/claude-projects
- **Verificare adversarială:** CONFIRMED — claude-projects: beta publică pe Pro/Max, rollout gradual cu waitlist, indisponibil pe Team/Enterprise, thread-uri cloud sau locale prin Remote Control.

### /goal (lucru până la îndeplinirea unei condiții) (`an-cc-goal`)

- **Sursă oficială:** https://code.claude.com/docs/en/goal
- **Documentație tehnică:** https://code.claude.com/docs/en/goal
- **Ce face:** Setează o condiție de finalizare; după fiecare turn un model mic evaluează dacă este îndeplinită, iar Claude continuă până la îndeplinire, imposibilitate sau o eroare de remediat.
- **Plan necesar:** Toate planurile.
- **Platformă:** Local, -p, Desktop, Remote Control.
- **Rollout:** GA
- **Eligibilitate cont:** Max eligibil; /goal există din v2.1.139 (interactiv, -p și Remote Control), deci și în CLI-ul local 2.1.175; check-in-urile la inactivitate cer v2.1.234+.
- **Autentificare:** claude.ai.
- **Allowance:** Multe turn-uri; evaluatorul (Haiku) are cost mic.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: `claude -p "/goal <condiție>"` rulează bucla într-o invocare; evaluare prin hook Stop pe bază de prompt; indisponibil cu disableAllHooks sau allowManagedHooksOnly; CLAUDE_CODE_GOAL_CHECKIN_MINUTES. \| Disponibil pe plan: da. \| Controlabil programatic: da. \| Reutilizabil din Hub: posibil pentru sarcini cu verificare clară, dar un singur grant ar acoperi multe turn-uri. \| Interacțiune: nu. \| Securitate: consum pe mai multe turn-uri fără aprobare per turn.
- **Suprafață nativă:** /goal.
- **Cerințe locale:** Niciuna.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Referință; criteriile de finalizare rămân în Hub.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Codex goals (feature activ local).
- **Ce face unic / mai bine:** Evaluator independent de modelul care lucrează.
- **Securitate:** Bucle lungi.
- **Cale de implementare:** REFERENCE; eventual WRAP cu --max-turns și timeout Hub.
- **Test necesar:** Niciunul acum.
- **Status:** AVAILABLE
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Regula unui singur proprietar: Hub decide finalizarea task-ului.
- **Surse citite:** https://code.claude.com/docs/en/goal · https://code.claude.com/docs/en/costs
- **Verificare adversarială:** CORRECTED (corectat: accountEligibility (CHANGELOG 2.1.139 ; https://code.claude.com/docs/en/goal), status (CHANGELOG 2.1.139)) — goal confirmă evaluatorul (model mic, Haiku implicit, printr-un Stop hook bazat pe prompt), rularea completă într-o invocare -p, indisponibilitatea cu disableAllHooks/allowManagedHooksOnly și CLAUDE_CODE_GOAL_CHECKIN_MINUTES.

### Projects în Claude Code (conversație coordonatoare cu fire paralele în cloud) (`an-claude-code-projects-cloud`)

- **Sursă oficială:** https://code.claude.com/docs/en/claude-projects
- **Documentație tehnică:** https://code.claude.com/docs/en/claude-projects
- **Ce face:** O conversație de lungă durată în care Claude este coordonator: transformă mesajele în fire (de obicei sesiuni cloud Claude Code) care rulează în paralel, cu instrucțiuni de proiect (până la 16.000 de caractere), memorie de proiect (index MEMORY.md), bibliotecă de fișiere, panou Overview (Ready for review, Waiting on you, Working, Landing, Idle, Resolved), PR-uri urmărite cu auto-fix și rutine; un fir poate rula pe computerul propriu prin Remote Control (Work locally).
- **Plan necesar:** Beta publică pe Pro și Max; indisponibil pe Team/Enterprise.
- **Platformă:** claude.ai/code, fila Code din Claude Desktop, aplicația mobilă iOS/Android
- **Rollout:** Lansare treptată: întâi conturile care au folosit sesiuni cloud și nu au proiecte existente în chat sau Cowork; există listă de așteptare.
- **Eligibilitate cont:** Planul este eligibil; nu s-a verificat dacă Projects apare în bara laterală claude.ai/code pentru acest cont.
- **Autentificare:** Cont claude.ai; pentru cod: GitHub conectat și Claude GitHub App instalată pe repo.
- **Allowance:** Aceleași limite ca celelalte sesiuni Claude Code, consumate mai repede; plafon de 200 de fire noi pe zi; implicit firele rulează Opus cu efort ridicat.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Un fir blocat de limită reîncearcă singur și consumă fereastra următoare; depășirea limitelor doar cu usage credits; cererile către modele/contexte neincluse cer credite.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Nicio interfață programatică documentată pentru crearea proiectelor sau trimiterea de sarcini; singura punte locală este claude remote-control (Claude Code ≥ 2.1.280) sau setarea Desktop „Use this computer from your phone and claude.ai” pentru firele locale.
- **Suprafață nativă:** claude.ai/code/projects/browse, Code tab în Desktop, aplicația mobilă; Project settings (General, Memory, Environment, Usage).
- **Cerințe locale:** Repo pe github.com cu Claude GitHub App; pentru fire locale Claude Code ≥ 2.1.280 (local: 2.1.175) și computer treaz.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Model de referință pentru coordonarea misiunilor Hub; folosirea lui ca orchestrator ar crea un al doilea plan de control în afara aprobărilor și auditului Hub.
- **Suprafață de execuție:** anthropic.claude_code_projects
- **Echivalent la celălalt ecosistem:** Codex în cloud și noua vizualizare /agents din Codex CLI (recap DevDay 2026).
- **Ce face unic / mai bine:** Coordonator persistent, memorie comună între fire, urmărirea PR-urilor, control de pe mobil.
- **Securitate:** Firele cloud cer cod publicat pe GitHub; firele rulează în auto mode; acțiunile apar ca identitatea GitHub a proprietarului; firele locale rulează auto mode în folderul permis.
- **Cale de implementare:** Doar referință. Dacă proprietarul îl folosește manual, Hub-ul poate pregăti instrucțiunile de proiect și poate înregistra PR-urile rezultate ca evenimente externe.
- **Test necesar:** Verificare vizuală a prezenței Projects în claude.ai/code (fără inferență).
- **Status:** ROLLOUT_PENDING
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Primul proiect poate porni automat un tur Claude care consumă din plan; un proiect pus pe Pause sau arhivat nu consumă.
- **Surse citite:** https://code.claude.com/docs/en/claude-projects · https://support.claude.com/en/articles/9517075-what-are-projects · https://code.claude.com/docs/en/mobile · https://code.claude.com/docs/en/feature-availability
- **Verificare adversarială:** CONFIRMED — Verificat în code.claude.com/docs/en/claude-projects: beta publică Pro/Max, lansare treptată (conturi cu sesiuni cloud și fără proiecte în chat/Cowork), indisponibil pe Team/Enterprise, listă de așteptare; instrucțiuni max 16.000 caractere; MEMORY.md; stări Overview; 200 de fire noi/zi; Opus cu efort ridicat implicit; reîncercare automată la limită; credite doar dacă sunt activate; Claude GitHub App; Remote Control cu Claude Code ≥ v2.1.280; nu în CLI-ul terminal. Mică omisiune: Project settings are și secțiunea Plugins.

### Claude Cowork (taskuri agentice pentru munca de birou) (`an-cowork`)

- **Sursă oficială:** https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork
- **Documentație tehnică:** https://claude.com/docs/cowork/overview
- **Ce face:** Agent pentru taskuri multi-pas (documente, organizare de fișiere, cercetare, prezentări) construit pe arhitectura Claude Code: planifică, împarte în sub-taskuri, rulează cod și comenzi într-un mediu izolat pe serverele Anthropic, lucrează cu fișiere locale prin Desktop, cu browserul integrat sau Claude in Chrome, conectori, pluginuri și skill-uri; moduri Manually approve, Automatically approve, Skip all approvals.
- **Plan necesar:** Planuri plătite: Pro, Max, Team și Enterprise pe desktop; pe web și mobil în beta pentru Pro, Max, Team și pentru Enterprise doar dacă owner-ul îl activează; nu Free.
- **Platformă:** Claude Desktop macOS/Windows (ultima versiune), web și mobil (beta), panoul lateral Chrome (Max/Team; Pro în rollout)
- **Rollout:** GA pe desktop (macOS/Windows) din 2026-04-09; web/mobil în beta din 2026-07-07 (început cu Max); execuția sesiunilor în cloud este în beta; de la 2026-10-06 taskurile Cowork noi pe Pro/Max rulează în cloud și dispare opțiunea Only on your computer.
- **Eligibilitate cont:** Inclus în Max; Desktop 2.9939.4 instalat; rularea locală pe Windows 11 Home nu este confirmată de o sursă oficială.
- **Autentificare:** Sesiune claude.ai.
- **Allowance:** Limitele planului; taskurile lungi și modul auto-approve consumă mai mult.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar prin usage credits activate; modelele Fable pe Max peste 50% din limita săptămânală cer credite sau alt model.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Niciun API sau CLI documentat pentru pornirea taskurilor Cowork; monitorizarea prin OpenTelemetry este destinată organizațiilor.
- **Suprafață nativă:** Fila Cowork / experiența unificată în Desktop, claude.ai, mobil și panoul Chrome.
- **Cerințe locale:** Desktop deschis pentru fișiere locale, conectori locali, browser și computer use.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Instrumentul nativ al proprietarului pentru munca non-cod; Hub-ul trimite briefingul și primește livrabilele, fără a-l folosi ca orchestrator.
- **Suprafață de execuție:** anthropic.claude_cowork
- **Echivalent la celălalt ecosistem:** ChatGPT Work și dots (dots: Pro, Business Premium, Enterprise conform recap).
- **Ce face unic / mai bine:** Acces direct la foldere locale, sub-agenți paraleli, livrabile Office, pluginuri și skill-uri ale contului.
- **Securitate:** Modul Skip all approvals nu verifică nimic; permisiunile de egress nu acoperă web fetch/search și MCP; prompt injection; mediul cloud nu vede rețeaua locală; ștergerea fișierelor cere confirmare explicită.
- **Cale de implementare:** ASSISTED: Hub-ul generează briefing și un folder de export fără secrete; proprietarul pornește taskul; rezultatul intră în Hub cu hash și proveniență.
- **Test necesar:** Nu (utilizare manuală).
- **Status:** ASSISTED_ONLY
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Surse neoficiale indică necesitatea Hyper-V complet pentru mediul local Cowork pe Windows; nu au fost folosite ca dovadă. Taskurile șterse dispar din backend în 30 de zile.
- **Surse citite:** https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork · https://claude.com/docs/cowork/overview · https://support.claude.com/en/articles/13364135-use-claude-cowork-safely · https://support.claude.com/en/articles/15520349 · https://support.claude.com/en/articles/12138966-release-notes · https://claude.com/docs/cowork/changelog
- **Verificare adversarială:** CORRECTED (corectat: planRequired (https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork ; https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork), rollout (https://support.claude.com/en/articles/12138966-release-notes ; https://support.claude.com/en/articles/15520349)) — Restul confirmat: arhitectura Claude Code, sub-agenți, cele trei moduri de aprobare (Skip all approvals nu verifică nimic), egress care nu acoperă web fetch/search, MCP și Chrome, ștergerea fișierelor cere confirmare, fără API/CLI pentru pornirea taskurilor, taskuri șterse eliminate din backend în 30 de zile. Nicio sursă oficială citită nu menționează Hyper-V.

### Experiența Claude unificată (chat și Cowork în aceeași conversație) (`an-unified-claude-experience`)

- **Sursă oficială:** https://support.claude.com/en/articles/16761823
- **Documentație tehnică:** https://support.claude.com/en/articles/16761823
- **Ce face:** Chat și Cowork devin o singură interfață: fără alegerea modului, Claude execută taskuri lungi (web, cod, fișiere), continuă în cloud după închiderea aplicației, programează taskuri, folosește proiecte, conectori și skill-uri sincronizate între web, Desktop și mobil.
- **Plan necesar:** Pro și Max întâi; alte planuri ulterior (Enterprise primește notificare cu 30 de zile înainte).
- **Platformă:** claude.ai web, Desktop, mobil
- **Rollout:** Treptat din 2026-09-16; nu necesită activare manuală.
- **Eligibilitate cont:** Nu se știe dacă a ajuns pe contul Max (UI-ul fără opțiuni separate Chat/Cowork ar confirma).
- **Autentificare:** Sesiune claude.ai.
- **Allowance:** Toate activitățile intră în limitele planului; taskurile agentice consumă mai mult decât întrebările scurte.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar prin usage credits activate.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Fără API.
- **Suprafață nativă:** Caseta de mesaj unică în toate aplicațiile.
- **Cerințe locale:** Desktop deschis doar pentru taskurile locale.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Context pentru ghidurile proprietarului; Hub-ul nu depinde de mod.
- **Suprafață de execuție:** anthropic.claude_chat
- **Echivalent la celălalt ecosistem:** ChatGPT Work alături de ChatGPT Chat (neverificat).
- **Ce face unic / mai bine:** Un singur punct de intrare pentru întrebări și taskuri.
- **Securitate:** Taskurile pot continua nesupravegheate în cloud; incognito folosește experiența anterioară.
- **Cale de implementare:** Doar documentare în RUNBOOK.
- **Test necesar:** Verificare vizuală de către proprietar.
- **Status:** ROLLOUT_PENDING
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Limitări: fără integrare GitHub, fără ramificarea conversațiilor, Dispatch indisponibil utilizatorilor noi.
- **Surse citite:** https://support.claude.com/en/articles/16761823 · https://support.claude.com/en/articles/12138966-release-notes · https://support.claude.com/en/articles/13947068
- **Verificare adversarială:** CONFIRMED — Confirmat textual în 16761823: lansare treptată începând cu Pro și Max pe web, desktop și mobil, Enterprise anunțat cu cel puțin 30 de zile înainte, fără activare manuală; limitări: fără Add from GitHub, fără ramificare, incognito în experiența veche, căutarea exclude taskurile Cowork vechi, Dispatch indisponibil utilizatorilor noi.

### Personalizarea promptului de sistem în -p, inclusiv pentru subagenți (--system-prompt, --append-system-prompt[-file], --append-subagent-system-prompt[-file], --system-prompt-snapshot) (`an-gap-cc-system-prompt-flags`)

- **Sursă oficială:** https://code.claude.com/docs/en/cli-reference
- **Documentație tehnică:** https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts
- **Ce face:** --system-prompt(-file) înlocuiește tot promptul implicit (se pierd ghidajul de unelte și instrucțiunile de siguranță); --append-system-prompt(-file) adaugă text; --append-subagent-system-prompt (≥2.1.205) și -file (≥2.1.261) adaugă text la toți subagenții, inclusiv cei imbricați, cu excepția celor fork, doar în -p; --system-prompt-snapshot (≥2.1.257): implicit promptul este înregistrat la prima cerere și refolosit la --resume/--continue până la compactare, deci un text nou se aplică abia după compactare sau într-o conversație nouă (off îl reconstruiește la fiecare cerere); --exclude-dynamic-system-prompt-sections mută contextul per utilizator în primul mesaj; marcajul __SYSTEM_PROMPT_DYNAMIC_BOUNDARY__ (≥2.1.275) separă partea cache-uibilă.
- **Plan necesar:** Oricare
- **Platformă:** Claude Code CLI / Agent SDK
- **Rollout:** GA; versiunile minime sunt cele de mai sus
- **Eligibilitate cont:** Aplicabil
- **Autentificare:** OAuth de abonament, neafectat
- **Allowance:** Tokenii promptului adăugat intră în alocarea planului.
- **Utilizare partajată:** Alocarea comună Max
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** claude -p --append-system-prompt-file <politica Hub> [--append-subagent-system-prompt-file <politica pentru subagenți>] [--system-prompt-snapshot off la reluare cu politică schimbată]. Per proces. Preferabil append, nu replace.
- **Suprafață nativă:** Output styles, CLAUDE.md
- **Cerințe locale:** 2.1.175 are --system-prompt, --append-system-prompt[-file] și --exclude-dynamic-system-prompt-sections; lipsesc variantele pentru subagenți și --system-prompt-snapshot.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Injectarea politicii Hub (reguli de aprobare, limite de lucru, format de raport) în sesiune și în subagenți.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Codex: developer instructions / base instructions în thread/start și config de profil.
- **Ce face unic / mai bine:** Politica ajunge și în subagenți fără a edita fișiere din proiect.
- **Securitate:** Promptul de sistem nu înlocuiește aprobările Hub: vendor permission dialogs și prompturile nu sunt garanții de securitate. Înlocuirea totală elimină instrucțiunile implicite de siguranță.
- **Cale de implementare:** Fișier de politică versionat în Hub, transmis cu --append-system-prompt-file; după upgrade, și --append-subagent-system-prompt-file.
- **Test necesar:** Fără model: argv. LIVE_VALIDATION: confirmarea că un subagent respectă regula adăugată.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Niciun record nu acoperea personalizarea promptului de sistem.
- **Surse citite:** https://code.claude.com/docs/en/cli-reference.md · local: claude --help (2.1.175)
- **Verificare adversarială:** CONFIRMED — cli-reference confirmă toate flag-urile și versiunile: --append-subagent-system-prompt (≥2.1.205, doar -p, exclude subagenții fork), varianta -file (≥2.1.261, nu se combină cu varianta text), --system-prompt-snapshot (≥2.1.257), __SYSTEM_PROMPT_DYNAMIC_BOUNDARY__ (≥2.1.275), --exclude-dynamic-system-prompt-sections (ignorat cu --system-prompt). Precizări: marcajul de separare se aplică textului de înlocuire (--system-prompt/-file), nu celui adăugat; înainte de 2.1.265, orice flag de prompt oprea înregistrarea, cu excepția lui --system-prompt-snapshot on; pe 2.1.175 comportamentul la reluare nu este documentat.

### /batch (skill inclus): orchestrare de schimbări mari în 5–30 de unități cu subagenți de fundal în worktree-uri izolate (`an-gap-cc-batch-skill`)

- **Sursă oficială:** https://code.claude.com/docs/en/commands
- **Documentație tehnică:** https://code.claude.com/docs/en/worktrees
- **Ce face:** Cercetează codul, descompune schimbarea în 5–30 de unități independente și prezintă un plan; după aprobare pornește câte un subagent de fundal per unitate, într-un worktree izolat. Fiecare subagent implementează, rulează testele și își publică schimbarea (deschide un pull request sau, dacă nu poate, raportează ce a publicat). Necesită un depozit git sau un hook WorktreeCreate (în afara git doar de la 2.1.281).
- **Plan necesar:** Oricare plan cu Claude Code
- **Platformă:** Claude Code CLI, Desktop Code tab
- **Rollout:** GA (skill inclus)
- **Eligibilitate cont:** Disponibil pe Max (prezența în 2.1.175 neverificată)
- **Autentificare:** OAuth de abonament
- **Allowance:** Consum mare: 5–30 de subagenți în paralel din alocarea comună.
- **Utilizare partajată:** Alocarea comună Max
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Poate epuiza rapid fereastra de 5 ore și limita săptămânală.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Invocabil ca prompt „/batch <instrucțiune>” și în -p. Blocare per proces: --settings '{"skillOverrides":{"batch":"off"}}', CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 sau --disable-slash-commands; regulă deny Skill(batch).
- **Suprafață nativă:** /batch în CLI sau Desktop
- **Cerințe locale:** Git; gh sau alt mecanism de publicare
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Orchestrator nativ concurent cu ciclul de viață Hub; exclus din rulările Hub.
- **Suprafață de execuție:** anthropic.claude_code_interactive
- **Echivalent la celălalt ecosistem:** Codex subagenți/multi_agent (oa-codex-subagents) și worktree-uri Codex.
- **Ce face unic / mai bine:** Descompunere și paralelizare automată cu izolare pe worktree.
- **Securitate:** Publică schimbări (push/PR) fără aprobarea Hub; încalcă regula unui singur proprietar al ciclului de viață și regula „fără push fără aprobare explicită”.
- **Cale de implementare:** skillOverrides batch=off în --settings-ul generat; proprietarul îl poate folosi doar interactiv, în afara Hub-ului.
- **Test necesar:** Fără model: argv. LIVE_VALIDATION: /batch nu apare în lista de skills din init.
- **Status:** DOCUMENTED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Hub-ul poate reimplementa descompunerea în propriile misiuni/taskuri cu aprobare per unitate.
- **Surse citite:** https://code.claude.com/docs/en/commands.md · https://code.claude.com/docs/en/skills.md · https://code.claude.com/docs/en/agents.md · https://code.claude.com/docs/en/worktrees.md
- **Verificare adversarială:** CONFIRMED — commands.md și worktrees.md confirmă: 5–30 de unități, plan prezentat înainte de execuție, un subagent de fundal per unitate în worktree izolat, publicarea schimbării (PR sau raport dacă nu poate deschide PR), cerința git sau hook WorktreeCreate (în afara git ≥2.1.281). Blocarea prin skillOverrides batch=off, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS, --disable-slash-commands și Skill(batch) este documentată. Nedocumentat: cum se comportă aprobarea planului când /batch este invocat în -p.

## identity

### Precedența autentificării în Claude Code (abonament vs chei API) (`an-auth-precedence`)

- **Sursă oficială:** https://code.claude.com/docs/en/authentication
- **Documentație tehnică:** https://code.claude.com/docs/en/authentication
- **Ce face:** Ordine: 1) furnizor cloud (CLAUDE_CODE_USE_BEDROCK, VERTEX, FOUNDRY); 2) ANTHROPIC_AUTH_TOKEN; 3) ANTHROPIC_API_KEY (în -p folosit întotdeauna dacă există); 4) apiKeyHelper; 5) CLAUDE_CODE_OAUTH_TOKEN; 6) profiluri Anthropic și federație (ANTHROPIC_PROFILE, variabile WIF, profil activ oidc_federation); 7) OAuth din /login, implicit pentru Pro/Max. O sesiune de Claude apps gateway le depășește pe toate. Sesiunile cloud folosesc mereu abonamentul; Claude Desktop nu citește aceste variabile.
- **Plan necesar:** Orice
- **Platformă:** Claude Code CLI și suprafețele care îl încapsulează (VS Code, Agent SDK, GitHub Actions)
- **Rollout:** GA
- **Eligibilitate cont:** Verificat: authMethod claude.ai, apiProvider firstParty; adaptorul V2 rulează cu mediu fără ANTHROPIC_*.
- **Autentificare:** OAuth claude.ai (credențiale gestionate de /login; conținutul nu se citește)
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Orice cheie API sau helper apărut în mediu ori în setări mută în tăcere facturarea pe API în -p.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Gardă Hub: listă albă de variabile de mediu; claude auth status --json cu authMethod claude.ai și apiProvider firstParty. system/init.apiKeySource = none este necesar, dar nu suficient: none apare și pentru bearer token, cloud provider sau gateway. Se verifică absența apiKeyHelper și a cheilor ANTHROPIC_*/CLAUDE_CODE_USE_* în blocul env din setările user, project și local, fără citirea valorilor.
- **Suprafață nativă:** /status (rândurile Login method, Profile)
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Garda principală de facturare pentru ruta Claude.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** codex login status → Logged in using ChatGPT; app-server account/read refuză conturile API key
- **Ce face unic / mai bine:** Precedență documentată complet
- **Securitate:** Un .claude/settings.json dintr-un repository poate defini apiKeyHelper sau un bloc env cu ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL ori CLAUDE_CODE_USE_*. În -p, acestea se aplică fără dialog de încredere, iar lista albă a mediului de proces nu le acoperă.
- **Cale de implementare:** Mediu de proces construit de la zero, fără CLAUDE_CODE_USE_*, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, ANTHROPIC_PROFILE, ANTHROPIC_FEDERATION_RULE_ID, ANTHROPIC_ORGANIZATION_ID, CLAUDE_CODE_OAUTH_TOKEN și CLAUDE_CODE_SIMPLE, cu CLAUDE_CONFIG_DIR controlat. În plus, --setting-sources user sau --settings cu aceste chei setate la șir gol în env (valoarea goală le anulează pentru selecția furnizorului). Motiv: în -p, blocul env și apiKeyHelper din setările proiectului se aplică la pornire fără dialog de încredere. Abort dacă apiKeySource ≠ none sau authMethod ≠ claude.ai.
- **Test necesar:** Test simulat de stream cu apiKeySource diferit de none; test de filtrare a mediului.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Cu cheie API și abonament simultan, /status marchează credențiala nefolosită.
- **Surse citite:** https://code.claude.com/docs/en/authentication · https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan · https://code.claude.com/docs/en/agent-sdk/typescript · https://code.claude.com/docs/en/settings-reference · local: claude auth status --json
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://code.claude.com/docs/en/agent-sdk/typescript), implementationPath (https://code.claude.com/docs/en/settings-reference; https://code.claude.com/docs/en/permissions; https://code.claude.com/docs/en/settings), securityConcerns (https://code.claude.com/docs/en/permissions)) — Confirmate în pagina authentication: ordinea în 7 trepte; sesiunea de gateway se află în afara listei și le depășește pe toate; în -p, ANTHROPIC_API_KEY este folosită întotdeauna dacă există; sesiunile cloud și Claude Desktop nu citesc aceste variabile. Corecțiile vin din ApiKeySource (Agent SDK), din regulile blocului env (settings-reference) și din tabelul „What runs before you trust a folder” (permissions).

### Modul --bare (doar cheie API) (`an-auth-bare-mode`)

- **Sursă oficială:** https://code.claude.com/docs/en/headless
- **Documentație tehnică:** https://code.claude.com/docs/en/cli-reference
- **Ce face:** --bare sare peste hooks, skills, pluginuri, MCP, auto memory și CLAUDE.md pentru pornire rapidă și reproductibilă; nu citește niciodată OAuth sau keychain, deci cere ANTHROPIC_API_KEY sau apiKeyHelper. Documentația afirmă că va deveni implicit pentru -p într-o versiune viitoare.
- **Plan necesar:** Cheie API din Claude Console
- **Platformă:** Claude Code CLI
- **Rollout:** GA
- **Eligibilitate cont:** Incompatibil cu autentificarea prin abonament.
- **Autentificare:** ANTHROPIC_API_KEY sau apiKeyHelper
- **Allowance:** Facturare API per token
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Ar muta tot consumul pe facturare API.
- **Risc de facturare API:** high
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** claude --bare -p …; nu citește CLAUDE_CODE_OAUTH_TOKEN.
- **Suprafață nativă:** Terminal
- **Cerințe locale:** Cheie API
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Niciunul; interzis în adaptor.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** codex exec cu cheie API (refuzat de Hub)
- **Ce face unic / mai bine:** Izolare de configurația locală
- **Securitate:** Fără --bare, -p rulează hooks din .claude/settings.json și serverele din .mcp.json ale proiectului fără dialog de încredere.
- **Cale de implementare:** Se păstrează interdicția --bare și se elimină CLAUDE_CODE_SIMPLE din mediul copil (CLAUDE_CODE_SIMPLE=1 activează același mod minimal și oprește citirea OAuth). Se monitorizează changelog-ul pentru trecerea -p la bare implicit și pentru un eventual opt-out. Se păstrează --strict-mcp-config cu configurație MCP goală și se limitează sursele de setări.
- **Test necesar:** Test unitar că adaptorul refuză --bare.
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Anunțul privind trecerea la --bare implicit în -p este un risc de compatibilitate pentru întreaga rută Claude a Hub-ului.
- **Surse citite:** https://code.claude.com/docs/en/headless · https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/authentication · local: claude --help (2.1.175)
- **Verificare adversarială:** CORRECTED (corectat: implementationPath (https://code.claude.com/docs/en/env-vars; https://code.claude.com/docs/en/cli-reference)) — Pagina headless confirmă: --bare nu citește niciodată OAuth sau keychain și va deveni implicit pentru -p într-o versiune viitoare. Tot acolo: fără --bare, -p rulează hooks și serverele din .mcp.json ale proiectului fără dialog de încredere. Help-ul local 2.1.175 confirmă textul despre bare mode.

### claude setup-token (token OAuth de un an) (`an-auth-setup-token`)

- **Sursă oficială:** https://code.claude.com/docs/en/authentication
- **Documentație tehnică:** https://code.claude.com/docs/en/cli-reference
- **Ce face:** Generează prin fluxul oficial de autorizare un token OAuth valabil un an, afișat în terminal și nesalvat, folosit prin CLAUDE_CODE_OAUTH_TOKEN pentru CI și scripturi; folosește abonamentul, dar poate face doar cereri de model (fără Remote Control și fără conectori claude.ai).
- **Plan necesar:** Pro, Max, Team sau Enterprise
- **Platformă:** Claude Code CLI
- **Rollout:** GA
- **Eligibilitate cont:** Eligibil (Max), negenerat.
- **Autentificare:** Token OAuth de abonament
- **Allowance:** Din limitele planului
- **Utilizare partajată:** Pool comun
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul direct; riscul principal este scurgerea unui secret cu durată lungă.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** claude setup-token → variabila CLAUDE_CODE_OAUTH_TOKEN (poziția 5 în precedență); nu este citit în --bare.
- **Suprafață nativă:** Terminal și browser pentru aprobare
- **Cerințe locale:** Stocare sigură a secretului
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul: autentificarea /login existentă a binarului oficial este suficientă.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Nespecificat în sursele OpenAI citite
- **Ce face unic / mai bine:** Autentificare fără browser pentru medii izolate
- **Securitate:** Hub-ul nu trebuie să colecteze sau să stocheze credențiale claude.ai; un token de un an trebuie tratat ca secret.
- **Cale de implementare:** Nu se implementează; Hub-ul elimină CLAUDE_CODE_OAUTH_TOKEN din mediul copil.
- **Test necesar:** Niciunul
- **Status:** DOCUMENTED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** setup-token aplică doar forceLoginMethod, nu și forceLoginOrgUUID.
- **Surse citite:** https://code.claude.com/docs/en/authentication · https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/legal-and-compliance
- **Verificare adversarială:** CONFIRMED — Pagina authentication confirmă: token OAuth valabil un an, afișat în terminal și nesalvat; cere Pro, Max, Team sau Enterprise; permite doar cereri de model (fără Remote Control și fără conectori claude.ai); este ignorat în bare mode; ocupă poziția 5 în precedență. setup-token aplică doar forceLoginMethod, nu și forceLoginOrgUUID.

### claude auth status (JSON) (`an-auth-status-json`)

- **Sursă oficială:** https://code.claude.com/docs/en/cli-reference
- **Documentație tehnică:** https://code.claude.com/docs/en/authentication
- **Ce face:** Afișează starea autentificării ca JSON (loggedIn, authMethod, apiProvider, subscriptionType; configDirectory din 2.1.268); --text pentru format uman; cod de ieșire 0 dacă este autentificat, 1 altfel.
- **Plan necesar:** Orice
- **Platformă:** Claude Code CLI
- **Rollout:** GA
- **Eligibilitate cont:** Verificat: loggedIn true, authMethod claude.ai, apiProvider firstParty, subscriptionType max.
- **Autentificare:** Citește starea credențialei fără a o expune
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** claude auth status (JSON implicit); fără inferență; câmpurile de identitate nu se înregistrează.
- **Suprafață nativă:** /status
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Verificare de cont înaintea fiecărui lot și la pornirea Hub-ului.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** codex login status; app-server account/read
- **Ce face unic / mai bine:** Fără cost și fără model
- **Securitate:** Ieșirea poate conține e-mail sau organizație; se păstrează doar câmpurile necesare.
- **Cale de implementare:** Deja implementat în V2; extindere cu configDirectory după actualizarea CLI.
- **Test necesar:** Deja trecut (PASS local).
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Nu expune nivelul 5x/20x și nici starea usage credits.
- **Surse citite:** https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/authentication · local: claude auth status --json (sources-anthropic-local.md)
- **Verificare adversarială:** CONFIRMED — cli-reference confirmă: ieșire JSON implicit, --text pentru format uman, cod 0 dacă este autentificat și 1 altfel, câmpul configDirectory din 2.1.268 (confirmat și în changelog). Nivelul 5x/20x și starea creditelor nu sunt expuse.

### Politica de utilizare a OAuth-ului de abonament (Consumer Terms, Agent SDK) (`an-subscription-oauth-policy`)

- **Sursă oficială:** https://code.claude.com/docs/en/legal-and-compliance
- **Documentație tehnică:** https://code.claude.com/docs/en/agent-sdk/overview
- **Ce face:** OAuth-ul este destinat exclusiv cumpărătorilor de abonamente, pentru utilizarea obișnuită a Claude Code și a aplicațiilor native; dezvoltatorii de produse (inclusiv pe Agent SDK) trebuie să folosească chei API; terții nu pot oferi login claude.ai și nu pot colecta, stoca sau intermedia credențiale claude.ai. Nu este interzis ca utilizatorul final să se autentifice în binarul Claude Code nemodificat cu propriul abonament. Limitele Pro/Max presupun utilizare individuală obișnuită a Claude Code și Agent SDK.
- **Plan necesar:** Free, Pro, Max, Team, Enterprise
- **Platformă:** Claude Code, Agent SDK
- **Rollout:** În vigoare
- **Eligibilitate cont:** Hub-ul folosește binarul oficial nemodificat, cu login-ul proprietarului, pentru uz propriu.
- **Autentificare:** OAuth prin fluxul Anthropic
- **Allowance:** Utilizare individuală obișnuită (fără prag cantitativ publicat)
- **Utilizare partajată:** Doar proprietarul
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Ruta permisă: claude -p din binarul publicat, fără modificări și fără dezactivarea metodelor de autentificare încorporate.
- **Suprafață nativă:** n/a
- **Cerințe locale:** Binar oficial nemodificat
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Constrângere de conformitate pentru designul adaptorului Claude.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Sign in with ChatGPT (client_id propriu, fără împrumut de identitate)
- **Ce face unic / mai bine:** n/a
- **Securitate:** Hub-ul nu trebuie să ofere acces Claude altor persoane prin abonamentul proprietarului și nu trebuie să manipuleze fișierele de credențiale.
- **Cale de implementare:** Fără Agent SDK cu OAuth în Hub; fără partajare multi-utilizator; ritm de automatizare moderat, cu aprobări.
- **Test necesar:** Niciunul
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Nu există un prag cantitativ pentru „ordinary, individual usage”; interpretarea rămâne o decizie a proprietarului.
- **Surse citite:** https://code.claude.com/docs/en/legal-and-compliance · https://code.claude.com/docs/en/agent-sdk/overview
- **Verificare adversarială:** CONFIRMED — legal-and-compliance confirmă: OAuth este destinat exclusiv cumpărătorilor de abonamente, pentru uzul obișnuit al Claude Code și al aplicațiilor native. Dezvoltatorii, inclusiv cei care folosesc Agent SDK, trebuie să folosească chei API. Este interzis să oferi login claude.ai sau să colectezi, stochezi ori intermediezi credențiale. Utilizatorul se poate autentifica în binarul nemodificat cu propriul abonament. Limitele Pro/Max presupun uz individual obișnuit, iar Anthropic poate aplica măsuri fără notificare.

### `--bare` (mod minimal) (`an-cc-bare-mode`)

- **Sursă oficială:** https://code.claude.com/docs/en/headless
- **Documentație tehnică:** https://code.claude.com/docs/en/cli-reference
- **Ce face:** Pornire rapidă fără descoperire automată (hooks, skills, plugins, MCP, memorie, CLAUDE.md); autentificare strict ANTHROPIC_API_KEY sau apiKeyHelper, nu OAuth.
- **Plan necesar:** Cheie API Console (facturare API).
- **Platformă:** Toate.
- **Rollout:** GA; documentația anunță că va deveni implicit pentru -p
- **Eligibilitate cont:** Incompatibil cu abonamentul (OAuth nu este citit).
- **Autentificare:** ANTHROPIC_API_KEY sau apiKeyHelper; nu citește CLAUDE_CODE_OAUTH_TOKEN.
- **Allowance:** Nu folosește cota abonamentului.
- **Utilizare partajată:** Nu.
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Facturare API per token.
- **Risc de facturare API:** high
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: `claude --bare -p ...` (setează CLAUDE_CODE_SIMPLE). \| Disponibil pe plan: nu prin abonament. \| Controlabil programatic: da. \| Reutilizabil din Hub: nu — încalcă INCLUDED_SUBSCRIPTION_ONLY. \| Interacțiune: nu. \| Securitate: forțează credențiale API.
- **Suprafață nativă:** Nu se aplică.
- **Cerințe locale:** Nu se aplică.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Interzis (flag în CLAUDE_FORBIDDEN_FLAGS).
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Rularea Codex cu API key (interzisă similar).
- **Ce face unic / mai bine:** Nu se aplică.
- **Securitate:** Facturare API accidentală.
- **Cale de implementare:** REJECT (deja implementat în V2).
- **Test necesar:** Test existent de flag interzis.
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Risc strategic: dacă --bare devine implicit pentru -p, ruta Hub prin abonament se poate rupe; de verificat notele fiecărei versiuni înainte de update.
- **Surse citite:** https://code.claude.com/docs/en/headless · https://code.claude.com/docs/en/authentication · local: claude --help (--bare)
- **Verificare adversarială:** CONFIRMED — headless și authentication: --bare nu citește OAuth, keychain sau CLAUDE_CODE_OAUTH_TOKEN, cere ANTHROPIC_API_KEY sau apiKeyHelper în --settings și va deveni implicit pentru -p; incompatibil cu INCLUDED_SUBSCRIPTION_ONLY.

### Starea autentificării (`claude auth status --json`) (`an-cc-auth-status`)

- **Sursă oficială:** https://code.claude.com/docs/en/cli-reference
- **Documentație tehnică:** https://code.claude.com/docs/en/authentication
- **Ce face:** Returnează JSON cu loggedIn, authMethod, apiProvider și subscriptionType (plus configDirectory din v2.1.268), cu exit 0 dacă este autentificat.
- **Plan necesar:** Nu se aplică.
- **Platformă:** Windows 11, CLI 2.1.175.
- **Rollout:** GA
- **Eligibilitate cont:** Verificat: claude.ai, firstParty, max.
- **Autentificare:** Citește credențiala activă fără inferență.
- **Allowance:** Fără consum.
- **Utilizare partajată:** Nu se aplică.
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: `claude auth status --json` (sau `--text`); `claude auth login --console` ar trece pe facturare API (interzis); `/status` interactiv arată credențiala folosită. \| Disponibil pe plan: da. \| Controlabil programatic: da, fără inferență. \| Reutilizabil din Hub: da, deja folosit de probe(). \| Interacțiune: nu. \| Securitate: nu se stochează email sau organizație; se rulează cu același env controlat ca run-urile.
- **Suprafață nativă:** /status.
- **Cerințe locale:** Niciuna.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Pre-verificare obligatorie înaintea fiecărui run Claude.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** `codex login status` / account/read.
- **Ce face unic / mai bine:** Raportează tipul abonamentului.
- **Securitate:** Nu dezvăluie dacă usage credits sunt activate.
- **Cale de implementare:** MIRROR_STATE existent.
- **Test necesar:** Deja trecut local (fără inferență).
- **Status:** AVAILABLE
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** high
- **Note:** Nu arată nivelul Max (5x/20x).
- **Surse citite:** https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/authentication · local: sources-anthropic-local.md (claude.ai, firstParty, max) · local: v2/server/providers/claude.mjs (probe)
- **Verificare adversarială:** CONFIRMED — cli-reference: JSON implicit, --text, exit 0/1, configDirectory din v2.1.268; `claude auth login --console` trece pe facturare API.

### `claude setup-token` / CLAUDE_CODE_OAUTH_TOKEN (`an-cc-setup-token`)

- **Sursă oficială:** https://code.claude.com/docs/en/authentication
- **Documentație tehnică:** https://code.claude.com/docs/en/cli-reference
- **Ce face:** Generează prin browser un token OAuth valabil un an, legat de abonament, tipărit în terminal, pentru CI și scripturi; permite doar cereri de model.
- **Plan necesar:** Pro, Max, Team, Enterprise.
- **Platformă:** Toate.
- **Rollout:** GA
- **Eligibilitate cont:** Max eligibil.
- **Autentificare:** Token OAuth în CLAUDE_CODE_OAUTH_TOKEN (rang peste /login).
- **Allowance:** Cota abonamentului.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu, dar tokenul este un secret de lungă durată.
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Mecanism: `claude setup-token` (browser) → token afișat; folosit prin env CLAUDE_CODE_OAUTH_TOKEN; nu stabilește Remote Control, nu încarcă conectori claude.ai, oprește integrarea Chrome; --bare nu îl citește. \| Disponibil pe plan: da. \| Controlabil programatic: generarea cere browser. \| Reutilizabil din Hub: nu — Hub nu citește, nu stochează și nu transmite secrete. \| Interacțiune: da. \| Securitate: secret de un an; interzis de regulile Hub.
- **Suprafață nativă:** Terminal + browser.
- **Cerințe locale:** Nu se aplică.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Neutilizat; Hub folosește login-ul existent.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Token-uri de autentificare Codex pentru CI (neverificate aici).
- **Ce face unic / mai bine:** Autentificare prin abonament fără browser în CI.
- **Securitate:** Scurgerea tokenului; stocare în GitHub/CI.
- **Cale de implementare:** REJECT; Hub detectează și avertizează dacă variabila apare în mediu.
- **Test necesar:** Test simulat: buildChildEnv elimină CLAUDE_CODE_OAUTH_TOKEN dacă politica o cere.
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Blocat de politica de secrete, nu de facturare.
- **Surse citite:** https://code.claude.com/docs/en/authentication · https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/chrome · https://code.claude.com/docs/en/remote-control
- **Verificare adversarială:** CONFIRMED — authentication: token OAuth de un an, cere Pro/Max/Team/Enterprise, doar cereri de model, fără Remote Control și conectori claude.ai, necitit în --bare; chrome: cu acest token integrarea rămâne oprită.

## cloud

### Amazon Bedrock, Google Cloud Agent Platform, Microsoft Foundry, Claude Platform on AWS, Claude apps gateway, LLM gateway (`an-third-party-providers`)

- **Sursă oficială:** https://code.claude.com/docs/en/authentication
- **Documentație tehnică:** https://code.claude.com/docs/en/model-config
- **Ce face:** Rute alternative de inferență pentru Claude Code, facturate de furnizorul cloud sau prin gateway, cu aliasuri de model diferite (ex.: pe Foundry opus = Opus 4.6).
- **Plan necesar:** Cont cloud sau gateway organizațional
- **Platformă:** Claude Code
- **Rollout:** GA
- **Eligibilitate cont:** Nefolosit.
- **Autentificare:** Credențiale cloud, token de gateway
- **Allowance:** Fără alocare de abonament
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Facturare separată per token.
- **Risc de facturare API:** high
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** CLAUDE_CODE_USE_BEDROCK, CLAUDE_CODE_USE_VERTEX, CLAUDE_CODE_USE_FOUNDRY, ANTHROPIC_BASE_URL, sesiune gateway.
- **Suprafață nativă:** Consolele furnizorilor
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul
- **Suprafață de execuție:** anthropic.cloud_providers
- **Echivalent la celălalt ecosistem:** Amazon Bedrock Managed Agents pentru OpenAI
- **Ce face unic / mai bine:** Control de date și facturare enterprise
- **Securitate:** O variabilă CLAUDE_CODE_USE_* rămasă în mediu are prioritate absolută.
- **Cale de implementare:** Eliminarea variabilelor din mediul copil.
- **Test necesar:** Test de filtrare a mediului.
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Fast mode, ultrareview și conectorii claude.ai nu sunt disponibili pe aceste rute.
- **Surse citite:** https://code.claude.com/docs/en/authentication · https://code.claude.com/docs/en/model-config · https://code.claude.com/docs/en/costs
- **Verificare adversarială:** CONFIRMED — model-config: pe Microsoft Foundry, opus = Opus 4.6 și sonnet = Sonnet 4.5, iar modelul implicit este Sonnet 4.5. Fast mode este indisponibil pe Bedrock, Google Cloud Agent Platform, Foundry și Claude Platform on AWS. Ultrareview este indisponibil pe Bedrock, Agent Platform și Foundry.

### Claude Code în cloud (claude.ai/code, `--cloud`, `--teleport`) (`an-cc-cloud-sessions`)

- **Sursă oficială:** https://code.claude.com/docs/en/claude-code-on-the-web
- **Documentație tehnică:** https://code.claude.com/docs/en/cli-reference
- **Ce face:** Sesiuni pe VM-uri Anthropic care clonează repo-ul din GitHub, continuă după închiderea laptopului, pot crea PR și auto-fix; pot fi aduse în terminal cu teleport.
- **Plan necesar:** Pro, Max, Team (Enterprise cu loc premium).
- **Platformă:** Cloud Anthropic; cere GitHub pentru clone/PR.
- **Rollout:** GA
- **Eligibilitate cont:** Max eligibil; conexiunea GitHub neverificată.
- **Autentificare:** claude.ai (API key nu este suficient).
- **Allowance:** Partajează limitele contului; fără taxă separată pentru VM.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Usage credits dacă sunt activate.
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Mecanism: `claude --cloud "task"` (din remote-ul curent; fără remote sau fără GitHub App se încarcă un bundle local <100 MB); `claude -p "mesaj" --cloud <session_id>` pune un mesaj în coadă (`--output-format json` → ok, session_id, url); `claude --teleport [id]`; GitHub prin Claude GitHub App sau /web-setup (trimite tokenul gh în contul Claude). \| Disponibil pe plan: da. \| Controlabil programatic: parțial (creare și mesaje), fără stream local. \| Reutilizabil din Hub: doar asistat — codul pleacă în cloud. \| Interacțiune: aprobare pentru orice upload. \| Securitate: upload de cod, rulare autonomă, push pe ramuri claude/, auto-fix poate posta sub identitatea proprietarului.
- **Suprafață nativă:** claude.ai/code, Desktop (Cloud), aplicația mobilă.
- **Cerințe locale:** GitHub conectat; setări de mediu cloud.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Execuție delegată de proprietar pentru sarcini lungi, înregistrată în Hub.
- **Suprafață de execuție:** anthropic.claude_code_web
- **Echivalent la celălalt ecosistem:** Codex cloud (`codex cloud exec`).
- **Ce face unic / mai bine:** Continuitate fără mașina locală; teleport în terminal.
- **Securitate:** Upload de cod: bundle-ul include întregul istoric git pe toate ramurile și modificările necomise ale fișierelor urmărite, iar excluderea automată a modificărilor la fișiere de tip .env/*.tfvars/chei se face doar pe macOS, Linux și WSL, nu pe Windows nativ; rulare autonomă, push pe ramuri claude/, auto-fix poate posta sub identitatea proprietarului; pe Max/Pro partajarea sesiunii este Public.
- **Cale de implementare:** ASSISTED: Hub pregătește sarcina și salvează URL-ul/ID-ul sesiunii; nu creează sesiuni cloud fără aprobare explicită.
- **Test necesar:** Niciunul fără aprobare.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Pe 2.1.175 unele comportamente (ex. mesaje în coadă) pot diferi de documentație.
- **Surse citite:** https://code.claude.com/docs/en/claude-code-on-the-web · https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/feature-availability · local: scanare stringuri claude.exe (--cloud, --remote, --teleport prezente)
- **Verificare adversarială:** CORRECTED (corectat: securityConcerns (https://code.claude.com/docs/en/claude-code-on-the-web)) — claude-code-on-the-web confirmă planurile, lipsa taxei separate pentru VM, limitele partajate, bundle-ul <100 MB, `claude -p ... --cloud <id>` cu JSON {ok, session_id, url}, --teleport și /web-setup. Corectat securityConcerns pentru Windows nativ.

### Claude Code GitHub Actions (anthropics/claude-code-action@v1) (`an-cc-github-actions`)

- **Sursă oficială:** https://code.claude.com/docs/en/github-actions
- **Documentație tehnică:** https://code.claude.com/docs/en/github-actions
- **Ce face:** Rulează Claude Code în workflow-uri GitHub la mențiuni @claude sau la evenimente/program, cu commit-uri și comentarii în repo.
- **Plan necesar:** API key sau token OAuth de abonament (Pro/Max/Team/Enterprise) generat cu setup-token.
- **Platformă:** Runnere GitHub.
- **Rollout:** GA (v1)
- **Eligibilitate cont:** Max eligibil tehnic.
- **Autentificare:** Secret CLAUDE_CODE_OAUTH_TOKEN sau ANTHROPIC_API_KEY în GitHub.
- **Allowance:** Cu OAuth: cota abonamentului.
- **Utilizare partajată:** Da (OAuth).
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** Minute GitHub Actions (serviciu plătit separat); API key ar însemna facturare API.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: workflow YAML cu claude_code_oauth_token sau anthropic_api_key, prompt, claude_args; /install-github-app automatizează instalarea. \| Disponibil pe plan: da. \| Controlabil programatic: da. \| Reutilizabil din Hub: nu — necesită stocarea unui secret de abonament în GitHub și un mediu de execuție extern. \| Interacțiune: setup. \| Securitate: secret de un an în GitHub; permisiuni largi ale GitHub App; efecte externe.
- **Suprafață nativă:** GitHub.
- **Cerințe locale:** Nu se aplică.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul.
- **Suprafață de execuție:** anthropic.claude_code_github_actions
- **Echivalent la celălalt ecosistem:** Codex în CI (neverificat aici).
- **Ce face unic / mai bine:** Automatizare pe evenimente GitHub.
- **Securitate:** Secrete și acțiuni externe.
- **Cale de implementare:** REJECT.
- **Test necesar:** Niciunul.
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Blocat de regulile de secrete și de servicii noi plătite.
- **Surse citite:** https://code.claude.com/docs/en/github-actions · https://code.claude.com/docs/en/authentication
- **Verificare adversarială:** CONFIRMED — github-actions: autentificare cu API key sau token OAuth din setup-token (abonament Pro/Max/Team/Enterprise), costuri de minute GitHub Actions și tokeni, /install-github-app salvează secretul ca secret de repository.

### Medii self-hosted pentru sesiuni cloud Claude Code (claude self-hosted-runner, --environment) (`an-gap-cc-self-hosted-environments`)

- **Sursă oficială:** https://code.claude.com/docs/en/self-hosted-environments
- **Documentație tehnică:** https://code.claude.com/docs/en/cli-reference
- **Ce face:** Un runner (claude self-hosted-runner, cu setup, doctor și orchestrator) înregistrează o mașină sau un container ca mediu pentru sesiunile cloud Claude Code; controlul și inferența rămân la api.anthropic.com, execuția pe infrastructura proprie. claude -p ... --environment ccpool_<id> [--ref <branch>] creează o sesiune cloud pe acel mediu. Sesiunile consumă utilizarea Claude Code a organizației.
- **Plan necesar:** Team sau Enterprise (public beta, oprit implicit, activat de Owner)
- **Platformă:** Linux/containere pentru runner; CLI pentru dispecerizare
- **Rollout:** Public beta (≥2.1.224)
- **Eligibilitate cont:** Nu este disponibil pe Max.
- **Autentificare:** Organizație claude.ai cu sesiuni cloud
- **Allowance:** Utilizarea Claude Code a organizației
- **Utilizare partajată:** N/A
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** N/A pe Max
- **Risc de facturare API:** unknown
- **Integrare programatică:** NONE
- **Detaliu integrare:** Indisponibil pe plan; --restricted refuză oricum crearea de sesiuni cloud.
- **Suprafață nativă:** claude.ai admin > Cloud environments
- **Cerințe locale:** N/A
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Nerelevant pe planul actual; pentru execuție pe mașina proprie există Remote Control și rulările locale.
- **Suprafață de execuție:** anthropic.claude_code_web
- **Echivalent la celălalt ecosistem:** oa-codex-exec-server și oa-codex-cloud-environments.
- **Ce face unic / mai bine:** Execuție pe infrastructură proprie cu control de rețea.
- **Securitate:** N/A
- **Cale de implementare:** Niciuna
- **Test necesar:** Niciunul
- **Status:** PLAN_RESTRICTED
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** high
- **Note:** claude gateway este deja acoperit de an-third-party-providers.
- **Surse citite:** https://code.claude.com/docs/en/self-hosted-environments.md · https://code.claude.com/docs/en/cli-reference.md · https://code.claude.com/docs/en/errors.md
- **Verificare adversarială:** CONFIRMED — self-hosted-environments.md confirmă: public beta pe Team și Enterprise, oprit implicit, activat de Owner în Cloud environments, cere sesiuni cloud; inferența rămâne pe API-ul Anthropic, fără Bedrock/Vertex/Foundry/gateway; sesiunile consumă utilizarea Claude Code a organizației; claude self-hosted-runner (setup, doctor, orchestrator) și --environment ccpool_<id> [--ref] ≥2.1.224. Pentru Pro/Max documentația trimite la Remote Control.

## other

### Export OpenTelemetry din Claude Code (`an-usage-otel`)

- **Sursă oficială:** https://code.claude.com/docs/en/monitoring-usage
- **Documentație tehnică:** https://code.claude.com/docs/en/monitoring-usage
- **Ce face:** Exportă metrici și evenimente (ex.: claude_code.cost.usage, api_request, api_error, compaction, sesiuni, commit-uri) prin OTLP, Prometheus sau consolă; funcționează pe orice tip de autentificare și este singura opțiune care transmite în timp aproape real tokeni și costuri estimate spre propria infrastructură.
- **Plan necesar:** Orice
- **Platformă:** Claude Code CLI; variabile OTEL_* în mediu sau managed settings
- **Rollout:** GA
- **Eligibilitate cont:** Neconfigurat.
- **Autentificare:** Independent de autentificare
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** CLAUDE_CODE_ENABLE_TELEMETRY=1 (obligatoriu), OTEL_METRICS_EXPORTER=otlp, OTEL_LOGS_EXPORTER=otlp, OTEL_EXPORTER_OTLP_PROTOCOL și OTEL_EXPORTER_OTLP_ENDPOINT spre un colector pe 127.0.0.1, setate în mediul copil sau prin --settings. Ignorarea acestor variabile în setările project/local ale unui repository există abia din 2.1.282, deci pe 2.1.175 un repository le poate activa. Conținutul prompturilor rămâne redactat implicit.
- **Suprafață nativă:** n/a
- **Cerințe locale:** Receptor OTLP local (de construit în Hub sau componentă open-source instalată cu aprobare)
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Telemetrie de consum per misiune și per rol, fără procente de plan.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Nespecificat în sursele OpenAI citite
- **Ce face unic / mai bine:** Date structurate per cerere și per model
- **Securitate:** Capturarea conținutului prompturilor trebuie să rămână oprită; endpointul doar pe loopback.
- **Cale de implementare:** Hub-ul injectează variabilele OTEL_* în mediul copil spre un receptor local minimal.
- **Test necesar:** Receptor local testat cu date simulate; un turn live aprobat.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** medium
- **Note:** Nu raportează procentele ferestrelor de 5 ore sau săptămânale.
- **Surse citite:** https://code.claude.com/docs/en/monitoring-usage · https://code.claude.com/docs/en/costs
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://code.claude.com/docs/en/monitoring-usage; https://code.claude.com/docs/en/settings-reference)) — Documentația costs confirmă că OTel funcționează cu orice tip de autentificare și este singura opțiune cu flux aproape în timp real. Nu raportează procentele ferestrelor de plan.

### Telemetrie OpenTelemetry către colector local (`an-cc-otel`)

- **Sursă oficială:** https://code.claude.com/docs/en/monitoring-usage
- **Documentație tehnică:** https://code.claude.com/docs/en/monitoring-usage
- **Ce face:** Exportă metrici (sesiuni, tokeni, cost estimat, linii de cod, commits, PR, timp activ) și evenimente (user_prompt, api_request, tool_result, tool_decision etc.) către un colector OTLP.
- **Plan necesar:** Toate; independent de autentificare.
- **Platformă:** Toate.
- **Rollout:** GA (traces în beta)
- **Eligibilitate cont:** Aplicabil.
- **Autentificare:** Nu depinde.
- **Allowance:** Fără consum de model.
- **Utilizare partajată:** Nu se aplică.
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: env CLAUDE_CODE_ENABLE_TELEMETRY=1, OTEL_METRICS_EXPORTER/OTEL_LOGS_EXPORTER=otlp, OTEL_EXPORTER_OTLP_ENDPOINT spre 127.0.0.1; conținutul prompturilor este redactat implicit (OTEL_LOG_USER_PROMPTS, OTEL_LOG_TOOL_DETAILS sunt opt-in); traces cu CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1. \| Disponibil pe plan: da. \| Controlabil programatic: da. \| Reutilizabil din Hub: da — receptor OTLP local pentru audit fără parsarea transcrierilor. \| Interacțiune: nu. \| Securitate: doar endpoint loopback; atributele pot include user.email, pe care Hub nu îl stochează.
- **Suprafață nativă:** Nu se aplică.
- **Cerințe locale:** Receptor OTLP HTTP în Hub (de implementat, fără pachete noi fără aprobare).
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Sursă suplimentară de audit și consum.
- **Suprafață de execuție:** hub.local
- **Echivalent la celălalt ecosistem:** Telemetrie Codex (neverificată aici).
- **Ce face unic / mai bine:** Evenimente tool_decision și api_request standardizate.
- **Securitate:** Configurarea greșită a endpoint-ului ar trimite date extern.
- **Cale de implementare:** MIRROR_STATE opțional: env OTEL doar spre 127.0.0.1, validat de Hub.
- **Test necesar:** Test simulat al receptorului; live doar cu grant.
- **Status:** AVAILABLE
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** medium
- **Note:** Setul exact de evenimente pe 2.1.175 poate diferi.
- **Surse citite:** https://code.claude.com/docs/en/monitoring-usage · https://code.claude.com/docs/en/costs
- **Verificare adversarială:** CONFIRMED — monitoring-usage: variabilele de activare, metricile și evenimentele, redactarea implicită a prompturilor și detaliilor de unelte, atributele user.email/organization.id/account uuid, traces beta; variabilele OTEL din .claude/settings.json sunt ignorate.

### Deep links `claude-cli://open` (`an-cc-deep-links`)

- **Sursă oficială:** https://code.claude.com/docs/en/deep-links
- **Documentație tehnică:** https://code.claude.com/docs/en/deep-links
- **Ce face:** URL care deschide un terminal nou cu Claude Code în directorul/repo-ul indicat și promptul pre-completat, fără trimitere automată.
- **Plan necesar:** Nu se aplică.
- **Platformă:** Windows (preferă Windows Terminal, apoi PowerShell, apoi cmd), macOS, Linux.
- **Rollout:** GA
- **Eligibilitate cont:** Handler înregistrat în HKCU.
- **Autentificare:** Sesiunea deschisă folosește login-ul existent.
- **Allowance:** Fără consum până la apăsarea Enter.
- **Utilizare partajată:** Nu se aplică.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** none
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Mecanism: `claude-cli://open?cwd=<cale absolută>&q=<URL-encoded, max 5000>&repo=owner/name`; pe Windows `Start-Process 'claude-cli://open?...'`; avertisment vizibil pentru prompt din link extern; pentru VS Code vscode://anthropic.claude-code/open. \| Disponibil pe plan: da. \| Controlabil programatic: Hub generează linkul; execuția pornește doar când proprietarul apasă Enter. \| Reutilizabil din Hub: da, ideal pentru fluxuri ASSISTED. \| Interacțiune: da (Enter echivalează cu aprobarea). \| Securitate: căile UNC și cu .. sunt respinse; nu se pun date sensibile în URL.
- **Suprafață nativă:** Terminal nou.
- **Cerințe locale:** Handler înregistrat (prezent).
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Buton 'Deschide în Claude Code' în UI-ul Hub pentru task-uri asistate.
- **Suprafață de execuție:** anthropic.claude_code_interactive
- **Echivalent la celălalt ecosistem:** Nu este verificat un echivalent Codex în acest slice.
- **Ce face unic / mai bine:** Aprobare naturală prin Enter; fără inferență la generare.
- **Securitate:** Prompturi lungi care ascund instrucțiuni; Hub afișează textul integral înainte.
- **Cale de implementare:** ASSISTED: generator de link în Hub cu cwd absolut al proiectului și prompt construit din task.
- **Test necesar:** Test simulat al encodării; test manual de deschidere (fără Enter).
- **Status:** AVAILABLE
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Handlerul se înregistrează la primul prompt al unei sesiuni interactive; aici este deja înregistrat.
- **Surse citite:** https://code.claude.com/docs/en/deep-links · local: reg query HKCU\Software\Classes\claude-cli (handler înregistrat) · local: scanare stringuri claude.exe (claude-cli:// prezent)
- **Verificare adversarială:** CONFIRMED — deep-links: q max 5.000 caractere, promptul nu se trimite fără Enter, avertisment pentru link extern, căi UNC și .. respinse, Windows Terminal > PowerShell > cmd, înregistrare în HKCU la primul prompt interactiv, disableDeepLinkRegistration.

### `claude doctor` (diagnostic) (`an-cc-doctor`)

- **Sursă oficială:** https://code.claude.com/docs/en/cli-reference
- **Documentație tehnică:** https://code.claude.com/docs/en/cli-reference
- **Ce face:** Tipărește diagnostice read-only despre instalare, validarea setărilor și (în versiuni noi) eligibilitatea Remote Control, fără a porni o sesiune.
- **Plan necesar:** Nu se aplică.
- **Platformă:** Windows 11.
- **Rollout:** GA
- **Eligibilitate cont:** Nu se aplică.
- **Autentificare:** Nu depinde.
- **Allowance:** Fără inferență.
- **Utilizare partajată:** Nu se aplică.
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: `claude doctor` (ieșire text). \| Disponibil pe plan: da. \| Controlabil programatic: da. \| Reutilizabil din Hub: pentru health-check la instalare, rulat într-un director gol. \| Interacțiune: nu. \| Securitate: sare peste workspace trust și pornește serverele stdio din .mcp.json ale directorului curent.
- **Suprafață nativă:** Terminal; /doctor în sesiune (bundled skill, cu model).
- **Cerințe locale:** Director de lucru fără .mcp.json.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Diagnostic de instalare în pagina de sănătate a Hub-ului.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** `codex doctor`.
- **Ce face unic / mai bine:** Validarea setărilor fără sesiune.
- **Securitate:** Pornirea serverelor MCP ale proiectului.
- **Cale de implementare:** MIRROR_STATE: rulare opțională din directorul temporar al Hub-ului.
- **Test necesar:** Test manual read-only într-un director gol.
- **Status:** AVAILABLE
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** medium
- **Note:** `/doctor` din sesiune este altceva și consumă model.
- **Surse citite:** https://code.claude.com/docs/en/cli-reference · local: claude --help (doctor: sare peste trust și pornește serverele stdio din .mcp.json)
- **Verificare adversarială:** CONFIRMED — cli-reference: diagnostice read-only fără sesiune (instalare, validarea setărilor, eligibilitatea Remote Control în versiunile noi); comportamentul local cu serverele stdio din .mcp.json provine din help-ul 2.1.175.

### Actualizarea Claude Code (`claude update`, `claude install stable\|latest`) (`an-cc-version-updates`)

- **Sursă oficială:** https://code.claude.com/docs/en/cli-reference
- **Documentație tehnică:** https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md
- **Ce face:** Instalează sau actualizează binarul (versiune specifică, stable sau latest); versiunea curentă publicată este 2.1.285.
- **Plan necesar:** Nu se aplică.
- **Platformă:** Windows 11 (instalare npm globală).
- **Rollout:** GA
- **Eligibilitate cont:** Nu se aplică.
- **Autentificare:** Nu depinde.
- **Allowance:** Fără inferență.
- **Utilizare partajată:** Nu se aplică.
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Nu, dar versiunile noi pot schimba valori implicite (auto mode, --bare).
- **Risc de facturare API:** none
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Mecanism: `claude update`, `claude install <versiune\|stable\|latest>`, `npm install -g @anthropic-ai/claude-code@latest`; instalările npm și native se actualizează automat în fundal (npm doar dacă directorul global permite scrierea); control: `autoUpdatesChannel` (latest implicit sau stable, circa o săptămână în urmă), `minimumVersion`, `DISABLE_AUTOUPDATER=1` (oprește doar verificarea de fundal), `DISABLE_UPDATES` (blochează orice cale de update), iar în managed settings `requiredMinimumVersion`/`requiredMaximumVersion` refuză pornirea în afara intervalului. \| Disponibil pe plan: da. \| Controlabil programatic: da, dar este o instalare/modificare de sistem. \| Reutilizabil din Hub: Hub poate raporta decalajul de versiune și beneficiile. \| Interacțiune: aprobarea proprietarului. \| Securitate: schimbări de comportament implicit; verificarea CHANGELOG-ului înainte.
- **Suprafață nativă:** Terminal.
- **Cerințe locale:** Aprobare explicită; API Hub inactiv la reload.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Decizie de mentenanță a proprietarului, documentată de Hub.
- **Suprafață de execuție:** hub.local
- **Echivalent la celălalt ecosistem:** Actualizarea Codex CLI (bundle desktop).
- **Ce face unic / mai bine:** Adaugă --permission-prompts, --restricted, --forward-subagent-text, remedieri de securitate la worktree/rewind.
- **Securitate:** Regresii; pe Windows nativ, de la v2.1.233 sesiunile interactive ale planului Max pornesc implicit în modul auto (v2.1.283 extinde la toate planurile); de la v2.1.273 skills din claude.ai se sincronizează în sesiunile terminal; de la v2.1.234 apare mesageria între sesiuni pe Windows.
- **Cale de implementare:** ASSISTED: Hub afișează versiunea locală vs. cea publicată și lista de flag-uri lipsă.
- **Test necesar:** După update: `claude --version`, `--help`, `auth status --json`, suita test:v2.
- **Status:** AVAILABLE
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Actualizarea nu a fost făcută; necesită aprobare explicită.
- **Surse citite:** https://code.claude.com/docs/en/cli-reference · https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md · local: claude --version (2.1.175)
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://code.claude.com/docs/en/setup), securityConcerns (https://code.claude.com/docs/en/permission-modes ; https://code.claude.com/docs/en/skills ; https://code.claude.com/docs/en/cross-session-messaging)) — CHANGELOG confirmă 2.1.285 ca ultima versiune publicată. setup documentează actualizarea automată, canalele și variabilele de dezactivare; permission-modes, skills și cross-session-messaging dau pragurile de comportament relevante pentru update.

### claude project purge: ștergerea stării locale Claude Code pentru un proiect (`an-gap-cc-project-purge`)

- **Sursă oficială:** https://code.claude.com/docs/en/cli-reference
- **Documentație tehnică:** https://code.claude.com/docs/en/claude-directory
- **Ce face:** Șterge pentru un proiect transcrierile și auto memory din projects/, intrările tasks/, debug/ și file-history/ ale sesiunilor, liniile de prompt din history.jsonl și intrarea proiectului din ~/.claude.json (încredere, istoric, servere MCP). Opțiuni: --dry-run, -y/--yes, -i/--interactive, --all (șterge history.jsonl în întregime). Nu atinge imaginile și scratchpad-ul din directorul temporar. Cere confirmare și nu poate fi anulat.
- **Plan necesar:** Oricare
- **Platformă:** Claude Code CLI
- **Rollout:** GA; prezent în 2.1.175
- **Eligibilitate cont:** Aplicabil
- **Autentificare:** N/A (local)
- **Allowance:** Nu consumă
- **Utilizare partajată:** N/A
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Nu
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** claude project purge <cale> [--dry-run\|-y/--yes\|-i/--interactive]; --all înlocuiește calea și purjează starea TUTUROR proiectelor, ștergând history.jsonl complet în loc să-l filtreze. Nu atinge shell-snapshots/ și backups/ (pot păstra intrarea proiectului în instantanee vechi ale ~/.claude.json) și nici imaginile și scratchpad-ul din directorul temporar. Hub nu îl rulează automat; chiar și --dry-run afișează căi și intrarea din ~/.claude.json, pe care Hub-ul nu trebuie să-l citească.
- **Suprafață nativă:** Terminal
- **Cerințe locale:** Claude Code CLI (prezent local)
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Operație distructivă consemnată ca efect lateral; doar la cererea explicită a proprietarului, executată de proprietar.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** oa-codex-app-server-side-effect-methods (ștergere de sesiuni Codex).
- **Ce face unic / mai bine:** Plan de ștergere explicit înainte de confirmare.
- **Securitate:** Ștergere ireversibilă a transcrierilor pe care checkpoint-urile Hub le pot referi și a intrării de încredere/MCP a proiectului. Retenția automată cleanupPeriodDays (implicit 30 de zile) șterge oricum transcrierile vechi, deci Hub-ul trebuie să-și copieze ce are nevoie.
- **Cale de implementare:** Blocat în allowlist-ul de comenzi al Hub-ului; documentat în runbook ca acțiune a proprietarului.
- **Test necesar:** Test de politică: comanda este refuzată de Hub.
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Efect confirmat din documentație, fără rulare.
- **Surse citite:** https://code.claude.com/docs/en/cli-reference.md · https://code.claude.com/docs/en/claude-directory.md · local: claude project --help (2.1.175)
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://code.claude.com/docs/en/claude-directory.md#clear-local-data ; https://code.claude.com/docs/en/cli-reference.md)) — Efectele sunt confirmate în cli-reference și claude-directory (Clear local data). Corectat: --all nu înseamnă doar ștergerea completă a history.jsonl, ci purjarea tuturor proiectelor. Statusul BLOCKED și decizia REJECT rămân corecte.

### Suprafețele de bază Claude pe web (claude.ai) și în Claude Desktop pentru Windows: chat, instalare/versiune, voice mode, încărcare de fișiere, personalizare (`an-gap-claude-web-desktop-core`)

- **Sursă oficială:** https://support.claude.com/en/articles/10065433-install-claude-desktop
- **Documentație tehnică:** https://claude.com/docs/cowork/changelog
- **Ce face:** Claude Desktop (macOS, Windows ≥10, Linux beta) oferă chat pe toate planurile și Claude Code și Cowork pe Pro/Max/Team/Enterprise; se actualizează singur pe Windows/macOS. Chatul acceptă fișiere (PDF, DOCX, CSV, TXT, HTML, ODT, RTF, EPUB, JSON, XLSX cu code execution; imagini JPEG/PNG/GIF/WebP; 500 MB per fișier, 20 fișiere per chat; 30 MB per fișier în proiecte). Voice mode este beta pe toate planurile, pe web, Desktop și mobil. Personalizare: Instructions for Claude la nivel de cont, instrucțiuni de proiect.
- **Plan necesar:** Chat: toate planurile; Code și Cowork: Pro, Max, Team, Enterprise
- **Platformă:** Web, Windows, macOS, Linux (beta)
- **Rollout:** GA; voice mode beta
- **Eligibilitate cont:** Disponibil: Claude Desktop 2.16120.0 x64 este instalat local (versiune din 29.09.2026, cu Claude Code 2.1.284 inclus), cont Max.
- **Autentificare:** Login claude.ai în aplicație
- **Allowance:** Alocarea comună Max
- **Utilizare partajată:** Comună între chat, Cowork, Claude Code și mobil
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar dacă proprietarul activează usage credits.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Chatul nu are API pentru abonament. Hub poate citi read-only versiunea aplicației (Get-AppxPackage) și changelog-ul public; conversațiile rămân în contul claude.ai (export prin an-account-data-export).
- **Suprafață nativă:** claude.ai, Claude Desktop (Windows), aplicația mobilă
- **Cerințe locale:** Windows 10+; aplicația instalată local
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Suprafață operată de proprietar; Hub pregătește intrări (brief, fișiere) și înregistrează rezultatele și versiunea aplicației.
- **Suprafață de execuție:** anthropic.claude_chat
- **Echivalent la celălalt ecosistem:** ChatGPT web/desktop (oa-codex-desktop-app, oa-chatgpt-work).
- **Ce face unic / mai bine:** Un singur client care reunește chat, Cowork, Claude Code, browser integrat și computer use; binar Claude Code inclus, actualizat odată cu aplicația.
- **Securitate:** Instrucțiunile de cont se aplică tuturor conversațiilor; fișierele încărcate ajung în contul claude.ai.
- **Cale de implementare:** Hub: oglindirea versiunii Desktop și a versiunii Claude Code incluse în panoul de capabilități; fluxuri ASSISTED pentru livrabile create în chat.
- **Test necesar:** Niciun test cu model; doar citirea versiunii.
- **Status:** AVAILABLE
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Checklist-ul „Claude web/desktop/mobile” avea record doar pentru mobil (an-mobile-app). Styles nu au fost confirmate în paginile citite.
- **Surse citite:** https://support.claude.com/en/articles/10065433-install-claude-desktop · https://claude.com/docs/cowork/changelog.md · https://support.claude.com/en/articles/11101966-use-voice-mode · https://support.claude.com/en/articles/8241126-upload-files-to-claude · https://support.claude.com/en/articles/10185728-understanding-claude-s-personalization-features · local: Get-AppxPackage Claude
- **Verificare adversarială:** CONFIRMED — Articolul de instalare confirmă macOS 11+, Windows 10+, Linux beta (Ubuntu 22.04+/Debian 12+, x64/arm64), chat pe toate planurile, Claude Code și Cowork pe Pro/Max/Team/Enterprise. Actualizarea automată pe Windows/macOS nu este afirmată explicit; articolul doar opune actualizările prin apt celor „in-app”. Fișiere (500 MB/fișier, 20/chat, 30 MB în proiecte, XLSX cu code execution) și voice mode (beta, toate planurile, web/Desktop/mobil) sunt confirmate.

### Monthly recap (Settings > Reflect) și Time and focus (break reminders, quiet hours) (`an-gap-reflect-recap-time-focus`)

- **Sursă oficială:** https://support.claude.com/en/articles/15672559-see-your-monthly-recap
- **Documentație tehnică:** https://support.claude.com/en/articles/15672868-set-break-reminders-and-quiet-hours
- **Ce face:** Recapitularea lunară arată temele, ziua cea mai activă, ora de vârf, numărul de conversații, un grafic zilnic și observații pe patru abilități de lucru cu AI; se construiește din istoricul de chat și apare doar cu memoria activă. Exclude chaturile incognito, integrările de sănătate și activitatea din Cowork și Claude Code. Time and focus permite remindere de pauză și ore de liniște, care nu blochează utilizarea și sunt separate de limitele planului.
- **Plan necesar:** Free, Pro, Max (nu Team/Enterprise)
- **Platformă:** Web și Claude Desktop (setările se aplică și pe mobil)
- **Rollout:** Beta, lansare graduală (09.07.2026)
- **Eligibilitate cont:** Eligibil pe Max dacă memoria este activă; vizibilitatea pe acest cont nu a fost verificată.
- **Autentificare:** Login claude.ai
- **Allowance:** Nu consumă explicit; regenerarea recapitulării este internă
- **Utilizare partajată:** N/A
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu
- **Risc de facturare API:** none
- **Integrare programatică:** NONE
- **Detaliu integrare:** Fără API sau export; doar UI.
- **Suprafață nativă:** Settings > Reflect; Settings > Time and focus
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Nerelevant pentru telemetria Hub: nu include Claude Code/Cowork și nu are export.
- **Suprafață de execuție:** anthropic.claude_chat
- **Echivalent la celălalt ecosistem:** Nu există echivalent direct în inventarul OpenAI.
- **Ce face unic / mai bine:** Reflecție personală asupra utilizării, fără judecăți.
- **Securitate:** Folosește istoricul de chat (memoria); se dezactivează doar prin oprirea memoriei din istoric.
- **Cale de implementare:** Niciuna
- **Test necesar:** Niciunul
- **Status:** ELIGIBILITY_UNKNOWN
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** high
- **Note:** Telemetria Hub rămâne bazată pe evenimentele proprii și pe an-usage-* .
- **Surse citite:** https://support.claude.com/en/articles/15672559-see-your-monthly-recap · https://support.claude.com/en/articles/15672868-set-break-reminders-and-quiet-hours · https://www.anthropic.com/news/reflect-with-claude · https://support.claude.com/en/articles/12138966-release-notes
- **Verificare adversarială:** CONFIRMED — Articolele de suport confirmă: recapitularea lunară este beta pentru Free, Pro, Max, în Settings > Reflect, doar cu memoria activă, exclude incognito, sănătate, Cowork și Claude Code, pe web și Desktop, fără export; vizualizarea nu consumă limite. Break reminders și quiet hours: beta pe Free/Pro/Max, nu blochează utilizarea, separate de limitele planului, pe web, Desktop și mobil.

## review

### Facturarea ultrareview (/code-review ultra) (`an-ultrareview-billing`)

- **Sursă oficială:** https://code.claude.com/docs/en/ultrareview
- **Documentație tehnică:** https://code.claude.com/docs/en/ultrareview
- **Ce face:** Review multi-agent în cloud, cu constatări reproduse și verificate; funcție premium facturată din usage credits, nu din limitele planului. Pro și Max au 3 rulări gratuite unice per cont; apoi aproximativ 5–25 USD per review; un dialog arată rulările rămase și costul estimat.
- **Plan necesar:** Autentificare claude.ai; usage credits activate pentru rulări plătite
- **Platformă:** Claude Code (sesiune cloud)
- **Rollout:** Research preview
- **Eligibilitate cont:** Rulările gratuite sunt probabil disponibile (neverificat); rulările plătite sunt blocate deoarece creditele sunt dezactivate.
- **Autentificare:** OAuth claude.ai
- **Allowance:** 3 rulări gratuite unice
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** După rulările gratuite, fiecare review se facturează din credite (aproximativ 5–25 USD). O rulare gratuită se consumă chiar dacă este oprită sau eșuează. Subcomanda claude ultrareview poate porni o rulare plătită fără prompt dacă creditele sunt active.
- **Risc de facturare API:** high
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** În -p, /code-review ultra (≥2.1.218) lansează doar rulări gratuite, afișează un link de urmărire și se oprește înainte de o rulare plătită. Subcomanda claude ultrareview blochează până la rezultate (timeout implicit 45 de minute), iar simpla ei rulare valorează consimțământ la promptul de facturare și termeni. Cu --post, publică pe PR fără întrebare.
- **Suprafață nativă:** Claude Code interactiv
- **Cerințe locale:** Repository GitHub conectat pentru PR-uri
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Opțiune manuală a proprietarului pentru cele 3 rulări gratuite; Hub-ul doar pregătește contextul.
- **Suprafață de execuție:** anthropic.claude_code_web
- **Echivalent la celălalt ecosistem:** Revizuirea de cod Codex și codex review
- **Ce face unic / mai bine:** Constatări verificate independent
- **Securitate:** Codul este trimis în cloud; publicarea pe PR este un efect extern.
- **Cale de implementare:** Hub-ul nu lansează ultrareview; înregistrează rezultatul adus de proprietar.
- **Test necesar:** Niciunul
- **Status:** ASSISTED_ONLY
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Indisponibil sub ZDR și pe cloud providers.
- **Surse citite:** https://code.claude.com/docs/en/ultrareview · local: claude --help (sources-anthropic-local.md)
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://code.claude.com/docs/en/ultrareview; https://code.claude.com/docs/en/cli-reference), extraBillingRisk (https://code.claude.com/docs/en/ultrareview)) — Confirmate în ultrareview: research preview; 3 rulări gratuite unice pe Pro și Max, apoi facturare din credite; indisponibil sub ZDR și pe Bedrock, Agent Platform și Foundry.

### Ultrareview (`/code-review ultra`, `claude ultrareview`) (`an-cc-ultrareview`)

- **Sursă oficială:** https://code.claude.com/docs/en/ultrareview
- **Documentație tehnică:** https://code.claude.com/docs/en/cli-reference
- **Ce face:** O flotă de agenți într-un sandbox cloud găsește și verifică independent bug-uri într-un branch sau PR (circa 5–10 minute).
- **Plan necesar:** Pro/Max: 3 rulări gratuite unice, apoi usage credits; Team/Enterprise: doar credite.
- **Platformă:** Cloud Anthropic.
- **Rollout:** Research preview
- **Eligibilitate cont:** Max eligibil; numărul de rulări gratuite rămase este necunoscut.
- **Autentificare:** claude.ai.
- **Allowance:** 3 rulări gratuite unice per cont.
- **Utilizare partajată:** Nu (credite separate după rulările gratuite).
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** Circa 5–25 USD în usage credits per review după rulările gratuite; rularea subcomenzii înseamnă consimțământ la facturare.
- **Risc de facturare API:** high
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: `claude ultrareview [target] --json --timeout <min> [--post]` (local: --json, --timeout); `/code-review ultra` interactiv arată rulările gratuite rămase și costul estimat. \| Disponibil pe plan: parțial. \| Controlabil programatic: da, dar implică acceptarea facturării. \| Reutilizabil din Hub: nu. \| Interacțiune: dialogul de confirmare din sesiunea interactivă. \| Securitate: bundle al repo-ului încărcat în cloud; --post publică pe PR.
- **Suprafață nativă:** /code-review ultra.
- **Cerințe locale:** Git; GitHub pentru modul PR.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Doar la inițiativa proprietarului, în sesiune interactivă.
- **Suprafață de execuție:** anthropic.claude_code_review_cloud
- **Echivalent la celălalt ecosistem:** Revizie automată Codex în cloud.
- **Ce face unic / mai bine:** Constatări verificate independent.
- **Securitate:** Facturare și upload de cod.
- **Cale de implementare:** REJECT: Hub nu rulează niciodată `claude ultrareview` și blochează argumentul ultra în prompturi.
- **Test necesar:** Test simulat: filtrarea promptului pentru ultra.
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Timeout-ul implicit local este 30 minute (documentația actuală: 45).
- **Surse citite:** https://code.claude.com/docs/en/ultrareview · https://code.claude.com/docs/en/cli-reference · local: claude ultrareview --help (2.1.175)
- **Verificare adversarială:** CONFIRMED — ultrareview: research preview, 3 rulări gratuite unice pe Pro/Max, apoi circa 5–25 USD în usage credits; rularea subcomenzii de către utilizator înseamnă consimțământ. Local, `claude ultrareview --help` pe 2.1.175 arată --json și --timeout implicit 30 (docs actuale: 45). Pe 2.1.175 /code-review ultra în -p rula o revizie locală (schimbat în v2.1.218).

### /code-review local (skill inclus) (`an-cc-code-review-local`)

- **Sursă oficială:** https://code.claude.com/docs/en/code-review
- **Documentație tehnică:** https://code.claude.com/docs/en/code-review
- **Ce face:** Revizuiește diff-ul branch-ului, un PR sau o cale într-un subagent și raportează bug-uri de corectitudine și curățări; --fix aplică, --comment postează.
- **Plan necesar:** Toate planurile; consumă din limitele planului.
- **Platformă:** Local.
- **Rollout:** GA (redenumit din /simplify la v2.1.147)
- **Eligibilitate cont:** Max verificat.
- **Autentificare:** claude.ai.
- **Allowance:** Cota Max; efortul crește consumul.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Argumentul ultra escaladează la ultrareview (credite).
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: `claude -p "/code-review high <target>"` — în -p rulează în prim-plan și include constatările în răspuns; niveluri low..max; ultra escaladează în cloud; --comment postează pe GitHub/GitLab; --fix editează în afara checkpoint-urilor; skillOverrides code-review: user-invocable-only oprește invocarea automată. \| Disponibil pe plan: da. \| Controlabil programatic: da. \| Reutilizabil din Hub: da, ca tip de task 'review' read-only. \| Interacțiune: nu. \| Securitate: Hub blochează ultra, --comment, --post și --fix.
- **Suprafață nativă:** /code-review.
- **Cerințe locale:** Git.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Revizie de cod inclusă în abonament, orchestrată de Hub.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** `codex review`.
- **Ce face unic / mai bine:** Nivel de efort ajustabil; raport ReportFindings în gazde compatibile.
- **Securitate:** Escaladare accidentală la cloud (pe ≥2.1.218 `/code-review ultra` în -p lansează revizia cloud și se oprește doar când ar factura credite) sau postare externă (--comment/--post); un skill de proiect numit `code-review` înlocuiește comanda bundled, deci într-un repo neverificat promptul Hub ar rula instrucțiuni și allowed-tools controlate de repo.
- **Cale de implementare:** WRAP: task review cu --tools read-only, prompt construit de Hub, validare că lipsesc argumentele interzise, opțional --json-schema.
- **Test necesar:** Test simulat al construcției promptului; live read-only cu grant.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** medium
- **Note:** Pe 2.1.175 comportamentul de fundal/prim-plan poate diferi (fundal implicit din v2.1.218).
- **Surse citite:** https://code.claude.com/docs/en/code-review · https://code.claude.com/docs/en/skills · https://code.claude.com/docs/en/headless
- **Verificare adversarială:** CORRECTED (corectat: securityConcerns (https://code.claude.com/docs/en/code-review ; https://code.claude.com/docs/en/skills ; CHANGELOG 2.1.218)) — code-review și CHANGELOG confirmă redenumirea din /simplify la v2.1.147, fundalul implicit din v2.1.218, rularea în prim-plan în -p cu constatările în răspuns și skillOverrides user-invocable-only. Corectat securityConcerns.

### Code Review gestionat pentru PR-uri GitHub (`an-cc-code-review-managed`)

- **Sursă oficială:** https://code.claude.com/docs/en/code-review
- **Documentație tehnică:** https://code.claude.com/docs/en/code-review
- **Ce face:** Serviciu gestionat care rulează revizii multi-agent pe PR-uri GitHub și postează comentarii inline și un check run.
- **Plan necesar:** Team sau Enterprise (research preview).
- **Platformă:** Cloud Anthropic + Claude GitHub App.
- **Rollout:** Research preview
- **Eligibilitate cont:** Nu este inclus în Max.
- **Autentificare:** Admin claude.ai + GitHub App.
- **Allowance:** Facturat separat prin usage credits (medie 15–25 USD per review).
- **Utilizare partajată:** Nu.
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Usage credits per review.
- **Risc de facturare API:** high
- **Integrare programatică:** NONE
- **Detaliu integrare:** Mecanism: activare de Owner în admin, @claude review în PR. \| Disponibil pe plan: nu (Max). \| Controlabil programatic: nu pentru acest cont. \| Reutilizabil din Hub: nu. \| Interacțiune: nu se aplică. \| Securitate: acces GitHub App larg.
- **Suprafață nativă:** GitHub PR.
- **Cerințe locale:** Nu se aplică.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul.
- **Suprafață de execuție:** anthropic.claude_code_review_cloud
- **Echivalent la celălalt ecosistem:** Revizii automate Codex în cloud.
- **Ce face unic / mai bine:** Integrare nativă GitHub.
- **Securitate:** Nu se aplică.
- **Cale de implementare:** REJECT.
- **Test necesar:** Niciunul.
- **Status:** PLAN_RESTRICTED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Alternativa inclusă este /code-review local.
- **Surse citite:** https://code.claude.com/docs/en/code-review · https://code.claude.com/docs/en/feature-availability
- **Verificare adversarială:** CONFIRMED — code-review: research preview pentru Team/Enterprise, circa 15–25 USD per review, facturat separat prin usage credits; feature-availability: indisponibil pe Max.

## memory

### Persistența sesiunilor: `--resume`, `--continue`, `--session-id`, `-n`, `--no-session-persistence` (`an-cc-session-resume`)

- **Sursă oficială:** https://code.claude.com/docs/en/sessions
- **Documentație tehnică:** https://code.claude.com/docs/en/cli-reference
- **Ce face:** Salvează continuu conversațiile ca JSONL local în ~/.claude/projects/<proiect>/<session-id>.jsonl și permite reluarea după ID, nume sau cale de transcriere.
- **Plan necesar:** Toate planurile.
- **Platformă:** Local, Windows 11.
- **Rollout:** GA
- **Eligibilitate cont:** Max verificat.
- **Autentificare:** OAuth claude.ai.
- **Allowance:** Reluarea retrimite istoricul; după pauze lungi cache-ul expiră și costul crește.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu în sine.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: `--session-id <uuid>` la creare, `--resume <id\|nume\|cale.jsonl>`, `-c`, `-n <nume>`; `--no-session-persistence` (doar -p) sau CLAUDE_CODE_SKIP_PROMPT_HISTORY; sesiunile -p/SDK nu apar în picker și în `--continue` interactiv; reluarea restaurează istoricul, modelul și agentul, dar în -p pornește în modul de permisiune al unui -p nou; --mcp-config, --settings, --plugin-dir și --add-dir trebuie repasate. Căutarea ID-ului în toate proiectele e din v2.1.223 (pe 2.1.175 doar proiectul curent și worktree-urile). Retenție cleanupPeriodDays (30 zile). \| Disponibil pe plan: da. \| Controlabil programatic: da. \| Reutilizabil din Hub: da, maparea run→nativeSessionId există în V2. \| Interacțiune: nu. \| Securitate: transcrierile conțin cod și prompturi; formatul JSONL e intern și se poate schimba; `claude project purge` șterge date (doar cu aprobare).
- **Suprafață nativă:** /resume, picker de sesiuni.
- **Cerințe locale:** Rularea reluării din același proiect pe 2.1.175.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Continuitate multi-turn a task-urilor Hub.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** `codex resume` / thread/resume în app-server.
- **Ce face unic / mai bine:** ID de sesiune preasignat de gazdă; reluare după cale de fișier.
- **Securitate:** Nu se parsează direct JSONL-ul; nu se trimite extern.
- **Cale de implementare:** WRAP existent (--session-id/--resume); Hub re-pasează aceleași flag-uri de izolare la fiecare reluare.
- **Test necesar:** Test simulat de reluare cu flag-urile de izolare repetate; live doar cu grant.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Rezumarea la reluare după >1 oră pe Pro/Max apare doar interactiv.
- **Surse citite:** https://code.claude.com/docs/en/sessions · https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/headless · https://code.claude.com/docs/en/agent-sdk/sessions · local: claude --help (2.1.175)
- **Verificare adversarială:** CONFIRMED — Verificat în sessions, headless și cli-reference: transcrieri în ~/.claude/projects/<proiect>/<session-id>.jsonl, reluare după ID/nume/cale, sesiunile -p/SDK excluse din picker și din --continue interactiv, modul de permisiune al unui -p nou la reluare, flag-uri de repasat (și --fallback-model), căutarea între proiecte din v2.1.223, cleanupPeriodDays 30. Rezumarea la reluare apare pe Pro/Max după ~1 oră de inactivitate și peste 100.000 de tokeni, ca dialog interactiv.

### Ramificarea sesiunilor (`--fork-session`, `/branch`) (`an-cc-fork-session`)

- **Sursă oficială:** https://code.claude.com/docs/en/sessions
- **Documentație tehnică:** https://code.claude.com/docs/en/cli-reference
- **Ce face:** Creează o sesiune nouă, cu ID propriu, pornind din istoricul alteia; originalul rămâne neschimbat. Nu ramifică sistemul de fișiere.
- **Plan necesar:** Toate planurile.
- **Platformă:** Local.
- **Rollout:** GA
- **Eligibilitate cont:** Max verificat.
- **Autentificare:** OAuth claude.ai.
- **Allowance:** Cota Max; fiecare ramură consumă separat.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: `claude -p --resume <id> --fork-session` (sau `--continue --fork-session`); ID-ul nou apare în system/init și result; în SDK opțiunea forkSession. Un fork în proces separat nu moștenește aprobările de sesiune; un fork pornește în directorul de lansare, nu în worktree-ul originalului. \| Disponibil pe plan: da. \| Controlabil programatic: da. \| Reutilizabil din Hub: da, pentru explorări alternative legate de același task Hub. \| Interacțiune: nu. \| Securitate: ramurile editează aceleași fișiere; izolarea cere worktrees separate.
- **Suprafață nativă:** /branch în TUI.
- **Cerințe locale:** Niciuna suplimentară.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Variante de soluție comparate de Hub, fiecare ca run copil al aceluiași task.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** `codex fork`.
- **Ce face unic / mai bine:** Ramificare fără pierderea istoricului original.
- **Securitate:** Conflicte de editare dacă ramurile rulează în același cwd.
- **Cale de implementare:** WRAP: acțiune Hub 'fork run' care combină --fork-session cu un worktree Hub dedicat.
- **Test necesar:** Test simulat: ID nou diferit de original; live doar cu grant.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Hub rămâne proprietarul relației părinte/copil între run-uri.
- **Surse citite:** https://code.claude.com/docs/en/sessions · https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/agent-sdk/sessions · https://code.claude.com/docs/en/worktrees · local: claude --help (2.1.175)
- **Verificare adversarială:** CONFIRMED — Verificat în sessions, worktrees și cli-reference: ID nou, fork-ul în proces separat nu moștenește aprobările de sesiune, pornește în directorul de lansare și nu în worktree-ul originalului. CHANGELOG v2.0.73: --session-id se poate combina cu --resume/--continue și --fork-session, deci Hub poate preasigna ID-ul ramurii.

### Memoria de proiect: CLAUDE.md, .claude/rules, auto memory (`an-cc-memory`)

- **Sursă oficială:** https://code.claude.com/docs/en/memory
- **Documentație tehnică:** https://code.claude.com/docs/en/memory
- **Ce face:** Instrucțiuni persistente (managed, user, proiect, local, importuri @path, reguli pe căi) și note scrise automat de Claude în ~/.claude/projects/<proiect>/memory/MEMORY.md.
- **Plan necesar:** Toate planurile.
- **Platformă:** Local (auto memory este locală mașinii).
- **Rollout:** GA; citirea directă a AGENTS.md din v2.1.277
- **Eligibilitate cont:** Max verificat.
- **Autentificare:** Nu depinde.
- **Allowance:** CLAUDE.md consumă context la fiecare sesiune.
- **Utilizare partajată:** Nu se aplică.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: CLAUDE.md de proiect încărcat și în -p; auto memory activă implicit (autoMemoryEnabled, CLAUDE_CODE_DISABLE_AUTO_MEMORY=1, autoMemoryDirectory); AGENTS.md citit direct doar din v2.1.277 (local: import @AGENTS.md); /memory, /context; hook InstructionsLoaded; claudeMdExcludes. \| Disponibil pe plan: da. \| Controlabil programatic: prin fișiere și env. \| Reutilizabil din Hub: Hub rămâne memoria canonică; poate oglindi read-only auto memory și poate propune secțiuni CLAUDE.md (cu aprobare). \| Interacțiune: nu. \| Securitate: auto memory creează o memorie paralelă divergentă; memoria nu aplică politici (se folosesc hooks).
- **Suprafață nativă:** /memory.
- **Cerințe locale:** Niciuna.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Sursă de context pentru Claude alimentată de Hub; memoria canonică rămâne în Hub.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Codex memories (activ local) și AGENTS.md.
- **Ce face unic / mai bine:** Reguli pe căi; importuri; audit prin hook.
- **Securitate:** Divergența memoriei; instrucțiuni din repo neîncredere.
- **Cale de implementare:** MIRROR_STATE: env CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 în run-urile Hub; context Hub prin --append-system-prompt.
- **Test necesar:** Test simulat al env-ului.
- **Status:** AVAILABLE
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** high
- **Note:** CLAUDE.md al proiectului conține politici de handoff care trebuie menținute sincron cu Hub.
- **Surse citite:** https://code.claude.com/docs/en/memory · https://code.claude.com/docs/en/sub-agents · local: scanare stringuri claude.exe (agents-md@builtin absent)
- **Verificare adversarială:** CONFIRMED — memory: ierarhia CLAUDE.md, importuri @path, .claude/rules, auto memory activă implicit (200 de linii/25KB), CLAUDE_CODE_DISABLE_AUTO_MEMORY; AGENTS.md citit direct din v2.1.277 și doar când nu există CLAUDE.md (proiectul are CLAUDE.md).

### Memoria Claude (chat + Cowork, pe topicuri editabile) (`an-memory`)

- **Sursă oficială:** https://support.claude.com/en/articles/11817273
- **Documentație tehnică:** https://support.claude.com/en/articles/11817273
- **Ce face:** Claude captează automat intrări de memorie individuale (rol, proiecte, persoane, preferințe) grupate pe topicuri, vizibile și editabile în Settings > Memory > Topics; memorie separată per proiect; sincronizare între chat și Cowork în cloud (sesiunile Cowork locale nu o accesează); comutatoare Generate memory from chats și Include sensitive topics; chaturi incognito care nu intră în memorie.
- **Plan necesar:** Toate planurile; activă implicit pe Free, Pro și Max (web, Desktop, mobil); dezactivată implicit pe Team/Enterprise, unde o activează owner-ul.
- **Platformă:** claude.ai web, Desktop, mobil
- **Rollout:** Revizie majoră 2026-07-10; extindere chat + Cowork și topicuri 2026-08-25.
- **Eligibilitate cont:** Disponibilă pe Max; starea comutatoarelor pe cont nu este cunoscută.
- **Autentificare:** Sesiune claude.ai.
- **Allowance:** Fără cost separat.
- **Utilizare partajată:** Nu se aplică
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul identificat.
- **Risc de facturare API:** none
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Nu există API documentat pentru citirea sau scrierea memoriei; Claude Code are memorie proprie (CLAUDE.md, auto memory), iar documentația citită nu arată că memoria claude.ai ajunge în Claude Code.
- **Suprafață nativă:** Settings > Memory (Topics, Pause/Reset, sensitive topics); iconița incognito.
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Memoria canonică a companiei rămâne în Hub (SQLite, auditabilă, fără vendor lock-in); memoria Claude este preferință personală a proprietarului.
- **Suprafață de execuție:** anthropic.claude_chat
- **Echivalent la celălalt ecosistem:** Memoria ChatGPT; funcția memories din Codex (activă local conform codex features list).
- **Ce face unic / mai bine:** Topicuri editabile, izolare per proiect, continuitate chat–Cowork.
- **Securitate:** Detalii de firmă pot intra automat în memorie; resetarea sau dezactivarea la nivel de organizație șterge datele; indisponibilă pentru HIPAA sau retenție personalizată.
- **Cale de implementare:** Hub-ul își menține memoria proprie; portabilitatea spre Claude se face prin an-memory-import-export.
- **Test necesar:** Nu
- **Status:** ASSISTED_ONLY
- **Decizie Hub:** REIMPLEMENT
- **Încredere:** high
- **Note:** Nu există discrepanță: articolul spune textual că memoria este activă implicit pe Free, Pro și Max, în acord cu nota din 2026-03-02 care a extins memoria la utilizatorii Free. Căutarea în chaturile anterioare rămâne doar pe planuri plătite.
- **Surse citite:** https://support.claude.com/en/articles/11817273 · https://support.claude.com/en/articles/12138966-release-notes · https://support.claude.com/en/articles/12123587-importing-and-exporting-your-memory-from-claude
- **Verificare adversarială:** CORRECTED (corectat: planRequired (https://support.claude.com/en/articles/11817273), notes (https://support.claude.com/en/articles/11817273 ; https://support.claude.com/en/articles/12138966-release-notes)) — Restul confirmat: topicuri editabile în Settings > Memory, memorie per proiect, partajare chat–Cowork doar în cloud, incognito, excluderea HIPAA/retenție personalizată, fără API; reviziile din 2026-07-10 și 2026-08-25 apar în release notes.

### Căutare și referire a conversațiilor anterioare (Search and reference chats) (`an-chat-search`)

- **Sursă oficială:** https://support.claude.com/en/articles/11817273
- **Documentație tehnică:** https://support.claude.com/en/articles/11817273
- **Ce face:** La cerere, Claude caută prin RAG în chaturile anterioare (în afara proiectelor sau în interiorul unui singur proiect) și reia detaliile; căutarea apare ca apel de instrument.
- **Plan necesar:** Planuri plătite (Pro, Max, Team, Enterprise).
- **Platformă:** claude.ai web, Desktop, mobil
- **Rollout:** GA; în experiența unificată căutarea nu acoperă taskurile Cowork mai vechi.
- **Eligibilitate cont:** Inclus în Max.
- **Autentificare:** Sesiune claude.ai.
- **Allowance:** Limitele planului.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar prin usage credits activate.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Fără API; comutator Search and reference chats în setări.
- **Suprafață nativă:** Conversația (cerere în limbaj natural); Settings > Memory / Capabilities.
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință; Hub-ul are propriul index de conversații și audit.
- **Suprafață de execuție:** anthropic.claude_chat
- **Echivalent la celălalt ecosistem:** Referirea istoricului de chat în ChatGPT (neverificat în această sesiune).
- **Ce face unic / mai bine:** Delimitare strictă per proiect.
- **Securitate:** Pe Enterprise cu CMEK căutarea nu este disponibilă; altfel fără riscuri specifice.
- **Cale de implementare:** Nimic de implementat.
- **Test necesar:** Nu
- **Status:** ASSISTED_ONLY
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Detaliile de plan provin și dintr-un fragment de căutare al aceluiași articol.
- **Surse citite:** https://support.claude.com/en/articles/11817273 · https://support.claude.com/en/articles/16761823
- **Verificare adversarială:** CONFIRMED — Confirmat textual: căutarea în chaturi este disponibilă pe planuri plătite (Pro, Max, Team, Enterprise) pe web, Desktop și mobil, prin RAG vizibil ca apel de instrument, limitată per proiect; indisponibilă cu CMEK; în experiența unificată nu acoperă taskurile Cowork mai vechi. După rollout este activă implicit. Încrederea poate fi ridicată la high.

### Import și export de memorie (experimental) (`an-memory-import-export`)

- **Sursă oficială:** https://support.claude.com/en/articles/12123587-importing-and-exporting-your-memory-from-claude
- **Documentație tehnică:** https://support.claude.com/en/articles/12123587-importing-and-exporting-your-memory-from-claude
- **Ce face:** Import în trei pași: asistentul anterior produce un export cu intrări de forma [dată] - conținut, apoi Settings > Memory > Start import, lipire și Add to memory; Claude extrage intrări individuale, cu prioritate pe cele legate de muncă. Exportul: vizualizare în setări sau cerere ca Claude să scrie memoriile textual.
- **Plan necesar:** Free, Pro, Max, Team (import); web și Desktop.
- **Platformă:** claude.ai web, Claude Desktop
- **Rollout:** Experimental; importul poate omite intrări.
- **Eligibilitate cont:** Disponibil pe Max.
- **Autentificare:** Sesiune claude.ai.
- **Allowance:** Fără cost separat; conversația de export consumă puțin din limită.
- **Utilizare partajată:** Da, pentru conversația de export
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul identificat.
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Fără API; doar copy-paste în UI. Hub-ul poate genera text în formatul recomandat din memoria sa canonică și poate primi înapoi exportul lipit de proprietar.
- **Suprafață nativă:** Settings > Memory > Start import; cardul Import memory to Claude.
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Punte de portabilitate fără lock-in în ambele sensuri (Hub → Claude, Claude → Hub), cu revizuire umană.
- **Suprafață de execuție:** anthropic.claude_chat
- **Echivalent la celălalt ecosistem:** external_agent_memory_import în Codex (în dezvoltare, dezactivat local).
- **Ce face unic / mai bine:** Format text simplu, independent de furnizor.
- **Securitate:** Blocul exportat din Hub trebuie filtrat de secrete; textul exportat din Claude intră în Hub doar ca date neîncrezute.
- **Cale de implementare:** Acțiune Hub „generează bloc de import pentru Claude” cu previzualizare și filtre; formular „importă export de memorie” cu aprobare per intrare.
- **Test necesar:** Test local de formatare și filtrare; fără test live.
- **Status:** ASSISTED_ONLY
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Exportul memoriei din sistemul vechi a fost disponibil până la 2026-09-09 (fereastră expirată).
- **Surse citite:** https://support.claude.com/en/articles/12123587-importing-and-exporting-your-memory-from-claude · https://support.claude.com/en/articles/11817273 · https://support.claude.com/en/articles/12138966-release-notes
- **Verificare adversarială:** CORRECTED (corectat: apiBillingRisk (https://support.claude.com/en/articles/12123587-importing-and-exporting-your-memory-from-claude)) — Planurile (Free, Pro, Max, Team; web și Desktop), statutul experimental, formatul [dată] - conținut și exportul prin setări sau chat sunt confirmate textual; termenul 2026-09-09 pentru memoria legacy apare în 11817273. Importul și exportul prin chat folosesc modelul, deci consumă din plan și, cu usage credits activate, pot trece pe credite: risc low, nu none.

### Exportul datelor contului (istoric conversații) (`an-account-data-export`)

- **Sursă oficială:** https://support.claude.com/en/articles/9450526-export-your-claude-data
- **Documentație tehnică:** https://support.claude.com/en/articles/9450526-export-your-claude-data
- **Ce face:** Utilizatorii individuali exportă informațiile contului și istoricul chaturilor din Settings > Privacy (web sau Desktop, nu din mobil); linkul de descărcare vine pe e-mail. Exportul nu poate fi importat în alt cont personal.
- **Plan necesar:** Free, Pro, Max (self-serve); Team/Enterprise doar Primary Owner.
- **Platformă:** claude.ai web, Claude Desktop
- **Rollout:** GA
- **Eligibilitate cont:** Disponibil pe Max.
- **Autentificare:** Sesiune claude.ai; link trimis pe e-mail.
- **Allowance:** Fără consum de limită.
- **Utilizare partajată:** Nu se aplică
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul.
- **Risc de facturare API:** none
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Fără API; proprietarul declanșează exportul și poate oferi arhiva Hub-ului pentru import read-only.
- **Suprafață nativă:** Settings > Privacy > Export data.
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Arhivare opțională a conversațiilor relevante pentru audit, importate ca date neîncrezute.
- **Suprafață de execuție:** anthropic.claude_chat
- **Echivalent la celălalt ecosistem:** Exportul de date ChatGPT (neverificat în această sesiune).
- **Ce face unic / mai bine:** Copie completă a istoricului personal.
- **Securitate:** Arhiva poate conține date sensibile; trebuie stocată local cu acces restrâns; nu se trimite nicăieri.
- **Cale de implementare:** Importator Hub opțional cu selecție manuală a conversațiilor.
- **Test necesar:** Nu
- **Status:** ASSISTED_ONLY
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Pagina oficială a fost citită integral (actualizată 2026-07-08): export pentru utilizatorii individuali Free, Pro și Max; pe Team/Enterprise doar Primary Owner; din Settings > Privacy pe web sau Desktop, nu din aplicațiile iOS/Android; linkul trimis pe e-mail expiră după 24 de ore; exportul nu se poate importa în alt cont personal.
- **Surse citite:** https://support.claude.com/en/articles/9450526-export-your-claude-data (doar fragment din rezultatul căutării)
- **Verificare adversarială:** CORRECTED (corectat: confidence (https://support.claude.com/en/articles/9450526-export-your-claude-data), notes (https://support.claude.com/en/articles/9450526-export-your-claude-data)) — Toate faptele din înregistrare sunt confirmate; se corectează doar încrederea și nota despre sursă, fiindcă pagina a fost acum citită complet.

## security

### Hooks (evenimente de ciclu de viață, decizii JSON, `--include-hook-events`) (`an-cc-hooks`)

- **Sursă oficială:** https://code.claude.com/docs/en/hooks
- **Documentație tehnică:** https://code.claude.com/docs/en/hooks
- **Ce face:** Rulează comenzi, cereri HTTP, unelte MCP, prompturi sau agenți la circa 33 de evenimente (SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, Stop, SubagentStart/Stop, TaskCreated, ConfigChange, WorktreeCreate, PreCompact, SessionEnd etc.) și pot bloca acțiuni determinist.
- **Plan necesar:** Toate planurile și toți furnizorii.
- **Platformă:** Local; pe Windows forma shell rulează prin Git Bash când este instalat, altfel prin PowerShell (sau cu `shell: powershell`); forma exec (`args`) nu folosește shell.
- **Rollout:** GA (tipul agent este experimental)
- **Eligibilitate cont:** Max verificat.
- **Autentificare:** Nu depinde de autentificare (hooks command/http).
- **Allowance:** Hooks de tip prompt/agent consumă cotă; command/http nu.
- **Utilizare partajată:** Doar pentru prompt/agent.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu pentru command/http.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: config în settings (user/project/local/managed), plugin hooks/hooks.json, frontmatter skill/agent sau per run prin `--settings '<json>'`. Tipuri: command (forma exec cu `args`, din v2.1.139, evită shell-ul), http (POST JSON; `allowedHttpHookUrls` este o listă opțională care, odată definită, restricționează URL-urile; `allowedEnvVars` e necesar doar pentru interpolarea variabilelor în headers), mcp_tool, prompt, agent (experimental). Ieșire: exit 2 blochează la evenimentele blocabile; JSON cu continue, stopReason, systemMessage, decision/reason, hookSpecificOutput.permissionDecision allow\|deny\|ask\|defer, updatedInput, additionalContext. `--include-hook-events` (cu stream-json) emite hook_started/hook_progress/hook_response. Dezactivare: disableAllHooks (pentru un run prin `--settings` cu disableAllHooks true, deoarece setările de proiect au precedență față de cele user); managed allowManagedHooksOnly. \| Disponibil pe plan: da. \| Controlabil programatic: da. \| Reutilizabil din Hub: da — PreToolUse de politică (deny git push, rețea, căi sensibile) și hook HTTP spre 127.0.0.1:8011 pentru audit, injectate per run fără fișiere. \| Interacțiune: nu. \| Securitate: hooks rulează cu privilegiile utilizatorului; în -p fără trust rulează hooks din settings-urile proiectului (V2 le blochează) și hooks/allowed-tools din skills de proiect (V2 le lasă să treacă drept definitions); un allow din hook nu trece peste deny/ask.
- **Suprafață nativă:** /hooks (read-only).
- **Cerințe locale:** Node pentru scripturi de hook în formă exec (evită shim-uri .cmd).
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Strat determinist de aplicare a politicii Hub și sursă de evenimente de audit.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Codex hooks (feature activ local).
- **Ce face unic / mai bine:** Blocare deterministă înaintea regulilor; tip http nativ; evenimente în stream.
- **Securitate:** Hooks străine din repo; hooks prompt/agent consumă cotă; HTTP fără allowlist.
- **Cale de implementare:** WRAP: Hub generează un obiect hooks în --settings (PreToolUse command exec către un script Node local read-only de politică) și activează --include-hook-events pentru audit.
- **Test necesar:** Test simulat: hook deny pe Bash(git push *) produce permission_denied; live doar cu grant.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Pe Windows, forma exec cere un executabil .exe real; shim-urile .cmd/.bat se apelează ca `command: node` + `args` cu calea scriptului.
- **Surse citite:** https://code.claude.com/docs/en/hooks · https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/headless · https://code.claude.com/docs/en/security-guidance · local: claude --help (--include-hook-events, --settings)
- **Verificare adversarială:** CORRECTED (corectat: platform (https://code.claude.com/docs/en/hooks), programmaticDetail (https://code.claude.com/docs/en/hooks ; https://code.claude.com/docs/en/permissions ; CHANGELOG 2.1.139), notes (https://code.claude.com/docs/en/hooks)) — hooks enumeră 33 de evenimente și 5 tipuri (agent experimental); confirmă exec vs shell, deciziile JSON, faptul că un allow din hook nu trece peste deny/ask și --include-hook-events. Corectat: shell-ul pe Windows, cerința .exe (se aplică formei exec), caracterul opțional al allowedHttpHookUrls și hooks din skills de proiect folosite în -p fără trust.

### Moduri de permisiune (default/manual, acceptEdits, plan, auto, dontAsk, bypassPermissions) (`an-cc-permission-modes`)

- **Sursă oficială:** https://code.claude.com/docs/en/permission-modes
- **Documentație tehnică:** https://code.claude.com/docs/en/agent-sdk/permissions
- **Ce face:** Stabilește ce acțiuni rulează fără aprobare; regulile deny și ask se aplică în toate modurile, iar căile protejate nu se auto-aprobă.
- **Plan necesar:** Toate planurile.
- **Platformă:** Toate suprafețele.
- **Rollout:** GA
- **Eligibilitate cont:** Max verificat.
- **Autentificare:** Nu depinde.
- **Allowance:** Nu consumă în sine (excepție clasificatorul auto).
- **Utilizare partajată:** Nu se aplică.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: `--permission-mode` (local: acceptEdits, auto, bypassPermissions, default, dontAsk, plan; aliasul manual din v2.1.200); SDK setPermissionMode la runtime; căi protejate (.git, .claude în afară de .claude/worktrees, .vscode, .idea, .husky, .mcp.json, .npmrc, .gitconfig etc.) și căi critice pentru rm; în -p modul de start implicit este default; modul de start interactiv implicit: Manual pe 2.1.175, auto pe Pro/Max/Team din v2.1.228 (macOS/Linux/WSL) și v2.1.233 (Windows nativ) în sesiunile cu feature flags, auto pe toate planurile din v2.1.283; acceptEdits aprobă automat, pe căile din directorul de lucru, editările și comenzile mkdir, touch, rm, rmdir, mv, cp, sed (plus Set-Content, Add-Content, Clear-Content, Remove-Item când PowerShell tool e activ); permissions.disableBypassPermissionsMode și disableAutoMode în managed. \| Disponibil pe plan: da. \| Controlabil programatic: da. \| Reutilizabil din Hub: da (V2: dontAsk pentru read-only, acceptEdits pentru scriere). \| Interacțiune: nu în -p. \| Securitate: bypassPermissions nu protejează de prompt injection și este interzis în V2.
- **Suprafață nativă:** Shift+Tab în TUI.
- **Cerințe locale:** Niciuna.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Baza politicii de execuție per grant.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Politicile de aprobare și sandbox din Codex.
- **Ce face unic / mai bine:** dontAsk pentru rulări blocate; căi protejate încorporate.
- **Securitate:** Modurile permisive; acceptEdits aprobă și ștergeri (rm, rmdir, Remove-Item) și sed în directorul de lucru, deci run-urile de scriere V2 depind de gate-ul de backup; moștenirea în subagenți.
- **Cale de implementare:** WRAP existent; bypass rămâne în lista de flag-uri interzise.
- **Test necesar:** Test simulat existent pentru flag-uri interzise.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Modul auto este tratat separat (an-cc-auto-mode).
- **Surse citite:** https://code.claude.com/docs/en/permission-modes · https://code.claude.com/docs/en/agent-sdk/permissions · https://code.claude.com/docs/en/headless · local: claude --help (--permission-mode choices)
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://code.claude.com/docs/en/permission-modes), securityConcerns (https://code.claude.com/docs/en/permission-modes)) — permission-modes confirmă căile protejate, dontAsk, bypass și modul default în -p. Corectată lista comenzilor aprobate de acceptEdits și pragurile de versiune pentru modul auto implicit.

### Reguli allow/deny/ask, workspace trust, `--permission-prompt-tool`, `--permission-prompts` (`an-cc-permission-rules`)

- **Sursă oficială:** https://code.claude.com/docs/en/agent-sdk/permissions
- **Documentație tehnică:** https://code.claude.com/docs/en/cli-reference
- **Ce face:** Reguli declarative per unealtă și pattern, evaluate după hooks; prompturile nerezolvate pot fi rutate către o unealtă MCP a gazdei.
- **Plan necesar:** Toate planurile.
- **Platformă:** Toate suprafețele.
- **Rollout:** GA
- **Eligibilitate cont:** Max verificat.
- **Autentificare:** Nu depinde.
- **Allowance:** Nu consumă.
- **Utilizare partajată:** Nu se aplică.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: ordinea hooks → deny → ask → mod → allow → canUseTool/--permission-prompt-tool; `--permission-prompt-tool mcp__hub__approve` (prezent local) face din Hub gazda aprobărilor, dar pe 2.1.175 indicarea unui server MCP putea eșua la cold start cu MCP tool not found (remediat în v2.1.206), așteptarea conectării serverului (MCP_TIMEOUT) apare în v2.1.221, restricția pentru uneltele requiresUserInteraction în v2.1.199, iar cererile subagenților de fundal erau refuzate automat în loc să ajungă la unealta de prompt (remediat în v2.1.285); `--permission-prompts none` (v2.1.259+) și `--restricted` (v2.1.248+) lipsesc local; permissions.blockReadsOutsideWorkingDirectories; `--add-dir` dă acces fără configurație; allow-urile din .claude/settings.json de proiect nu se aplică în -p fără trust (deny/ask da). \| Disponibil pe plan: da. \| Controlabil programatic: da. \| Reutilizabil din Hub: da — ruta documentată pentru aprobările Hub, fiabilă abia după update. \| Interacțiune: aprobare în UI-ul Hub. \| Securitate: un allow simplu pe o unealtă întreagă ocolește callback-ul; -p nu cere workspace trust.
- **Suprafață nativă:** /permissions.
- **Cerințe locale:** Server MCP Hub cu unealta de aprobare.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Legătura dintre cererile de permisiune Claude și coada de aprobări Hub.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Aprobările Codex app-server (mapate deja ca aprobări Hub).
- **Ce face unic / mai bine:** Deny aplicat și în bypass; reguli pe căi absolute.
- **Securitate:** Configurare greșită a allow-urilor simple.
- **Cale de implementare:** WRAP după update (≥2.1.285 pentru subagenții de fundal, ≥2.1.259 pentru --permission-prompts none): unealtă MCP Hub de aprobare + reguli scoped; până atunci run-uri dontAsk cu liste stricte de unelte.
- **Test necesar:** Test simulat al fluxului de aprobare MCP; live doar cu grant.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Aprobările date din alte suprafețe (Remote Control) nu trec prin Hub.
- **Surse citite:** https://code.claude.com/docs/en/agent-sdk/permissions · https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/headless · https://code.claude.com/docs/en/mcp · local: scanare stringuri claude.exe (permission-prompt-tool prezent; --restricted absent)
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://code.claude.com/docs/en/cli-reference ; https://code.claude.com/docs/en/permissions ; CHANGELOG 2.1.206, 2.1.285), implementationPath (https://code.claude.com/docs/en/cli-reference ; CHANGELOG 2.1.285)) — agent-sdk/permissions confirmă ordinea evaluării și ocolirea callback-ului de către allow-urile simple; permissions confirmă neaplicarea allow-urilor de proiect în -p fără trust. Corectat cu defectele --permission-prompt-tool remediate după 2.1.175.

### Auto mode (clasificator) și `claude auto-mode` (`an-cc-auto-mode`)

- **Sursă oficială:** https://code.claude.com/docs/en/permission-modes
- **Documentație tehnică:** https://code.claude.com/docs/en/permission-modes
- **Ce face:** Un model clasificator revizuiește acțiunile în locul utilizatorului pe baza unor reguli allow/soft_deny/hard_deny configurabile.
- **Plan necesar:** Toate planurile; modele Opus/Sonnet 4.6+ sau Fable pe API Anthropic.
- **Platformă:** Toate suprafețele.
- **Rollout:** GA
- **Eligibilitate cont:** Max eligibil.
- **Autentificare:** claude.ai.
- **Allowance:** Clasificatorul rulează pe un model (implicit Sonnet 5); pe Enterprise/API se numără în tokeni; pentru Max nu este precizat.
- **Utilizare partajată:** Posibil.
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** `claude auto-mode critique` cere feedback AI (consum).
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: `--permission-mode auto`; `claude auto-mode defaults\|config` (JSON, fără model) și `critique` (cu model); cheia autoMode în settings; permissions.disableAutoMode; clasificatorul revizuiește și SendMessage. \| Disponibil pe plan: da. \| Controlabil programatic: da. \| Reutilizabil din Hub: nu ca înlocuitor al aprobărilor Hub. \| Interacțiune: nu. \| Securitate: documentația avertizează că nu garantează siguranța; clasificatorul poate aproba scrieri pe căi protejate.
- **Suprafață nativă:** Shift+Tab.
- **Cerințe locale:** Niciuna.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Referință; eventual pentru sarcini read-only cu risc scăzut după decizia proprietarului.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Codex guardian_approval (activ local).
- **Ce face unic / mai bine:** Reduce prompturile fără bypass total.
- **Securitate:** Decizia de aprobare trece la un model, nu la proprietar.
- **Cale de implementare:** REFERENCE: `claude auto-mode defaults` poate fi citit read-only pentru documentare; Hub nu folosește auto în run-uri.
- **Test necesar:** Opțional: citirea JSON-ului defaults (fără inferență).
- **Status:** AVAILABLE
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Contabilizarea apelurilor clasificatorului pe Max rămâne neclară.
- **Surse citite:** https://code.claude.com/docs/en/permission-modes · https://code.claude.com/docs/en/feature-availability · local: claude auto-mode --help (config, critique, defaults)
- **Verificare adversarială:** CONFIRMED — permission-modes: toate planurile, modele Opus/Sonnet 4.6+ sau Fable pe API Anthropic, clasificator Sonnet 5 implicit, costul în tokeni precizat doar pentru Enterprise/API/cloud, avertismentul că nu garantează siguranța, scrierile pe căi protejate rutate la clasificator, revizia SendMessage din v2.1.222; cli-reference: `claude auto-mode defaults\|config`.

### Sandbox pentru Bash (Seatbelt/bubblewrap) (`an-cc-sandboxing`)

- **Sursă oficială:** https://code.claude.com/docs/en/sandboxing
- **Documentație tehnică:** https://code.claude.com/docs/en/sandboxing
- **Ce face:** Izolare de fișiere și rețea impusă de sistemul de operare pentru comenzile Bash/PowerShell/Monitor, cu mascarea credențialelor.
- **Plan necesar:** Toate planurile.
- **Platformă:** macOS, Linux, WSL2; Windows nativ nesuportat.
- **Rollout:** GA
- **Eligibilitate cont:** Nu se aplică pe Windows nativ.
- **Autentificare:** Nu depinde.
- **Allowance:** Nu consumă.
- **Utilizare partajată:** Nu se aplică.
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** none
- **Integrare programatică:** NONE
- **Detaliu integrare:** Mecanism: /sandbox, settings sandbox.enabled, allowUnsandboxedCommands=false, excludedCommands, network.allowedDomains, mascarea credențialelor; pachetul @anthropic-ai/sandbox-runtime (instalarea este interzisă acum). \| Disponibil pe plan: da, dar nu pe Windows nativ. \| Controlabil programatic: nu pe această mașină. \| Reutilizabil din Hub: nu. \| Interacțiune: nu. \| Securitate: fără sandbox pe Windows, izolarea depinde de reguli, hooks și workspace.
- **Suprafață nativă:** /sandbox.
- **Cerințe locale:** WSL2 cu bubblewrap (neinstalat).
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Opțiune viitoare pentru un runner WSL2 aprobat.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Codex sandbox (windows_sandbox_service încă în dezvoltare).
- **Ce face unic / mai bine:** Izolare impusă de OS.
- **Securitate:** Absența sandbox-ului pe Windows nativ.
- **Cale de implementare:** REFERENCE: evaluare separată a unui runner WSL2.
- **Test necesar:** Niciunul acum.
- **Status:** NOT_APPLICABLE
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Hub trebuie să compenseze prin liste stricte de unelte și hooks.
- **Surse citite:** https://code.claude.com/docs/en/sandboxing · https://code.claude.com/docs/en/tools-reference
- **Verificare adversarială:** CONFIRMED — sandboxing: rulează pe macOS, Linux și WSL2, Windows nativ nesuportat; setup confirmă că pe Windows sandboxing-ul cere WSL 2.

### Managed settings locale (managed-settings.json sau registru) (`an-cc-managed-settings`)

- **Sursă oficială:** https://code.claude.com/docs/en/managed-settings
- **Documentație tehnică:** https://code.claude.com/docs/en/authentication
- **Ce face:** Politică cu precedență maximă pe mașină: reguli deny, dezactivarea bypass/auto/fast, forceLoginMethod, allowManagedHooksOnly, availableModels etc., fără organizație.
- **Plan necesar:** Toate planurile (fișierul funcționează pe orice furnizor).
- **Platformă:** Windows: C:\Program Files\ClaudeCode\managed-settings.json (+ managed-settings.d/), HKLM\SOFTWARE\Policies\ClaudeCode sau HKCU (user-writable, doar fără document admin).
- **Rollout:** GA
- **Eligibilitate cont:** Aplicabil.
- **Autentificare:** Nu depinde.
- **Allowance:** Nu consumă.
- **Utilizare partajată:** Nu se aplică.
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Reduce riscul: forceLoginMethod claudeai blochează la pornire credențialele API.
- **Risc de facturare API:** none
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Mecanism: fișier JSON în C:\Program Files\ClaudeCode\ (+ managed-settings.d/, drepturi admin) sau valoarea Settings din HKLM\SOFTWARE\Policies\ClaudeCode (HKCU doar ca rezervă, fără document admin). Chei utile: forceLoginMethod: claudeai (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN și apiKeyHelper sunt blocate la pornire; aplicat sesiunilor API-key din v2.1.147 și pe toate căile de login din v2.1.212), fastMode: false, permissions.disableBypassPermissionsMode, disableAutoMode, permissions.deny, availableModels/deniedModels (excluderea Fable), allowManagedHooksOnly, requiredMinimumVersion/requiredMaximumVersion (v2.1.163+) pentru fixarea versiunii CLI. \| Disponibil pe plan: da. \| Controlabil programatic: Hub poate genera conținutul; aplicarea cere admin (UAC). \| Reutilizabil din Hub: da, ca gardă deterministă de facturare. \| Interacțiune: proprietarul aplică fișierul. \| Securitate: modificare de configurare de sistem — doar cu aprobare explicită.
- **Suprafață nativă:** /status arată sursa politicii.
- **Cerințe locale:** Drepturi de administrator Windows.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Gardă de facturare și securitate independentă de corectitudinea adaptorului Hub.
- **Suprafață de execuție:** hub.local
- **Echivalent la celălalt ecosistem:** Configurare administrată Codex (neverificată în acest slice).
- **Ce face unic / mai bine:** Nu poate fi suprascrisă de setările user/proiect/--settings.
- **Securitate:** Din v2.1.259 un fișier sau o valoare HKLM neparsabilă oprește pornirea; pe 2.1.175 un managed-settings.json neparsabil era ignorat silențios (fail-open), deci JSON-ul se validează înainte de aplicare; o politică validă dar greșită poate bloca complet Claude Code.
- **Cale de implementare:** ASSISTED: Hub propune un fișier minim (forceLoginMethod claudeai, fastMode false, disableBypassPermissionsMode, deny git push), proprietarul îl aplică după revizuire.
- **Test necesar:** După aplicare: `claude auth status --json` și un turn aprobat; test că un ANTHROPIC_API_KEY fals blochează pornirea (fără inferență).
- **Status:** NEEDS_SETUP
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Documentația leagă aplicarea forceLoginMethod pe toate căile de login de v2.1.212+; comportamentul exact pe 2.1.175 trebuie verificat.
- **Surse citite:** https://code.claude.com/docs/en/managed-settings · https://code.claude.com/docs/en/authentication · https://code.claude.com/docs/en/fast-mode · https://code.claude.com/docs/en/model-config · https://code.claude.com/docs/en/feature-availability
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://code.claude.com/docs/en/managed-settings ; https://code.claude.com/docs/en/authentication ; CHANGELOG 2.1.147, 2.1.163, 2.1.212), securityConcerns (CHANGELOG 2.1.259 ; https://code.claude.com/docs/en/managed-settings)) — managed-settings confirmă căile Windows, HKLM/HKCU, precedența și cheile fail-closed; authentication confirmă blocarea credențialelor la pornire sub forceLoginMethod.

### Izolarea configurației per run (`--safe-mode`, `--setting-sources`, `--settings`, `--strict-mcp-config`) (`an-cc-safe-mode-isolation`)

- **Sursă oficială:** https://code.claude.com/docs/en/cli-reference
- **Documentație tehnică:** https://code.claude.com/docs/en/cli-reference
- **Ce face:** Pornește sesiuni fără personalizări (CLAUDE.md, skills, plugins, hooks, MCP, agents) păstrând autentificarea abonamentului, sau limitează sursele de setări încărcate.
- **Plan necesar:** Toate planurile.
- **Platformă:** Windows 11, CLI 2.1.175.
- **Rollout:** GA
- **Eligibilitate cont:** Max verificat.
- **Autentificare:** OAuth claude.ai (spre deosebire de --bare).
- **Allowance:** Nu consumă în sine.
- **Utilizare partajată:** Nu se aplică.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: `--safe-mode` (setează CLAUDE_CODE_SAFE_MODE=1; politica managed se aplică în continuare), `--setting-sources user` (exclude setările proiectului și local), `--settings '<json>'` (suprascrieri per sesiune, max 2 MiB), `--strict-mcp-config`, `--disable-slash-commands`; CLAUDE_CONFIG_DIR ar separa configurația, dar cere alt login. \| Disponibil pe plan: da. \| Controlabil programatic: da. \| Reutilizabil din Hub: da — alternativă la blocarea completă a workspace-urilor cu hooks/MCP (comportamentul actual al V2). \| Interacțiune: nu. \| Securitate: --safe-mode dezactivează și CLAUDE.md (pierdere de context); efectul exact în -p pe 2.1.175 trebuie verificat.
- **Suprafață nativă:** Nu se aplică.
- **Cerințe locale:** Niciuna.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Profil 'workspace neverificat' pentru run-urile Hub.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** CODEX_HOME izolat folosit de V2 la handshake-ul Codex.
- **Ce face unic / mai bine:** Izolare fără pierderea autentificării prin abonament.
- **Securitate:** --safe-mode dezactivează și CLAUDE.md (pierdere de context), dar documentația nu enumeră blocul `env` și helperele (apiKeyHelper, awsAuthRefresh) din setările de proiect printre elementele oprite; pentru repo-uri neverificate se combină cu `--setting-sources user`, care nu citește nici setările proiectului, nici .mcp.json; lista `--setting-sources` e propagată sesiunilor derivate (teammates, /bg, agents) abia din v2.1.281.
- **Cale de implementare:** WRAP: profil de lansare cu --safe-mode sau --setting-sources user + --strict-mcp-config pentru proiecte neaprobate; context de proiect furnizat de Hub prin --append-system-prompt.
- **Test necesar:** Test live aprobat: system/init fără plugins, hooks și MCP în modul safe.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** medium
- **Note:** Documentația confirmă că autentificarea, selecția modelului și uneltele încorporate funcționează normal în safe mode.
- **Surse citite:** https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/headless · https://code.claude.com/docs/en/memory · local: claude --help (--safe-mode, --setting-sources, --settings)
- **Verificare adversarială:** CORRECTED (corectat: securityConcerns (https://code.claude.com/docs/en/cli-reference ; https://code.claude.com/docs/en/permissions ; CHANGELOG 2.1.281)) — cli-reference confirmă --safe-mode (introdus în v2.1.169, deci prezent local; autentificarea și modelul funcționează normal, politica managed se aplică), --setting-sources și --settings ≤2 MiB; permissions recomandă explicit --setting-sources user pentru -p în repo-uri străine.

### /security-review și pluginul Claude Security (`an-cc-security-review`)

- **Sursă oficială:** https://code.claude.com/docs/en/claude-security
- **Documentație tehnică:** https://code.claude.com/docs/en/claude-security
- **Ce face:** /security-review face o trecere de securitate pe branch; pluginul claude-security rulează o scanare multi-agent cu raport MD/JSONL/SARIF și patch-uri revizuite, niciodată aplicate automat.
- **Plan necesar:** Plan plătit (workflows); se numără în limitele planului.
- **Platformă:** Windows, macOS, Linux.
- **Rollout:** GA (plugin din marketplace oficial)
- **Eligibilitate cont:** Max eligibil; pluginul nu este instalat.
- **Autentificare:** claude.ai.
- **Allowance:** Scanările pot consuma mult din cota Max.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu în sine.
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Mecanism: `/security-review` inclus; `/plugin install claude-security@claude-plugins-official` (schimbare de configurare), comanda `/claude-security` cere confirmare înainte de scanare; rezultate în CLAUDE-SECURITY-<timestamp>/ în repo, cu revision stamp. \| Disponibil pe plan: da. \| Controlabil programatic: parțial (confirmare interactivă). \| Reutilizabil din Hub: Hub pregătește scope-ul și ingerează SARIF/JSONL. \| Interacțiune: da. \| Securitate: scrie un director în repo; necesită python3 ≥3.9.
- **Suprafață nativă:** /claude-security, /security-review.
- **Cerințe locale:** python3 3.9+, git.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Audit de securitate operat de proprietar, cu rezultate importate în Hub.
- **Suprafață de execuție:** anthropic.claude_plugins
- **Echivalent la celălalt ecosistem:** Codex Security Cloud.
- **Ce face unic / mai bine:** Constatări verificate și SARIF standard.
- **Securitate:** Consum mare; director nou în repo.
- **Cale de implementare:** ASSISTED: instalare doar cu aprobare; Hub importă SARIF.
- **Test necesar:** Niciunul fără aprobare.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Produsul Claude Security gestionat este doar pentru Enterprise.
- **Surse citite:** https://code.claude.com/docs/en/claude-security · https://code.claude.com/docs/en/security-guidance
- **Verificare adversarială:** CONFIRMED — claude-security: plan plătit (workflows), Python 3.9+, Windows/macOS/Linux, confirmare înainte de scanare, rezultate MD/JSONL/SARIF într-un director cu .gitignore propriu, patch-uri niciodată aplicate automat, produsul gestionat doar pe Enterprise; commands: /security-review este inclus.

### Pluginul security-guidance (verificare în timpul scrierii) (`an-cc-security-guidance`)

- **Sursă oficială:** https://code.claude.com/docs/en/security-guidance
- **Documentație tehnică:** https://code.claude.com/docs/en/security-guidance
- **Ce face:** Hooks care verifică fiecare editare (pattern, fără model), fiecare turn (revizie model în fundal) și fiecare commit/push făcut de Claude (revizie agentică).
- **Plan necesar:** Toate planurile.
- **Platformă:** Windows, macOS, Linux.
- **Rollout:** GA
- **Eligibilitate cont:** Max eligibil; neinstalat.
- **Autentificare:** Sesiunea Claude Code.
- **Allowance:** Reviziile de turn și commit consumă cotă (Opus 4.7 implicit).
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu în sine.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: instalare din claude-plugins-official; la primul rulaj creează un venv în ~/.claude/security și instalează Claude Agent SDK prin pip (rețea și pachete); variabile ENABLE_PATTERN_RULES, ENABLE_STOP_REVIEW, ENABLE_COMMIT_REVIEW, SECURITY_GUIDANCE_DISABLE. \| Disponibil pe plan: da. \| Controlabil programatic: automat prin hooks. \| Reutilizabil din Hub: ca model de implementare pentru hooks proprii. \| Interacțiune: instalare. \| Securitate: instalează pachete; nu blochează scrieri.
- **Suprafață nativă:** Automat în sesiune.
- **Cerințe locale:** Python 3.10+ pentru revizia agentică, pip, rețea.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință pentru designul hooks de securitate ale Hub-ului.
- **Suprafață de execuție:** anthropic.claude_plugins
- **Echivalent la celălalt ecosistem:** Nu există echivalent direct documentat aici.
- **Ce face unic / mai bine:** Trei straturi de verificare.
- **Securitate:** Instalare de pachete; consum suplimentar.
- **Cale de implementare:** REFERENCE; instalare doar cu aprobarea proprietarului.
- **Test necesar:** Niciunul.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Pluginul oficial rulează Agent SDK local sub autentificarea sesiunii; nu constituie o clarificare de politică pentru produse terțe.
- **Surse citite:** https://code.claude.com/docs/en/security-guidance
- **Verificare adversarială:** CONFIRMED — security-guidance: trei straturi (pattern fără model, revizie la final de turn, revizie agentică la commit/push), Opus 4.7 implicit, venv în ~/.claude/security cu Agent SDK prin pip, Python 3.10+ pentru revizia agentică, nu blochează scrieri, disponibil pe toate planurile.

### Gărzi native de facturare în Claude Code aplicabile per proces (DISABLE_EXTRA_USAGE_COMMAND, DISABLE_UPGRADE_COMMAND, DISABLE_LOGIN_COMMAND/DISABLE_LOGOUT_COMMAND, CLAUDE_CODE_DISABLE_FAST_MODE, CLAUDE_CODE_DISABLE_1M_CONTEXT, CLAUDE_CODE_DISABLE_WORKFLOWS/disableWorkflows, availableModels, maxEffortLevel, switchModelsOnFlag) (`an-gap-cc-billing-guards`)

- **Sursă oficială:** https://code.claude.com/docs/en/env-vars
- **Documentație tehnică:** https://code.claude.com/docs/en/settings-reference
- **Ce face:** Set de variabile de mediu și chei de setări care: ascund comenzile de cumpărare și cont (/usage-credits, /upgrade, /login, /logout); dezactivează fast mode (pe Pro/Max se plătește exclusiv din usage credits, chiar dacă planul mai are alocare); dezactivează variantele de 1M (Sonnet 4.6 [1m] cere usage credits chiar și pe Max); opresc dynamic workflows (consum mare din limite); restrâng modelele selectabile (availableModels + enforceAvailableModels); plafonează effort (maxEffortLevel, cel mai mic plafon din orice sursă câștigă); switchModelsOnFlag=false face ca, în -p, o cerere semnalată de clasificator să se termine cu eroare în loc să comute automat modelul. Complementare: autoContinueAtUsageLimit=false, CLAUDE_CODE_RETRY_WATCHDOG (eșuează imediat la 429 care raportează usage credits epuizate), CLAUDE_CODE_DISABLE_ADVISOR_TOOL.
- **Plan necesar:** Oricare plan; gărzile sunt locale clientului, nu depind de plan.
- **Platformă:** Claude Code CLI (Windows, macOS, Linux); aceleași chei în Agent SDK și Desktop Code tab
- **Rollout:** GA. maxEffortLevel cere ≥2.1.267; autoContinueAtUsageLimit ≥2.1.234; deniedModels și availableModelsMatch sunt managed-only (≥2.1.283).
- **Eligibilitate cont:** Aplicabil contului Max local (OAuth claude.ai); nicio restricție de eligibilitate.
- **Autentificare:** Independent de autentificare; funcționează cu OAuth de abonament (sunt verificări locale ale CLI).
- **Allowance:** Nu consumă alocare; reduce consumul (fără workflows, effort plafonat).
- **Utilizare partajată:** N/A
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Reduc riscul de usage credits: fast mode, Sonnet 4.6 [1m] și Fable (după 07.07.2026 pe Max) se facturează din usage credits; în -p/SDK consimțământul pentru Fable nu apare și facturarea se face direct dacă usage credits sunt active. La proprietar usage credits sunt dezactivate, deci azi cererile ar eșua, nu s-ar factura. Ascunderea comenzilor nu schimbă setarea contului.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Per proces, fără modificarea configurației globale: în mediul copilului DISABLE_EXTRA_USAGE_COMMAND=1 (ascunde /usage-credits), DISABLE_UPGRADE_COMMAND=1, DISABLE_LOGIN_COMMAND=1, DISABLE_LOGOUT_COMMAND=1, CLAUDE_CODE_DISABLE_FAST_MODE=1, CLAUDE_CODE_DISABLE_1M_CONTEXT=1, CLAUDE_CODE_DISABLE_WORKFLOWS=1, CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1, plus --settings '{"availableModels":["opus","sonnet"],"enforceAvailableModels":true,"switchModelsOnFlag":false,"disableWorkflows":true,"autoContinueAtUsageLimit":false,"maxEffortLevel":"high"}'. --settings stă peste user/project/local și sub managed, durează o sesiune și nu scrie fișiere. availableModels se concatenează între scope-urile non-managed (user/project/local și --settings); doar lista managed o înlocuiește; deniedModels/availableModelsMatch sunt managed-only (≥2.1.283). CLAUDE_CODE_RETRY_WATCHDOG NU se recomandă pe 2.1.175: documentația cere ≥2.1.186, eșecul imediat la un 429 care raportează usage credits epuizate există doar de la 2.1.239 (înainte reîncerca la nesfârșit), iar watchdog-ul așteaptă resetarea ferestrei de utilizare, deci un run Hub poate rămâne blocat ore întregi. autoContinueAtUsageLimit (≥2.1.234) privește sesiunile interactive (citit din user, --settings și managed); maxEffortLevel cere ≥2.1.267; ambele lipsesc din 2.1.175.
- **Suprafață nativă:** /config, ~/.claude/settings.json, variabile de shell, managed settings
- **Cerințe locale:** CLI local 2.1.175: binarul conține numele DISABLE_EXTRA_USAGE_COMMAND, DISABLE_UPGRADE_COMMAND, DISABLE_LOGIN_COMMAND, DISABLE_LOGOUT_COMMAND, CLAUDE_CODE_DISABLE_FAST_MODE, CLAUDE_CODE_DISABLE_WORKFLOWS, disableWorkflows, CLAUDE_CODE_DISABLE_1M_CONTEXT, availableModels, enforceAvailableModels, switchModelsOnFlag, CLAUDE_CODE_RETRY_WATCHDOG, CLAUDE_CODE_DISABLE_ADVISOR_TOOL; lipsesc maxEffortLevel și autoContinueAtUsageLimit.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Strat de apărare în profunzime în adaptorul Claude V2, alături de verificarea evenimentului system/init (apiKeySource, model).
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Codex: allowlist JSON-RPC care blochează metodele de credit/login/config și refuzul rutei la sold de credit pozitiv (oa-codex-app-server-side-effect-methods, oa-credits-flexible-usage, oa-credits-auto-reload).
- **Ce face unic / mai bine:** Gărzi oficiale, documentate, aplicabile per proces fără schimbare globală; maxEffortLevel este aplicat de client înaintea fiecărei cereri, pe orice furnizor.
- **Securitate:** Nu sunt o barieră de facturare reală: singura barieră rămâne setarea contului (usage credits off). Un bloc env din ~/.claude/settings.json poate suprascrie mediul copilului (vezi an-gap-cc-settings-env-helper-neutralization).
- **Cale de implementare:** Extinderea constructorului de mediu al adaptorului V2 cu lista de gărzi și generarea unui JSON --settings inline; test unitar care verifică argv/env fără a porni modelul.
- **Test necesar:** Test fără model (argv/env). În LIVE_VALIDATION aprobat: /fast raportează indisponibil, un model sonnet[1m] este refuzat, fără comutare automată de model la semnalare.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** medium
- **Note:** an-plan-purchase-flows descrie fluxurile de cumpărare; acest record acoperă blocarea lor. Hub-ul setează deja CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1. Pe 2.1.175 aliasul sonnet rezolvă la un model anterior Sonnet 5 (schimbarea la Sonnet 5 a venit în 2.1.197), iar Sonnet 4.6 [1m] cere usage credits pe toate planurile, inclusiv Max, deci CLAUDE_CODE_DISABLE_1M_CONTEXT=1 este justificat azi. După un upgrade la ≥2.1.284 trebuie reevaluat: variabila ține și Sonnet 5.5/Fable (1M nativ, fără usage credits) la 200K. Există și comanda ascunsă /rate-limit-options, care oferă usage credits sau upgrade la atingerea limitei; nu are o variabilă DISABLE documentată.
- **Surse citite:** https://code.claude.com/docs/en/env-vars.md · https://code.claude.com/docs/en/settings-reference.md · https://code.claude.com/docs/en/settings.md · https://code.claude.com/docs/en/fast-mode.md · https://code.claude.com/docs/en/model-config.md · https://code.claude.com/docs/en/commands.md · https://code.claude.com/docs/en/workflows.md · local: claude.exe 2.1.175 (căutare de șiruri în binar, fără rulare de model)
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://code.claude.com/docs/en/env-vars.md ; https://code.claude.com/docs/en/settings-reference.md ; https://code.claude.com/docs/en/model-config.md#merge-behavior ; https://code.claude.com/docs/en/interactive-mode.md), notes (https://code.claude.com/docs/en/model-config.md ; https://code.claude.com/docs/en/env-vars.md ; https://code.claude.com/docs/en/commands.md)) — Toate numele de variabile și chei au fost găsite în documentația oficială actuală (env-vars, settings-reference, fast-mode, model-config). Confirmat: fast mode pe Pro/Max se plătește exclusiv din usage credits; switchModelsOnFlag=false face ca în -p cererea semnalată să se termine cu eroare; maxEffortLevel: cel mai mic plafon câștigă, inclusiv din --settings. Corectat: nuanțele de versiune și riscul CLAUDE_CODE_RETRY_WATCHDOG pe 2.1.175. Statusul AVAILABLE rămâne valabil pentru nucleul de gărzi prezent în 2.1.175.

### Neutralizarea blocului env, a apiKeyHelper și a hook-urilor din fișierele de setări în rulările claude -p lansate de Hub (`an-gap-cc-settings-env-helper-neutralization`)

- **Sursă oficială:** https://code.claude.com/docs/en/permissions
- **Documentație tehnică:** https://code.claude.com/docs/en/settings-reference
- **Ce face:** În -p, care nu afișează niciodată dialogul de încredere, blocul env și helper-ele din setările de proiect (apiKeyHelper, awsAuthRefresh), hook-urile și allowed-tools ale skill-urilor de proiect se aplică la pornire. Valorile env din setări suprascriu variabilele moștenite din shell. apiKeyHelper trimite ieșirea ca X-Api-Key și Bearer, deci mută facturarea pe API; ANTHROPIC_BASE_URL poate trimite cererile (inclusiv cu login-ul claude.ai) către alt endpoint; CLAUDE_CODE_USE_* schimbă furnizorul. Contramăsuri documentate: --setting-sources user (nu citește setările de proiect/local și .mcp.json), --settings (peste user/project/local, sub managed), o valoare goală care anulează o variabilă pentru selecția furnizorului, --settings '{"disableAllHooks":true}', disabledMcpjsonServers.
- **Plan necesar:** Oricare
- **Platformă:** Claude Code CLI / Agent SDK
- **Rollout:** GA; ignorarea variabilelor de export OpenTelemetry din setările de proiect cere ≥2.1.282; ignorarea CLAUDE_CONFIG_DIR etc. din proiect ≥2.1.251.
- **Eligibilitate cont:** Aplicabil
- **Autentificare:** OAuth de abonament; riscul este tocmai trecerea neintenționată la API key/apiKeyHelper sau la alt endpoint.
- **Allowance:** N/A
- **Utilizare partajată:** N/A
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Fără neutralizare, un apiKeyHelper sau un ANTHROPIC_API_KEY din setări produce facturare API; un CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY produce facturare la furnizorul cloud.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Per proces: --setting-sources user (deja în Hub) + --settings '{"disableAllHooks":true,"env":{"ANTHROPIC_API_KEY":"","ANTHROPIC_AUTH_TOKEN":"","ANTHROPIC_BASE_URL":"","CLAUDE_CODE_USE_BEDROCK":"","CLAUDE_CODE_USE_VERTEX":"","CLAUDE_CODE_USE_FOUNDRY":"","CLAUDE_CODE_OAUTH_TOKEN":""}}'. Efectul valorii goale este documentat doar pentru selecția furnizorului; pentru ANTHROPIC_BASE_URL și ANTHROPIC_API_KEY trebuie testat. apiKeyHelper din user settings nu are o anulare documentată per proces; detecția rămâne apiKeySource din system/init (deja implementată). Varianta completă: --restricted (≥2.1.248) încarcă doar managed + --settings. --bare citește apiKeyHelper doar din --settings, dar cere API key, deci rămâne interzis.
- **Suprafață nativă:** Dialogul de încredere a spațiului de lucru (doar interactiv)
- **Cerințe locale:** --setting-sources și --settings există în 2.1.175 (claude --help).
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Parte din profilul de izolare al adaptorului Claude V2.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Codex: refuzul conturilor API key și blocarea metodelor de scriere config în app-server; config.toml de proiect este tratat similar prin profile controlate de Hub.
- **Ce face unic / mai bine:** Tabelul oficial „What runs before you trust a folder” spune exact ce se execută în -p fără încredere.
- **Securitate:** Vectorul user (~/.claude/settings.json: env, apiKeyHelper, hooks, pluginuri activate, skill-uri) rămâne activ sub --setting-sources user. Hook-urile și allowed-tools ale unui skill de proiect sunt folosite în -p fără încredere.
- **Cale de implementare:** Adăugare --settings generat (disableAllHooks + env gol pentru variabilele de furnizor/credențiale) și extinderea verificării init la model/apiProvider; migrare ulterioară la --restricted după upgrade aprobat.
- **Test necesar:** Test fără model pentru argv; în LIVE_VALIDATION: rulare cu un ~/.claude/settings.json de test (profil separat) care conține ANTHROPIC_BASE_URL, pentru a confirma că valoarea goală din --settings câștigă.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** medium
- **Note:** Contradicție de semnalat: decizia Hub „--setting-sources user” exclude proiectul, dar lasă activ vectorul user; verificarea apiKeySource prinde cheile și apiKeyHelper, nu și ANTHROPIC_BASE_URL sau schimbarea furnizorului. Nu am citit ~/.claude/settings.json (regulă de confidențialitate).
- **Surse citite:** https://code.claude.com/docs/en/permissions.md · https://code.claude.com/docs/en/settings-reference.md · https://code.claude.com/docs/en/settings.md · https://code.claude.com/docs/en/env-vars.md · https://code.claude.com/docs/en/model-config.md · https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan
- **Verificare adversarială:** CONFIRMED — Confirmat în permissions.md (tabelul What runs before you trust a folder: în -p, hook-urile, blocul env, apiKeyHelper, hook-urile și allowed-tools ale skill-urilor de proiect sunt folosite) și în contramăsurile documentate (--setting-sources user, --bare, --settings disableAllHooks, disabledMcpjsonServers). settings-reference: valoarea din env suprascrie exportul din shell; șirul gol este tratat ca nesetat doar pentru selecția furnizorului, iar subprocesele moștenesc valoarea goală. Pragurile de versiune (2.1.251 pentru CLAUDE_CONFIG_DIR etc., 2.1.282 pentru OpenTelemetry) sunt corecte. --bare nu citește niciodată OAuth și cere ANTHROPIC_API_KEY sau apiKeyHelper în --settings, deci rămâne interzis.

### Modul restricționat pentru harness-uri: --restricted / CLAUDE_CODE_RESTRICTED=1 (`an-gap-cc-restricted-mode`)

- **Sursă oficială:** https://code.claude.com/docs/en/cli-reference
- **Documentație tehnică:** https://code.claude.com/docs/en/whats-new/2026-w35
- **Ce face:** Pornește Claude Code fără uneltele built-in care rulează comenzi sau cod și fără WebFetch, cu excepția celor numite individual în --tools (nu prin presetul default); limitează uneltele de fișiere la directoarele de lucru; încarcă doar managed settings și --settings (nu user, project sau local); refuză bypassPermissions; refuză crearea de sesiuni cloud chiar pe client. CLAUDE_CODE_RESTRICTED este citit doar din mediul de lansare, nu din blocul env al setărilor.
- **Plan necesar:** Oricare
- **Platformă:** Claude Code CLI
- **Rollout:** GA de la v2.1.248 (anunțat în săptămâna 35, 24–28.08.2026)
- **Eligibilitate cont:** Aplicabil după upgrade
- **Autentificare:** Nedocumentat explicit pentru OAuth; credențialele stau în .credentials.json, nu în setări, deci ar trebui să funcționeze cu abonamentul (de testat).
- **Allowance:** Consumă alocarea planului doar când Hub rulează modelul.
- **Utilizare partajată:** Alocarea comună Max (Claude + Claude Code)
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Scade riscul: nu se încarcă env/apiKeyHelper din setările user/project.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** claude -p --restricted --tools "Read,Edit,Write,Glob,Grep[,Bash]" --settings <JSON Hub> --output-format stream-json ... sau CLAUDE_CODE_RESTRICTED=1 în mediul copilului. Per proces, fără schimbare globală.
- **Suprafață nativă:** Niciuna (flag de CLI)
- **Cerințe locale:** Lipsește în 2.1.175 (nu apare în claude --help, iar șirul CLAUDE_CODE_RESTRICTED lipsește din binar). Necesită upgrade aprobat la ≥2.1.248.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Profil implicit al adaptorului Claude după upgrade: închide vectorul setărilor user și limitează uneltele la ce aprobă Hub-ul.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Codex: sandbox și permission profiles controlate prin app-server (oa-codex-sandbox-permissions).
- **Ce face unic / mai bine:** Un singur flag oficial care combină izolarea setărilor, a uneltelor și refuzul sesiunilor cloud.
- **Securitate:** Numirea Bash în --tools readuce execuția de comenzi; comportamentul pentru CLAUDE.md și auto memory nu este documentat.
- **Cale de implementare:** După upgrade: înlocuirea --setting-sources user cu --restricted + --settings generat; păstrarea verificării init.
- **Test necesar:** LIVE_VALIDATION aprobat: autentificare OAuth în mod restricționat, apiKeySource=none, lista de unelte din init.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** WRAP
- **Încredere:** medium
- **Note:** Distinct de an-cc-bare-mode (cere API key) și de an-cc-safe-mode-isolation (încarcă setările user). Candidat direct pentru Hub, dar cere un CLI mai nou decât 2.1.175.
- **Surse citite:** https://code.claude.com/docs/en/cli-reference.md · https://code.claude.com/docs/en/env-vars.md · https://code.claude.com/docs/en/settings-reference.md · https://code.claude.com/docs/en/errors.md · https://code.claude.com/docs/en/whats-new/2026-w35.md · local: claude --help (2.1.175)
- **Verificare adversarială:** CONFIRMED — cli-reference și whats-new săptămâna 35 (24–28.08.2026) confirmă --restricted/CLAUDE_CODE_RESTRICTED ≥2.1.248: elimină uneltele care rulează comenzi sau cod și WebFetch dacă nu sunt numite individual în --tools, limitează uneltele de fișiere la directoarele de lucru, încarcă doar managed și --settings, refuză bypassPermissions și crearea de sesiuni cloud; variabila este ignorată în blocul env al oricărui fișier de setări. Comportamentul OAuth în modul restricționat nu este documentat. Documentația Agent SDK spune că auto memory și ~/.claude.json se citesc indiferent de sursele de setări, deci Hub-ul ar trebui să adauge CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 (de testat în modul restricționat).

### disableSideloadFlags (managed): respingerea --plugin-dir, --plugin-url, --agents și --mcp-config la pornire (`an-gap-cc-disable-sideload-flags`)

- **Sursă oficială:** https://code.claude.com/docs/en/managed-settings
- **Documentație tehnică:** https://code.claude.com/docs/en/settings-reference
- **Ce face:** Cheie managed-only (≥2.1.193): Claude Code iese cu o eroare care numește flag-urile respinse (--plugin-dir, --plugin-url, --agents, --mcp-config), inclusiv când alte suprafețe le trimit intern (sesiuni locale Cowork). Acceptă totuși un --mcp-config ale cărui servere sunt toate type sdk. De la 2.1.280 acoperă și CLAUDE_CODE_PLUGIN_DIRS. În sesiunile cloud nu oprește pornirea, ci elimină serverele livrate prin --mcp-config, cu excepția celor sdk și a uneltelor Slack din Claude Tag.
- **Plan necesar:** Orice plan cu managed settings (fișier, registru, MDM sau server-managed pentru Team/Enterprise)
- **Platformă:** Claude Code CLI
- **Rollout:** GA de la v2.1.193
- **Eligibilitate cont:** Nu se aplică azi: pe mașină nu există managed settings.
- **Autentificare:** Independent
- **Allowance:** N/A
- **Utilizare partajată:** N/A
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Nu
- **Risc de facturare API:** none
- **Integrare programatică:** NONE
- **Detaliu integrare:** Nu se poate aplica per proces (scope Managed). Hub nu o setează, ci o detectează: preflight care recunoaște ieșirea cu eroare de sideload și marchează ruta BLOCKED cu motivul. Nedocumentat: dacă un --mcp-config gol ({"mcpServers":{}}) trece drept „toate serverele sdk” și dacă --strict-mcp-config fără --mcp-config este valid.
- **Suprafață nativă:** managed-settings.json, registru Windows, MDM
- **Cerințe locale:** Niciuna azi; riscul apare doar după un upgrade și dacă proprietarul sau o organizație instalează managed settings.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Risc de compatibilitate înregistrat în preflight-ul adaptorului.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Codex: requirements.toml / politici administrate care pot bloca opțiuni de configurare.
- **Ce face unic / mai bine:** Închide ocolirea strictKnownMarketplaces printr-un singur flag de organizație.
- **Securitate:** Blochează strategia WRAP a Hub-ului, care trimite --strict-mcp-config cu --mcp-config.
- **Cale de implementare:** Test de preflight fără model; mesaj clar în UI; documentarea alternativei în runbook.
- **Test necesar:** Doar dacă se activează managed settings: pornire cu --mcp-config gol și observarea codului de ieșire.
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Contradicție potențială cu decizia Hub „--strict-mcp-config --mcp-config cu configurație goală”: dacă disableSideloadFlags devine activ, adaptorul nu mai pornește. an-cc-managed-settings nu consemnează acest risc.
- **Surse citite:** https://code.claude.com/docs/en/managed-settings.md · https://code.claude.com/docs/en/settings-reference.md · https://code.claude.com/docs/en/mcp.md · local: absența managed settings (C:\Program Files\ClaudeCode, HKLM/HKCU\SOFTWARE\Policies\ClaudeCode) · local: șirul disableSideloadFlags lipsește din binarul 2.1.175
- **Verificare adversarială:** CONFIRMED — settings-reference confirmă disableSideloadFlags (managed-only, ≥2.1.193): respinge --plugin-dir, --plugin-url, --agents, --mcp-config, se aplică și sesiunilor locale Cowork, acceptă un --mcp-config cu servere exclusiv type sdk, acoperă CLAUDE_CODE_PLUGIN_DIRS de la 2.1.280, iar în sesiunile cloud elimină serverele livrate. Cazul unui --mcp-config gol rămâne nedocumentat.

### CLAUDE_CONFIG_DIR + CLAUDE_CODE_PROJECT_DIR_NAME: stare nativă separată pentru rulările Hub (`an-gap-cc-config-dir-isolation`)

- **Sursă oficială:** https://code.claude.com/docs/en/env-vars
- **Documentație tehnică:** https://code.claude.com/docs/en/sessions
- **Ce face:** CLAUDE_CONFIG_DIR mută setările, istoricul sesiunilor, pluginurile și fișierul .credentials.json într-un alt director, deci cere un login separat. CLAUDE_CODE_PROJECT_DIR_NAME (≥2.1.234, doar împreună cu CLAUDE_CONFIG_DIR și doar din mediul de lansare) fixează numele directorului projects/<nume> pentru transcrieri și auto memory, util pentru o gazdă care dă fiecărei sesiuni propriul director. Ambele sunt ignorate în env-ul setărilor de proiect/local; CLAUDE_CODE_SUBPROCESS_ENV_SCRUB (≥2.1.251) scoate CLAUDE_CONFIG_DIR din subprocese.
- **Plan necesar:** Oricare
- **Platformă:** Claude Code CLI
- **Rollout:** CLAUDE_CONFIG_DIR GA de mult timp; CLAUDE_CODE_PROJECT_DIR_NAME ≥2.1.234
- **Eligibilitate cont:** Aplicabil; noul director cere autentificarea contului Max în el.
- **Autentificare:** OAuth claude.ai prin login interactiv în noul director (sau CLAUDE_CODE_OAUTH_TOKEN, pe care Hub-ul îl interzice azi).
- **Allowance:** Aceeași alocare Max
- **Utilizare partajată:** Comună cu toate suprafețele Claude ale contului
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu, dacă noul director nu primește setări cu API key.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Per proces: CLAUDE_CONFIG_DIR=<director de stare Hub> și CLAUDE_CODE_PROJECT_DIR_NAME=<id misiune> în mediul copilului; nu modifică ~/.claude. Oglindirea claude agents --json trebuie rulată cu același CLAUDE_CONFIG_DIR ca să vadă sesiunile Hub; sesiunile native ale proprietarului rămân în ~/.claude. Retenția cleanupPeriodDays (implicit 30 de zile) se aplică per director.
- **Suprafață nativă:** Variabilă de shell
- **Cerințe locale:** CLI local are CLAUDE_CONFIG_DIR; CLAUDE_CODE_PROJECT_DIR_NAME lipsește din 2.1.175. Login separat aprobat de proprietar.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Opțiune de izolare a transcrierilor, memoriei și setărilor native ale rulărilor Hub față de sesiunile interactive ale proprietarului.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** CODEX_HOME pentru Codex (director de configurare separat).
- **Ce face unic / mai bine:** Separare completă de setări user, pluginuri, skill-uri sincronizate și transcrieri, fără a schimba configurația globală.
- **Securitate:** Al doilea fișier .credentials.json în profilul utilizatorului; Hub-ul nu trebuie să-l citească. Login-ul este o acțiune de cont care cere aprobarea explicită a proprietarului.
- **Cale de implementare:** Propunere către proprietar; după aprobare: director dedicat, login interactiv făcut de proprietar, variabilele adăugate în adaptor și în oglinda claude agents.
- **Test necesar:** După login aprobat: claude auth status --json cu CLAUDE_CONFIG_DIR setat (fără model) și o rulare LIVE_VALIDATION.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** WRAP
- **Încredere:** medium
- **Note:** Alternativă mai simplă după upgrade: --restricted (nu citește setările user). Nicio decizie Hub existentă nu este contrazisă.
- **Surse citite:** https://code.claude.com/docs/en/env-vars.md · https://code.claude.com/docs/en/sessions.md · https://code.claude.com/docs/en/authentication.md · https://code.claude.com/docs/en/settings-reference.md · https://code.claude.com/docs/en/claude-directory.md
- **Verificare adversarială:** CONFIRMED — env-vars confirmă CLAUDE_CONFIG_DIR (ignorat în setările de proiect/local) și CLAUDE_CODE_PROJECT_DIR_NAME (≥2.1.234, doar cu CLAUDE_CONFIG_DIR, citit doar din mediul de lansare și ignorat în orice fișier). authentication.md confirmă că pe Windows .credentials.json stă în %USERPROFILE%\.claude, iar cu CLAUDE_CONFIG_DIR se mută în noul director (login separat). CLAUDE_CODE_SUBPROCESS_ENV_SCRUB elimină CLAUDE_CONFIG_DIR din subprocese de la 2.1.251. ~/.claude.json se relochează tot prin CLAUDE_CONFIG_DIR.

### Scanarea de securitate pentru skill-uri și pluginuri terțe (Enterprise, beta) (`an-gap-skill-plugin-security-scanning`)

- **Sursă oficială:** https://support.claude.com/en/articles/15927065-get-started-with-skill-and-plugin-scanning
- **Documentație tehnică:** https://support.claude.com/en/articles/15927065-get-started-with-skill-and-plugin-scanning
- **Ce face:** La încărcarea sau editarea unui skill ori plugin terț, Claude îi analizează conținutul și returnează pass, warn sau fail; fail blochează elementul fără posibilitate de aprobare. Nu scanează elementele existente dinainte de activare, skill-urile create cu Claude, skill-urile livrate prin MCP, serverele MCP și hook-urile, nici organizațiile cu CMEK/ZDR/HIPAA. Implicit oprită până la 02.10.2026, când pornește pentru organizațiile Enterprise care nu au setat-o; fără cost suplimentar.
- **Plan necesar:** Enterprise
- **Platformă:** Claude, Claude Cowork, marketplace-uri Enterprise de pluginuri
- **Rollout:** Beta (06.08.2026)
- **Eligibilitate cont:** Nu este disponibilă pe Max.
- **Autentificare:** N/A
- **Allowance:** N/A
- **Utilizare partajată:** N/A
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Nu
- **Risc de facturare API:** none
- **Integrare programatică:** NONE
- **Detaliu integrare:** Fără API; rezultatele apar în Organization settings > Plugins & skills.
- **Suprafață nativă:** Organization settings > Plugins & skills > Policy/Inventory/Requests
- **Cerințe locale:** N/A
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Referință de design pentru verificarea proprie a Hub-ului înainte de a accepta skill-uri sau pluginuri terțe.
- **Suprafață de execuție:** anthropic.claude_skills
- **Echivalent la celălalt ecosistem:** Review-ul de pluginuri din directorul OpenAI (oa-plugin-builder-submission).
- **Ce face unic / mai bine:** Scanare automată la încărcare, cu cache și blocare fermă.
- **Securitate:** Nu acoperă MCP și hook-urile, deci chiar și pe Enterprise Hub-ul ar avea nevoie de verificare proprie.
- **Cale de implementare:** Hub: verificare statică a SKILL.md și a scripturilor (comenzi inline, rețea, fișiere sensibile), validare de format (skills-ref, claude plugin validate) și aprobare explicită a proprietarului înainte de activare.
- **Test necesar:** Teste unitare pentru regulile de verificare ale Hub-ului.
- **Status:** PLAN_RESTRICTED
- **Decizie Hub:** REIMPLEMENT
- **Încredere:** high
- **Note:** Legat de std-agent-skills-* și an-cc-plugins.
- **Surse citite:** https://support.claude.com/en/articles/15927065-get-started-with-skill-and-plugin-scanning · https://support.claude.com/en/articles/12138966-release-notes
- **Verificare adversarială:** CONFIRMED — Articolul de suport și release notes („Skill and plugin security scanning (beta)”) confirmă: doar Enterprise, rezultate pass/warn/fail, fail nu poate fi aprobat nici de admin, activare implicită pe 02.10.2026 pentru organizațiile care nu au setat-o, fără cost suplimentar, excluderile listate (elemente existente, skill-uri create cu Claude, skill-uri prin MCP, servere MCP și hook-uri, organizații CMEK/ZDR/HIPAA).

### Watermark-ul textului generat de Claude și content credentials C2PA pentru fișiere (`an-gap-text-watermark-c2pa`)

- **Sursă oficială:** https://www.anthropic.com/news/claude-text-watermark
- **Documentație tehnică:** https://www.anthropic.com/claude-fable-and-mythos-5-1
- **Ce face:** Pentru conformitatea cu EU AI Act, textul modelelor lansate după 02.08.2026 (de exemplu Fable 5.1, Mythos 5.1, Opus 5.5, Sonnet 5.5) conține un watermark statistic în stilul SynthID-Text: nu adaugă caractere sau tokeni, nu schimbă calitatea sau costul, nu identifică utilizatorul și se aplică global. Este mai slab în cod și pe texte scurte sau puțin editate; o rescriere completă îl elimină. Fișierele generate de tipuri acceptate (png, jpg, svg) primesc metadate C2PA semnate. Detecția se face printr-un API în private preview, disponibil doar organizațiilor eligibile.
- **Plan necesar:** Se aplică automat tuturor planurilor și suprafețelor pentru modelele noi
- **Platformă:** Toate suprafețele Claude
- **Rollout:** Activ pentru modelele lansate după 02.08.2026; API-ul de detecție în private preview
- **Eligibilitate cont:** Watermark-ul se aplică; API-ul de detecție nu este disponibil proprietarului.
- **Autentificare:** N/A
- **Allowance:** Fără cost suplimentar
- **Utilizare partajată:** N/A
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Nu
- **Risc de facturare API:** none
- **Integrare programatică:** NONE
- **Detaliu integrare:** Nu există control de dezactivare; Hub nu poate verifica watermark-ul. Metadatele C2PA din fișiere pot fi citite cu orice instrument compatibil C2PA.
- **Suprafață nativă:** Niciuna (invizibil)
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Referință pentru proveniența livrabilelor Hub către clienți: Hub înregistrează singur implicarea AI (model, run, aprobări) și nu se bazează pe detecție.
- **Suprafață de execuție:** none
- **Echivalent la celălalt ecosistem:** Marcajele OpenAI pentru conținut AI (C2PA la imagini); nu există record OpenAI echivalent în inventar.
- **Ce face unic / mai bine:** Nu afectează calitatea și nu conține date despre utilizator.
- **Securitate:** Livrabilele text către clienți din UE pot fi detectate ca generate de Claude; metadatele C2PA din imagini semnalează implicarea Claude.
- **Cale de implementare:** Câmp de proveniență în registrul de livrabile al Hub-ului; notă în politica de livrare către clienți.
- **Test necesar:** Niciunul
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Anunțul spune că watermark-ul se aplică modelelor lansate după 02.08.2026 și că modelele mai vechi vor fi adăugate în lunile următoare, deci și ieșirile Opus 4.8 obținute prin aliasurile CLI 2.1.175 pot primi watermark ulterior. Hub-ul trebuie să presupună că orice text Claude livrat clienților poate fi detectabil.
- **Surse citite:** https://www.anthropic.com/news/claude-text-watermark · https://www.anthropic.com/claude-fable-and-mythos-5-1
- **Verificare adversarială:** CORRECTED (corectat: notes (https://www.anthropic.com/news/claude-text-watermark)) — Confirmat: motivul EU AI Act, fără tokeni sau cost suplimentar și fără impact pe calitate, fără date despre utilizator, slab pe cod, texte scurte sau rescrise complet, C2PA pentru png/jpg/svg, API de detecție în private preview pentru organizații eligibile, fără opt-out menționat. Corectată nota care presupunea că modelele mai vechi rămân fără watermark.

### Enterprise Frontier Safeguards (EFS): confidențialitate de tip ZDR plus detecție de abuz, cu date în cloud-ul clientului (`an-gap-enterprise-frontier-safeguards`)

- **Sursă oficială:** https://www.anthropic.com/news/enterprise-frontier-safeguards
- **Documentație tehnică:** https://www.anthropic.com/claude-fable-and-mythos-5-1
- **Ce face:** Combină confidențialitatea unei politici zero data retention cu safeguards de detecție a abuzului pentru modelele Mythos-class, stocând datele în infrastructura cloud controlată de client. Este suportat pe Claude Code, Claude Enterprise, Claude Platform, Amazon Bedrock, Claude Platform on AWS, Google Agent Platform și Microsoft Foundry; până la lansare, clienții eligibili primesc ZDR pentru Fable 5 și Fable 5.1.
- **Plan necesar:** Clienți enterprise (Claude Enterprise / Platform / cloud)
- **Platformă:** Enterprise și cloud
- **Rollout:** Lansare în etape, începând din toamna lui 2026
- **Eligibilitate cont:** Nu se aplică contului Max.
- **Autentificare:** N/A
- **Allowance:** N/A
- **Utilizare partajată:** N/A
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Serviciu enterprise separat.
- **Risc de facturare API:** high
- **Integrare programatică:** NONE
- **Detaliu integrare:** Indisponibil pe planul actual.
- **Suprafață nativă:** Contract enterprise
- **Cerințe locale:** N/A
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință pentru politica de date a clienților enterprise ai Ifrim Digital.
- **Suprafață de execuție:** none
- **Echivalent la celălalt ecosistem:** oa-private-safety-processing (ZDR with PSP).
- **Ce face unic / mai bine:** Datele rămân în cloud-ul clientului, cu safeguards active.
- **Securitate:** N/A
- **Cale de implementare:** Niciuna
- **Test necesar:** Niciunul
- **Status:** PLAN_RESTRICTED
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** high
- **Note:** Anunț din 01.09.2026.
- **Surse citite:** https://www.anthropic.com/news/enterprise-frontier-safeguards · https://www.anthropic.com/claude-fable-and-mythos-5-1
- **Verificare adversarială:** CONFIRMED — Anunțul din 01.09.2026 confirmă: EFS combină confidențialitatea ZDR cu detecția de abuz, datele stau în cloud-ul clientului, lansare în etape din toamna lui 2026, ZDR pentru Fable 5 și Fable 5.1 pentru clienții eligibili până la lansare, suport pe Claude Code, Claude Enterprise, Claude Platform, Bedrock, Claude Platform on AWS, Agent Platform și Foundry.

## skills

### Skills Claude Code (.claude/skills/<nume>/SKILL.md) (`an-cc-skills`)

- **Sursă oficială:** https://code.claude.com/docs/en/skills
- **Documentație tehnică:** https://code.claude.com/docs/en/skills
- **Ce face:** Proceduri încărcate la cerere de model sau invocate cu /nume; pot rula într-un subagent (context: fork), pot pre-aproba unelte și injecta ieșirea unor comenzi (!`cmd`).
- **Plan necesar:** Toate planurile.
- **Platformă:** Local; în cloud doar skills din repo sau din contul claude.ai.
- **Rollout:** GA
- **Eligibilitate cont:** Max verificat.
- **Autentificare:** OAuth claude.ai.
- **Allowance:** Corpul skill-ului consumă context doar la utilizare.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: locații managed > ~/.claude/skills > .claude/skills, plus plugin și --add-dir; skills sincronizate din claude.ai apar din v2.1.273 (absent local). Frontmatter: name, description, argument-hint, arguments, disable-model-invocation, user-invocable, allowed-tools, disallowed-tools, model, effort, context, agent, background, hooks, paths, shell, metadata. În -p, `/skill-name` în prompt se expandează; `--disable-slash-commands` le oprește; disableSkillShellExecution blochează !`cmd`. \| Disponibil pe plan: da. \| Controlabil programatic: da. \| Reutilizabil din Hub: Hub poate livra skills proprii prin --plugin-dir sau în repo (cu aprobare pentru fișiere). \| Interacțiune: nu. \| Securitate: !`cmd` execută shell la invocare (verificat de reguli); skills din repo neîncredere; allowed-tools extinde permisiunile pe durata turn-ului.
- **Suprafață nativă:** Meniul /, /skills.
- **Cerințe locale:** Git Bash pentru shell: bash; altfel shell: powershell.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Procedurile standard ale Hub (runbook-uri, verificări) livrate ca skills portabile.
- **Suprafață de execuție:** anthropic.claude_skills
- **Echivalent la celălalt ecosistem:** Codex skills (skill_search activ local).
- **Ce face unic / mai bine:** Standard Agent Skills portabil; încărcare progresivă.
- **Securitate:** Execuție de comenzi din conținutul skill-ului (!`cmd`); în -p, fără workspace trust, hooks și `allowed-tools` din skills de proiect sunt folosite (trust-ul nu limitează niciodată allowed-tools); un skill de proiect cu același nume înlocuiește comanda bundled (ex. `code-review`); din v2.1.273 skills sincronizate din claude.ai se descarcă și în run-urile terminal/-p dacă `--setting-sources` include `user` și sesiunea nu e --safe-mode/--bare.
- **Cale de implementare:** REUSE_NATIVE: skills Hub versionate, încărcate per run prin plugin local; disableSkillShellExecution pentru skills de proiect neverificate.
- **Test necesar:** Validare statică a frontmatter-ului; live doar cu grant.
- **Status:** AVAILABLE
- **Decizie Hub:** REUSE_NATIVE
- **Încredere:** high
- **Note:** Contul claude.ai are skills activate (docx, pdf etc.), dar sincronizarea în CLI cere v2.1.273+.
- **Surse citite:** https://code.claude.com/docs/en/skills · https://code.claude.com/docs/en/headless · https://code.claude.com/docs/en/plugins/manifest-reference
- **Verificare adversarială:** CORRECTED (corectat: securityConcerns (https://code.claude.com/docs/en/permissions ; https://code.claude.com/docs/en/skills)) — skills confirmă locațiile și precedența (enterprise > personal > proiect), frontmatter-ul, context: fork (fundal implicit din v2.1.218), disableSkillShellExecution, expandarea /skill în -p și sincronizarea claude.ai în terminal din v2.1.273. Corectat securityConcerns pe baza tabelului What runs before you trust a folder.

### Skills pe claude.ai (Anthropic, parteneri, organizație, custom) (`an-claudeai-skills`)

- **Sursă oficială:** https://claude.com/docs/skills/overview
- **Documentație tehnică:** https://code.claude.com/docs/en/skills
- **Ce face:** Directoare cu SKILL.md, scripturi și resurse încărcate progresiv (nume și descriere, apoi instrucțiuni, apoi fișiere la nevoie); Customize > Skills arată Created by you, From your organization, Shared with you, From Anthropic & Partners și fila Discover; skill-urile custom se încarcă de utilizator; rulează în sandboxul de cod.
- **Plan necesar:** Pro, Max, Team, Enterprise, cu Code execution and file creation activat; skill-urile de organizație doar pe Team/Enterprise.
- **Platformă:** claude.ai web, Desktop, Cowork; sincronizare în Claude Code
- **Rollout:** GA
- **Eligibilitate cont:** Disponibil: skill-uri activate pe cont — docs, google-workspace, computer-use, chrome-browser, built-in-browser, deep-research, import-memory, morning, skill-creator, xlsx, pptx, pdf, docx.
- **Autentificare:** Sesiune claude.ai.
- **Allowance:** Execuția intră în limitele planului.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar prin usage credits activate.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Standard deschis Agent Skills (agentskills.io); skill-urile contului se sincronizează în Claude Code (an-claudeai-account-sync); local se pot folosi skill-uri din .claude/skills fără cont.
- **Suprafață nativă:** Customize > Skills; / în caseta de mesaj.
- **Cerințe locale:** Niciuna pentru aplicații.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Procedurile Hub se scriu ca skill-uri Agent Skills versionate în repo, portabile între Claude Code și Codex; skill-urile contului nu intră automat în workeri.
- **Suprafață de execuție:** anthropic.claude_skills
- **Echivalent la celălalt ecosistem:** Skill-urile Codex (skill_search și skill_mcp_dependency_install active local) și skill-urile partajate în workspace-uri ChatGPT (recap).
- **Ce face unic / mai bine:** Standard deschis, încărcare progresivă a contextului.
- **Securitate:** Skill-urile încărcate sau partajate nu sunt revizuite de Anthropic și pot rula scripturi; allowed-tools din skill-urile de proiect se aplică și în -p, chiar în foldere neîncrezute.
- **Cale de implementare:** Bibliotecă de skill-uri Hub în repo, fără secrete, încărcată explicit în workeri; revizuirea câmpului allowed-tools.
- **Test necesar:** Validare statică a fișierelor SKILL.md.
- **Status:** AVAILABLE
- **Decizie Hub:** REUSE_NATIVE
- **Încredere:** high
- **Note:** Skill-urile de documente din anthropics/skills sunt source-available, nu open source; celelalte exemple sunt Apache 2.0.
- **Surse citite:** https://claude.com/docs/skills/overview · https://code.claude.com/docs/en/skills · https://github.com/anthropics/skills · https://claude.com/docs/plugins/overview · dovadă locală: sources-anthropic-local.md
- **Verificare adversarială:** CONFIRMED — Confirmat: skills pe Pro/Max/Team/Enterprise cu Code execution and file creation activat; grupurile Created by you, From your organization, Shared with you, From Anthropic & Partners și Discover; standard Agent Skills; skill-urile încărcate sau partajate nu sunt revizuite. Documentația Claude Code confirmă textual că allowed-tools din skill-urile de proiect se aplică și în -p, chiar în foldere neîncrezute.

### Sincronizarea skill-urilor și pluginurilor contului claude.ai în Claude Code (`an-claudeai-account-sync`)

- **Sursă oficială:** https://code.claude.com/docs/en/skills
- **Documentație tehnică:** https://code.claude.com/docs/en/skills
- **Ce face:** În sesiunile Claude Code autentificate claude.ai, skill-urile activate pe cont (inclusiv pdf și xlsx) se descarcă în ~/.claude/skills/synced/ și se reverifică aproximativ la 10 minute; pluginurile contului se descarcă la pornirea sesiunii; sincronizarea este doar descendentă.
- **Plan necesar:** Plan claude.ai; Claude Code ≥ 2.1.273 pentru sincronizarea skill-urilor în terminal.
- **Platformă:** Claude Code CLI, Desktop, IDE
- **Rollout:** GA în versiunile recente
- **Eligibilitate cont:** CLI-ul local 2.1.175 este sub versiunea minimă, deci probabil nu sincronizează încă skill-uri (neverificat).
- **Autentificare:** Login claude.ai și feature-flag fetching activ.
- **Allowance:** Skill-urile rulate consumă din limitele planului.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar prin usage credits activate.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Skill-uri: CLAUDE_CODE_SYNC_SKILLS=1 face o rulare -p să aștepte lista; syncClaudeAiSkills: false oprește sincronizarea și mută skill-urile în ~/.claude/skills/.trash/; nume complet /anthropic-skills:<nume>; /skills arată grupul claude.ai sync; în sesiunile locale, comenzile ! din skill-urile sincronizate nu se execută (≥ v2.1.228), dar allowed-tools este respectat. Pluginuri: sincronizare o dată la pornire (≥ v2.1.273), ca <nume>@synced; syncClaudeAiPlugins: false oprește sincronizarea și le mută în ~/.claude/plugins/.trash/ (pluginurile Required ale unei organizații nu se pot dezactiva). Nu există sincronizare în sesiunile cu --setting-sources fără user, --safe-mode, --bare, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC sau credențiale non-/login (ANTHROPIC_AUTH_TOKEN, CLAUDE_CODE_OAUTH_TOKEN, apiKeyHelper).
- **Suprafață nativă:** /skills în Claude Code.
- **Cerințe locale:** Claude Code ≥ 2.1.273.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Risc de izolare după orice actualizare de CLI, dar și sursă oficială controlată pentru skill-urile de documente.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Pluginurile la distanță din Codex (remote_plugin activ local).
- **Ce face unic / mai bine:** Aceleași skill-uri în aplicații și în terminal.
- **Securitate:** Un skill modificat pe claude.ai ar ajunge automat într-un worker, eventual cu allowed-tools largi.
- **Cale de implementare:** Înainte de actualizarea CLI: syncClaudeAiSkills: false în setările folosite de worker sau surse de setări care exclud nivelul user; verificarea listei de skill-uri din evenimentul init.
- **Test necesar:** Test simulat pe evenimentul init; verificare după actualizarea aprobată.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** WRAP
- **Încredere:** medium
- **Note:** Skill-urile deja sincronizate rămân pe disc și se încarcă chiar fără acces la claude.ai.
- **Surse citite:** https://code.claude.com/docs/en/skills · https://claude.com/docs/plugins/overview · https://claude.com/docs/plugins/platform-support
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://code.claude.com/docs/en/skills ; https://code.claude.com/docs/en/plugins/loading)) — Faptele despre skill-uri (v2.1.273, ~10 minute, download-only, .trash) sunt confirmate. Înregistrarea acoperea și pluginurile contului, dar nu documenta controlul lor; pluginurile sincronizate pot aduce hooks și agenți, deci syncClaudeAiPlugins și --setting-sources fără user sunt relevante pentru izolarea workerilor.

### Izolarea skill-urilor native în rulările Claude Code lansate de Hub (--disable-slash-commands, --safe-mode, disableSkillShellExecution, skillOverrides, syncClaudeAiSkills, disableBundledSkills) (`an-gap-cc-native-skill-isolation`)

- **Sursă oficială:** https://code.claude.com/docs/en/skills
- **Documentație tehnică:** https://code.claude.com/docs/en/settings-reference
- **Ce face:** Controale pentru ce skill-uri vede sau rulează o sesiune: --disable-slash-commands (dezactivează toate skill-urile și comenzile), --safe-mode (fără CLAUDE.md, skills, plugins, hooks, MCP, auto memory; autentificarea, modelul, uneltele și permisiunile funcționează), CLAUDE_CODE_DISABLE_BUNDLED_SKILLS / disableBundledSkills (inclusiv /batch și workflows), disableSkillShellExecution (înlocuiește comenzile inline din skill-uri user/project/plugin), skillOverrides (on, name-only, user-invocable-only, off; nu se aplică pluginurilor), syncClaudeAiSkills=false și syncClaudeAiPlugins=false (oprește descărcarea și încărcarea din ~/.claude/skills/synced), reguli Skill(nume) în deny, frontmatter disable-model-invocation. Sincronizarea skill-urilor claude.ai în terminal are loc de la 2.1.273 în orice sesiune cu login claude.ai, cu feature flags și cu --setting-sources care include user; înainte, doar în -p cu CLAUDE_CODE_SYNC_SKILLS=1. Skill-urile sincronizate nu rulează comenzi inline local.
- **Plan necesar:** Oricare
- **Platformă:** Claude Code CLI / Agent SDK
- **Rollout:** GA; syncClaudeAiPlugins ≥2.1.273
- **Eligibilitate cont:** Aplicabil; contul are 13 skill-uri claude.ai active care se pot sincroniza.
- **Autentificare:** Sincronizarea are loc doar cu login claude.ai stocat prin /login; nu cu API key, CLAUDE_CODE_OAUTH_TOKEN sau apiKeyHelper.
- **Allowance:** N/A (reduce consumul de context)
- **Utilizare partajată:** N/A
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Nu
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Per proces, fără schimbare globală: --settings '{"syncClaudeAiSkills":false,"syncClaudeAiPlugins":false,"disableSkillShellExecution":true,"skillOverrides":{"batch":"off"}}' (false este onorat din --settings; din --settings nu mută fișierele în .trash), CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1, fără CLAUDE_CODE_SYNC_SKILLS; --disable-slash-commands pentru rulări fără skill-uri. Pentru skill-urile Hub: conținut injectat prin --append-system-prompt-file sau un pachet încărcat cu --plugin-dir (afectat de disableSideloadFlags).
- **Suprafață nativă:** /skills, /plugin, claude.ai Customize > Skills
- **Cerințe locale:** 2.1.175 are --disable-slash-commands, --safe-mode, disableSkillShellExecution, skillOverrides, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS, CLAUDE_CODE_SYNC_SKILLS; nu are syncClaudeAiSkills (nici sincronizarea automată din terminal).
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Hub-ul rămâne proprietarul skill-urilor (Agent Skills); skill-urile native nu intră necontrolat în rulările Hub.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** oa-codex-skills (activare/dezactivare skill-uri în config Codex prin profil Hub).
- **Ce face unic / mai bine:** Granularitate fină per skill fără editarea SKILL.md; precedență specială care onorează false din --settings chiar peste managed.
- **Securitate:** Hook-urile și allowed-tools ale unui skill de proiect se aplică în -p fără încredere, dar doar când sursa project este încărcată. Documentația Agent SDK (tabelul settingSources) spune că sursa project încarcă settings.json, hook-urile, CLAUDE.md, regulile și skill-urile, comenzile și subagenții de proiect, deci --setting-sources user le exclude. Rămân active sub --setting-sources user: skill-urile, comenzile și subagenții din ~/.claude, pluginurile activate în setările user, skill-urile claude.ai deja sincronizate (rămân pe disc și se încarcă în sesiunile următoare ale aceluiași cont chiar fără rețea), auto memory și ~/.claude.json.
- **Cale de implementare:** Adăugarea cheilor în --settings-ul generat și a variabilei CLAUDE_CODE_DISABLE_BUNDLED_SKILLS în mediul copilului; lista de skill-uri din system/init comparată cu allowlist-ul Hub.
- **Test necesar:** Fără model: argv/env. LIVE_VALIDATION: lista skills din evenimentul init nu conține skill-uri anthropic-skills:* sau bundled.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** medium
- **Note:** Contradicție de semnalat: Hub-ul deține skill-urile, dar cu --setting-sources user, după un upgrade la ≥2.1.273, skill-urile claude.ai ale contului și pluginurile sincronizate s-ar încărca automat în rulările Hub. Sincronizarea nu are loc dacă --setting-sources exclude user, în --bare sau --safe-mode, cu CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC (fără feature flags) sau când credențialul vine din CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_AUTH_TOKEN, API key sau apiKeyHelper. Pe mașina locală, corpul unui skill sincronizat nu rulează comenzi ! (≥2.1.228). an-cc-skills, an-cc-safe-mode-isolation și an-claudeai-account-sync nu tratează izolarea.
- **Surse citite:** https://code.claude.com/docs/en/skills.md · https://code.claude.com/docs/en/settings-reference.md · https://code.claude.com/docs/en/settings.md · https://code.claude.com/docs/en/cli-reference.md · https://code.claude.com/docs/en/env-vars.md · https://code.claude.com/docs/en/permissions.md · local: claude --help și șiruri din binarul 2.1.175
- **Verificare adversarială:** CORRECTED (corectat: securityConcerns (https://code.claude.com/docs/en/agent-sdk/claude-code-features.md ; https://code.claude.com/docs/en/skills.md), notes (https://code.claude.com/docs/en/skills.md#where-synced-skills-load)) — Toate controalele au fost găsite în documentație: --disable-slash-commands, --safe-mode, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS/disableBundledSkills, disableSkillShellExecution, skillOverrides (on, name-only, user-invocable-only, off; nu se aplică pluginurilor), syncClaudeAiSkills/syncClaudeAiPlugins (false onorat din --settings chiar peste managed; mutarea în .trash doar din user/managed), CLAUDE_CODE_SYNC_SKILLS, reguli Skill(nume). Corectat doar punctul marcat nedocumentat: excluderea skill-urilor de proiect prin --setting-sources user este documentată.

## plugins

### Plugins Claude Code (plugin.json, marketplaces, `claude plugin validate/init/details`) (`an-cc-plugins`)

- **Sursă oficială:** https://code.claude.com/docs/en/plugins/manifest-reference
- **Documentație tehnică:** https://code.claude.com/docs/en/plugins/cli-reference
- **Ce face:** Pachete versionate cu skills, commands, agents, hooks, servere MCP și LSP, output styles, workflows, monitors, executabile bin/, settings, userConfig și channels, distribuite prin marketplaces.
- **Plan necesar:** Toate planurile.
- **Platformă:** Local; cloud doar prin setări gestionate.
- **Rollout:** GA (themes/monitors/evals experimentale)
- **Eligibilitate cont:** Max verificat.
- **Autentificare:** Nu depinde (instalarea poate clona git).
- **Allowance:** Componentele care rulează modelul consumă cotă; `plugin eval` rulează modelul.
- **Utilizare partajată:** Da, pentru componentele cu model.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu în sine.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism local: `claude plugin list\|details\|install\|uninstall\|enable\|disable\|update\|init\|validate\|tag\|prune\|marketplace`; `validate <path>` și `details` sunt read-only, fără model (`--json` pe validate apare din v2.1.259); `--plugin-dir <dir\|zip>` și `--plugin-url` încarcă un plugin doar pentru sesiune; variabile ${CLAUDE_PLUGIN_ROOT}, ${CLAUDE_PLUGIN_DATA}; marketplace oficial claude-plugins-official; system/init raportează plugins și plugin_errors. \| Disponibil pe plan: da. \| Controlabil programatic: da. \| Reutilizabil din Hub: da — Hub poate împacheta politica (hooks, agents, skills, server MCP Hub) într-un plugin local încărcat per run, fără instalare persistentă. \| Interacțiune: install/update cer alegerea scope-ului. \| Securitate: pluginurile rulează cod (hooks, MCP, bin pe PATH); install/update/marketplace add sunt schimbări de configurare cu aprobare; plugin subagents nu pot folosi hooks, mcpServers sau permissionMode.
- **Suprafață nativă:** /plugin, /reload-plugins.
- **Cerințe locale:** Git pentru marketplaces; nimic pentru --plugin-dir.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Vehicul de livrare pentru extensiile Hub către Claude Code, încărcat efemer per run.
- **Suprafață de execuție:** anthropic.claude_plugins
- **Echivalent la celălalt ecosistem:** Codex plugins (marketplace openai-primary-runtime și openai-bundled activ local).
- **Ce face unic / mai bine:** Validare oficială fără model; încărcare per sesiune.
- **Securitate:** Cod terț; executabile pe PATH; actualizări de marketplace.
- **Cale de implementare:** WRAP: plugin Hub în repo (după aprobare), validat cu `claude plugin validate`, încărcat cu --plugin-dir; verificare plugin_errors în system/init.
- **Test necesar:** `claude plugin validate` pe pluginul Hub (fără inferență); live doar cu grant.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** `claude plugin init` scrie în ~/.claude/skills/<nume> — modificare persistentă, doar cu aprobare.
- **Surse citite:** https://code.claude.com/docs/en/plugins/manifest-reference · https://code.claude.com/docs/en/plugins/cli-reference · https://code.claude.com/docs/en/headless · local: claude plugin --help (2.1.175) · local: claude plugin list → niciun plugin instalat
- **Verificare adversarială:** CONFIRMED — plugins/cli-reference și manifest-reference: `claude plugin init` scrie în ~/.claude/skills/<nume> și se încarcă drept <name>@skills-dir, validate --json din v2.1.259 (--strict din v2.1.145), plugin eval din v2.1.269 rulează modelul, componentele și experimental themes/monitors/evals, restricțiile hooks/mcpServers/permissionMode pentru subagenții din pluginuri; system/init raportează plugins și plugin_errors.

### Pluginuri Claude (skill-uri, conectori, comenzi, agenți, hooks) (`an-claudeai-plugins`)

- **Sursă oficială:** https://claude.com/docs/plugins/overview
- **Documentație tehnică:** https://claude.com/docs/plugins/platform-support
- **Ce face:** Pachete adăugate din Customize > Plugins (Discover, Add marketplace dintr-un repo Git, Upload .zip/.plugin, Create with Claude), salvate pe cont și disponibile în chat (skill-uri, comenzi încărcate ca skill-uri, conectori), în Cowork (plus agenți, hooks, servere MCP locale) și în Claude Code (plugin sincronizat la pornirea sesiunii).
- **Plan necesar:** Directorul: Pro, Max, Team, Enterprise; limite: 25 de marketplace-uri proprii, 5.000 de fișiere și 200 MB per plugin.
- **Platformă:** claude.ai web, Desktop, mobil (chat), Cowork, Claude Code
- **Rollout:** Marketplace în Cowork din 2026-02-24; actualizări automate din sursă.
- **Eligibilitate cont:** Disponibil; ListPlugins: niciun plugin activ; CLI: No plugins installed.
- **Autentificare:** Sesiune claude.ai; GitHub App pentru marketplace-uri private.
- **Allowance:** Utilizarea componentelor intră în limitele planului.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Conectorii incluși pot cere planuri plătite ale furnizorilor.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Pe cont doar UI. Local: claude plugin install\|list\|enable\|disable\|marketplace, --plugin-dir, --plugin-url (prezente în CLI-ul local); pluginurile contului se descarcă automat în sesiunile Claude Code autentificate claude.ai (/reload-plugins).
- **Suprafață nativă:** Customize > Plugins; / în caseta de mesaj.
- **Cerințe locale:** Niciuna pentru chat; pentru hooks și servere locale, Desktop sau Claude Code.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Proprietarul poate folosi pluginuri native; workerii Hub rulează fără pluginuri moștenite, pentru că hooks și agenții execută cod local.
- **Suprafață de execuție:** anthropic.claude_plugins
- **Echivalent la celălalt ecosistem:** Pluginurile Codex (codex plugin; marketplace openai-primary-runtime) și pluginurile ChatGPT.
- **Ce face unic / mai bine:** O singură instalare pe cont ajunge în chat, Cowork și Claude Code.
- **Securitate:** Hooks și serverele locale rulează comenzi pe computer; pluginurile adăugate din URL sau upload nu sunt revizuite de Anthropic.
- **Cale de implementare:** Worker: surse de setări restrânse și verificarea listei de pluginuri din evenimentul init; nicio instalare fără aprobare.
- **Test necesar:** Test simulat pe evenimentul init.
- **Status:** AVAILABLE
- **Decizie Hub:** REUSE_NATIVE
- **Încredere:** high
- **Note:** Pe Team/Enterprise owner-ul poate marca pluginuri ca Required; nu se aplică planului Max.
- **Surse citite:** https://claude.com/docs/plugins/overview · https://claude.com/docs/plugins/platform-support · https://code.claude.com/docs/en/skills · https://claude.com/docs/cowork/changelog · https://support.claude.com/en/articles/12138966-release-notes · dovadă locală: sources-anthropic-local.md
- **Verificare adversarială:** CONFIRMED — Confirmat: Customize > Plugins (Discover, Add marketplace, Upload plugin, Create with Claude), directorul pe Pro/Max/Team/Enterprise, 25 de marketplace-uri, 5.000 de fișiere și 200 MB per plugin, agenți și hooks doar în Cowork și Claude Code, servere locale ignorate în Chat, sincronizare în Claude Code la pornire, pluginurile din URL sau upload nerevizuite de Anthropic. Pentru izolare există și setarea documentată syncClaudeAiPlugins: false.

### Portalul de dezvoltatori pentru directorul de pluginuri și conectori (`an-plugin-directory-portal`)

- **Sursă oficială:** https://claude.com/blog/build-plugins-for-claude
- **Documentație tehnică:** https://claude.com/docs/connectors/directory
- **Ce face:** Trimiterea unui conector MCP la distanță sau a unui pachet de plugin din GitHub la claude.ai/directory/manage; validare automată și scanare de siguranță, revizuire umană pentru listările noi, apoi analitice de instalări pe suprafață și versiune.
- **Plan necesar:** Dezvoltatori pe planuri plătite; pe Team/Enterprise trimite owner-ul.
- **Platformă:** claude.ai
- **Rollout:** Lansat 2026-09-25
- **Eligibilitate cont:** Eligibil pe Max; nefolosit.
- **Autentificare:** Sesiune claude.ai.
- **Allowance:** Nu se aplică
- **Utilizare partajată:** Nu se aplică
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul identificat.
- **Risc de facturare API:** none
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Portal web; fără API documentat.
- **Suprafață nativă:** claude.ai/directory/manage
- **Cerințe locale:** Repo GitHub public pentru pachete.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul acum; Hub-ul este privat și nu se publică.
- **Suprafață de execuție:** anthropic.claude_plugins
- **Echivalent la celălalt ecosistem:** Creatorul de pluginuri și trimiterea spre revizuire din ChatGPT (recap DevDay).
- **Ce face unic / mai bine:** Scanare automată și analitice.
- **Securitate:** Publicarea ar expune cod; necesită aprobare explicită.
- **Cale de implementare:** Niciuna.
- **Test necesar:** Nu
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Surse citite:** https://claude.com/blog/build-plugins-for-claude · https://claude.com/docs/connectors/directory · https://support.claude.com/en/articles/12138966-release-notes
- **Verificare adversarială:** CONFIRMED — Confirmat: portal lansat 2026-09-25 (claude.ai/directory/manage), trimitere de conector MCP sau pachet de plugin din GitHub, validare automată și scanare de siguranță, revizuire umană pentru listări noi, analitice pe suprafață și versiune; deschis pe planuri plătite, pe Team/Enterprise trimite owner-ul.

### Claude Marketplace (pluginuri/conectori, agenți/produse, parteneri de servicii) (`an-claude-marketplace`)

- **Sursă oficială:** https://claude.com/blog/claude-marketplace
- **Documentație tehnică:** https://claude.com/blog/claude-marketplace
- **Ce face:** Destinație unică lansată pe 2026-09-23 la claude.com/marketplace: peste 2.000 de pluginuri și conectori, agenți și produse bazate pe Claude (de exemplu CrowdStrike, Cursor, Harvey, Legora, Lovable, Snowflake) plătibile dintr-o parte a angajamentului de cheltuieli cu Anthropic, și parteneri de consultanță din Claude Partner Network.
- **Plan necesar:** Neprecizat pentru pluginuri; achiziția de agenți și produse presupune un angajament de cheltuieli Anthropic (orientare enterprise).
- **Platformă:** claude.com/marketplace
- **Rollout:** Live din 2026-09-23
- **Eligibilitate cont:** Achizițiile par destinate clienților cu angajament de cheltuieli; neverificat pentru un Max individual.
- **Autentificare:** Nu se aplică
- **Allowance:** Nu se aplică
- **Utilizare partajată:** Nu se aplică
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** Produsele, agenții și serviciile terțe sunt plătite separat; interzise de BillingPolicy.
- **Risc de facturare API:** high
- **Integrare programatică:** NONE
- **Detaliu integrare:** Nicio interfață pentru Hub.
- **Suprafață nativă:** claude.com/marketplace
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul; pluginurile gratuite se folosesc prin directorul normal.
- **Suprafață de execuție:** anthropic.claude_marketplace
- **Echivalent la celălalt ecosistem:** OpenAI Marketplace (beta pentru clienți enterprise eligibili, pe baza angajamentului financiar).
- **Ce face unic / mai bine:** Procurare consolidată pentru enterprise.
- **Securitate:** Servicii și agenți terți cu acces la date.
- **Cale de implementare:** Niciuna.
- **Test necesar:** Nu
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** medium
- **Note:** Pagina claude.com/marketplace nu a fost deschisă direct; datele provin din anunțul oficial.
- **Surse citite:** https://claude.com/blog/claude-marketplace · https://claude.com/blog/build-plugins-for-claude · https://claude.com/docs/connectors/directory
- **Verificare adversarială:** CONFIRMED — Confirmat din anunțul din 2026-09-23 și acum și din pagina claude.com/marketplace: categorii Connectors and Plugins (peste 2.000), Agents and Products, Service Partners și Skills; achizițiile de agenți pot conta în angajamentul existent față de Anthropic. BLOCKED/REJECT rămâne coerent cu BillingPolicy.

### Pachete verticale de pluginuri și conectori: Agents for financial services și Claude for Small Business (`an-gap-vertical-plugin-packs`)

- **Sursă oficială:** https://www.anthropic.com/news/finance-agents
- **Documentație tehnică:** https://www.anthropic.com/news/claude-for-small-business
- **Ce face:** Agents for financial services (05.05.2026): zece șabloane de agenți pentru muncă financiară (pitchbook-uri, KYC, închideri de lună), livrate ca pluginuri pentru Claude Cowork și Claude Code și ca cookbook-uri pentru Claude Managed Agents, plus conectori noi, o aplicație MCP și integrarea cu add-in-urile Microsoft 365. Claude for Small Business (13.05.2026): pachet de conectori și fluxuri gata de rulat în instrumentele folosite de firmele mici.
- **Plan necesar:** Pluginurile rulează în Cowork/Claude Code pe planurile care le includ; Managed Agents cere Claude Platform
- **Platformă:** Cowork, Claude Code, Claude Platform
- **Rollout:** GA (conform anunțurilor)
- **Eligibilitate cont:** Pluginurile ar putea fi instalate pe Max (neverificat); nimic nu este instalat local.
- **Autentificare:** OAuth de abonament pentru Cowork/Claude Code; API key pentru Managed Agents
- **Allowance:** Alocarea planului pentru pluginuri
- **Utilizare partajată:** Alocarea comună Max
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** Cookbook-urile Managed Agents implică facturare API, interzisă de politica Hub.
- **Risc de facturare API:** high
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Pluginurile pot fi inspectate ca surse de referință (formatul plugin.json/SKILL.md); instalarea este o acțiune de configurare care cere aprobarea proprietarului.
- **Suprafață nativă:** Directorul de pluginuri Claude, /plugin
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință pentru șabloane de skill-uri verticale; Hub își păstrează catalogul propriu.
- **Suprafață de execuție:** anthropic.claude_plugins
- **Echivalent la celălalt ecosistem:** oa-marketplace, oa-plugins-directory-install.
- **Ce face unic / mai bine:** Fluxuri verticale gata făcute, cu conectori de date.
- **Securitate:** Pluginuri terțe cu acces la date financiare; necesită verificarea Hub (an-gap-skill-plugin-security-scanning).
- **Cale de implementare:** Niciuna automată.
- **Test necesar:** Niciunul
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Conectorul Anthropic Economic Index (22.07.2026) este un conector public, acoperit de an-connectors-directory.
- **Surse citite:** https://www.anthropic.com/news/finance-agents · https://www.anthropic.com/news/claude-for-small-business · https://www.anthropic.com/news/anthropic-economic-index-connector
- **Verificare adversarială:** CONFIRMED — Confirmat: Agents for financial services (05.05.2026) cu zece șabloane livrate ca pluginuri Cowork/Claude Code și cookbook-uri Managed Agents, conectori noi, o aplicație MCP și add-in-uri Microsoft 365; Claude for Small Business (13.05.2026), instalat prin comutator în Claude Cowork, cu conectori (QuickBooks, PayPal, HubSpot, Canva, Docusign, Google Workspace, Microsoft 365) și aprobare înainte de orice trimitere sau plată. apiBillingRisk high reflectă doar calea Managed Agents; pluginurile rulează din alocarea planului.

## mcp

### Client MCP (`claude mcp`, `--mcp-config`, `--strict-mcp-config`, conectori claude.ai) (`an-cc-mcp-client`)

- **Sursă oficială:** https://code.claude.com/docs/en/mcp
- **Documentație tehnică:** https://code.claude.com/docs/en/cli-reference
- **Ce face:** Conectează servere MCP stdio/http/sse/ws la nivel local, proiect (.mcp.json), user sau per sesiune și, cu autentificare claude.ai, încarcă conectorii contului.
- **Plan necesar:** Toate planurile; conectorii claude.ai doar cu login claude.ai.
- **Platformă:** Local.
- **Rollout:** GA
- **Eligibilitate cont:** Max verificat.
- **Autentificare:** OAuth claude.ai pentru conectori; OAuth/headers per server pentru serverele remote.
- **Allowance:** Rezultatele uneltelor consumă context (limită implicită 25.000 tokeni per ieșire).
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Serviciile externe conectate pot avea propriile costuri.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: `claude mcp add\|add-json\|get\|list\|remove\|reset-project-choices` (list/get pornesc serverele aprobate pentru health-check); per run `--mcp-config <json\|fișier>` + `--strict-mcp-config` (exclude .mcp.json și conectorii claude.ai) — V2 pasează deja un set gol; ENABLE_CLAUDEAI_MCP_SERVERS=false; MAX_MCP_OUTPUT_TOKENS; `--permission-prompt-tool mcp__<server>__<tool>`; system/init raportează mcp_servers. \| Disponibil pe plan: da. \| Controlabil programatic: da. \| Reutilizabil din Hub: da — Hub poate expune un server MCP stdio propriu (task-uri, aprobări, memorie, audit) către Claude. \| Interacțiune: OAuth la serverele remote. \| Securitate: serverele MCP rulează cod local; conectorii pot scrie în servicii externe; variabilele de credențiale sunt golite în configurațiile remote.
- **Suprafață nativă:** /mcp.
- **Cerințe locale:** Server MCP Hub (de implementat) pe stdio.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Canal prin care Claude citește/scrie starea canonică a Hub-ului sub controlul Hub-ului.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** `codex mcp` și MCP în Codex app-server.
- **Ce face unic / mai bine:** Mod strict per run; tool search implicit; elicitation.
- **Securitate:** Servere din .mcp.json pornite fără trust în -p; conectori cu scriere.
- **Cale de implementare:** WRAP: server MCP Hub read-mostly, pasat prin --mcp-config cu --strict-mcp-config; unelte de scriere doar prin aprobare Hub.
- **Test necesar:** Test simulat al serverului MCP Hub; live doar cu grant.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** `claude doctor` și `claude mcp list` pot porni servere stdio — nu se rulează în repo-uri neverificate.
- **Surse citite:** https://code.claude.com/docs/en/mcp · https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/headless · local: claude mcp --help (2.1.175)
- **Verificare adversarială:** CONFIRMED — mcp: scopes, --strict-mcp-config folosește doar --mcp-config și sare peste .mcp.json, user, pluginuri și conectorii claude.ai, ENABLE_CLAUDEAI_MCP_SERVERS=false, MAX_MCP_OUTPUT_TOKENS implicit 25.000; în -p serverele din .mcp.json se conectează fără întrebare. Local, help-ul 2.1.175 confirmă că list/get fac health-check serverelor aprobate (comportament schimbat în v2.1.238).

### `claude mcp serve` (Claude Code ca server MCP) (`an-cc-mcp-serve`)

- **Sursă oficială:** https://code.claude.com/docs/en/mcp
- **Documentație tehnică:** https://code.claude.com/docs/en/mcp
- **Ce face:** Expune uneltele de execuție ale Claude Code (operații pe fișiere, comenzi) prin stdio către un client MCP, care devine responsabil de confirmarea apelurilor.
- **Plan necesar:** Nu este documentată o cerință de plan pentru expunerea uneltelor.
- **Platformă:** Local, stdio.
- **Rollout:** GA
- **Eligibilitate cont:** Nu se aplică.
- **Autentificare:** Nu este documentat; clientul MCP conduce.
- **Allowance:** Nu este documentat un consum de model pentru uneltele expuse.
- **Utilizare partajată:** Nu se aplică.
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: `claude mcp serve` pornit de un client MCP (ex. config stdio cu command claude și args mcp serve). \| Disponibil pe plan: da (local). \| Controlabil programatic: da. \| Reutilizabil din Hub: nu este necesar — Hub are propriile unelte și supervisor. \| Interacțiune: depinde de client. \| Securitate: execuție arbitrară de comenzi și fișiere fără stratul de permisiuni Claude; confirmarea trece integral la client.
- **Suprafață nativă:** Niciuna.
- **Cerințe locale:** Nu se aplică.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Neutilizat.
- **Suprafață de execuție:** anthropic.claude_code_mcp_server
- **Echivalent la celălalt ecosistem:** Codex app-server/exec-server (model diferit de expunere).
- **Ce face unic / mai bine:** Reutilizarea uneltelor Claude Code în alți clienți MCP.
- **Securitate:** Suprafață mare de execuție fără gate.
- **Cale de implementare:** REJECT.
- **Test necesar:** Niciunul.
- **Status:** DOCUMENTED
- **Decizie Hub:** REJECT
- **Încredere:** medium
- **Note:** Documentația citită nu precizează exact lista uneltelor expuse în versiunea locală.
- **Surse citite:** https://code.claude.com/docs/en/mcp · local: claude mcp --help (serve prezent)
- **Verificare adversarială:** CONFIRMED — mcp: `claude mcp serve` expune doar uneltele Claude Code, nu serverele MCP conectate; clientul răspunde de confirmarea fiecărui apel; nicio cerință de plan documentată.

### Directorul de conectori (servere MCP verificate și comunitare) (`an-connectors-directory`)

- **Sursă oficială:** https://claude.com/docs/connectors/directory
- **Documentație tehnică:** https://claude.com/docs/connectors/custom/add-unlisted
- **Ce face:** Catalog unic de servere MCP pentru claude.ai, Desktop, mobil, Claude Code și Cowork, cu etichete Verified/Community (verificarea nu este audit de securitate), recomandări Suggested Connectors în chat, conectare cu contul propriu și permisiuni pe instrument (Allow always, Needs approval, Blocked).
- **Plan necesar:** Toate planurile; pe Team/Enterprise conectorii îi adaugă owner-ul.
- **Platformă:** Toate suprafețele Claude
- **Rollout:** GA; marketplace-ul anunțat pe 2026-09-23 listează peste 2.000 de pluginuri și conectori.
- **Eligibilitate cont:** Disponibil; pe cont este activ conectorul Claude Docs.
- **Autentificare:** OAuth către serviciul terț, cu contul proprietarului.
- **Allowance:** Apelurile intră în limitele planului.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Serviciile terțe pot cere cont sau plan plătit propriu, în afara Anthropic.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Adăugare din Customize > Connectors; aceiași conectori apar automat în Claude Code autentificat claude.ai (an-claudeai-connectors-in-claude-code).
- **Suprafață nativă:** Customize > Connectors; meniul + > Connectors din conversație.
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Proprietarul folosește nativ Gmail, Drive, GitHub etc. în aplicații; Hub-ul nu primește acces implicit, ci doar listează conectorii ceruți de o misiune.
- **Suprafață de execuție:** anthropic.claude_connectors
- **Echivalent la celălalt ecosistem:** Pluginurile ChatGPT (peste 4.000 de aplicații conform recap) și catalogul de pluginuri Codex.
- **Ce face unic / mai bine:** Un singur catalog pentru toate suprafețele Claude.
- **Securitate:** Conectorii cu drept de scriere acționează în numele proprietarului; prompt injection; conectorii comunitari nu sunt auditați.
- **Cale de implementare:** REUSE_NATIVE pentru proprietar; Hub-ul cere activare explicită per misiune.
- **Test necesar:** Nu
- **Status:** AVAILABLE
- **Decizie Hub:** REUSE_NATIVE
- **Încredere:** high
- **Note:** Când furnizorul schimbă endpoint-ul, conexiunea veche apare ca Custom până la re-adăugare.
- **Surse citite:** https://claude.com/docs/connectors/directory · https://claude.com/docs/connectors/custom/add-unlisted · https://claude.com/blog/claude-marketplace · https://support.claude.com/en/articles/16761823 · https://code.claude.com/docs/en/mcp
- **Verificare adversarială:** CONFIRMED — Confirmat: un singur catalog pentru claude.ai, Desktop, mobil, Claude Code și Cowork; Verified/Community, verificarea nu este audit de securitate; Suggested Connectors; pe Team/Enterprise adaugă owner-ul. Denumirea exactă a permisiunilor este Always allow / Needs approval / Blocked.

### Conectorii claude.ai încărcați automat în Claude Code (`an-claudeai-connectors-in-claude-code`)

- **Sursă oficială:** https://code.claude.com/docs/en/mcp
- **Documentație tehnică:** https://code.claude.com/docs/en/mcp
- **Ce face:** Când metoda de autentificare activă este login-ul claude.ai, serverele MCP adăugate în claude.ai apar automat în Claude Code sub numele claude.ai <Nume> (de exemplu claude.ai Claude Docs).
- **Plan necesar:** Orice plan claude.ai care are conectori.
- **Platformă:** Claude Code CLI, Desktop, IDE
- **Rollout:** GA
- **Eligibilitate cont:** Aplicabil: adaptorul V2 folosește autentificarea claude.ai.
- **Autentificare:** Doar cu login claude.ai (nu cu chei API, token-uri sau furnizori terți).
- **Allowance:** Apelurile de instrument intră în limitele planului.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Serviciile terțe pot avea costuri proprii.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Control: disableClaudeAiConnectors: true (semantică any-source-true); ENABLE_CLAUDEAI_MCP_SERVERS=false; deniedMcpServers cu nume precum „claude.ai Slack”; toggle /mcp per proiect; --strict-mcp-config folosește doar serverele din --mcp-config. Setările acționează doar asupra conectorilor aduși de Claude Code însuși (terminal, IDE, Agent SDK), nu asupra celor livrați de Desktop sau de sesiunile cloud. Pagina Agent SDK (claude -p este Agent SDK prin CLI) precizează că la login claude.ai conectorii se încarcă și în SDK, iar mcpServers: {} nu îi suprimă; nu se încarcă cu CLAUDE_CODE_OAUTH_TOKEN din setup-token, cu chei API sau cu furnizori terți.
- **Suprafață nativă:** /mcp în Claude Code.
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Izolare: workerii Hub nu moștenesc conectorii personali; un conector se activează selectiv doar pentru o misiune aprobată.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Aplicațiile și pluginurile ChatGPT disponibile în Codex (apps și remote_plugin active local).
- **Ce face unic / mai bine:** Reutilizare fără reconfigurare a conectorilor contului.
- **Securitate:** Un worker cu conectori moșteniți ar putea citi e-mail/Drive sau scrie în servicii externe fără știrea Hub-ului, ocolind politica de mesaje externe.
- **Cale de implementare:** Păstrarea --strict-mcp-config cu --mcp-config gol și adăugarea ENABLE_CLAUDEAI_MCP_SERVERS=false în mediul controlat ca a doua barieră; test de regresie pe argumente și mediu; verificarea listei de servere din evenimentul init stream-json.
- **Test necesar:** Test simulat pe argumente/mediu; atenție: claude mcp list face health-check și poate porni servere stdio.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Documentația nu mai lasă ambigue încărcarea în -p și suprimarea prin strict mode; evenimentul init (mcp_servers) al unui tur aprobat rămâne verificarea practică a listei goale.
- **Surse citite:** https://code.claude.com/docs/en/mcp · https://code.claude.com/docs/en/artifacts · https://code.claude.com/docs/en/routines · https://code.claude.com/docs/en/feature-availability
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://code.claude.com/docs/en/mcp ; https://code.claude.com/docs/en/agent-sdk/claude-code-features ; https://code.claude.com/docs/en/headless), notes (https://code.claude.com/docs/en/headless), confidence (https://code.claude.com/docs/en/agent-sdk/claude-code-features)) — Denumirea „claude.ai <Nume>”, condiția de autentificare și mecanismele de oprire sunt confirmate textual. Strategia V2 (--strict-mcp-config cu --mcp-config gol, plus ENABLE_CLAUDEAI_MCP_SERVERS=false) corespunde exact căilor documentate.

### Conectori custom prin MCP la distanță (URL) (`an-custom-remote-connectors`)

- **Sursă oficială:** https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp
- **Documentație tehnică:** https://claude.com/docs/connectors/custom/add-unlisted
- **Ce face:** Adăugarea oricărui server MCP la distanță prin URL HTTPS, cu autentificare OAuth (identitatea publicată a Claude, înregistrare dinamică sau client propriu), fără autentificare, sau cu antete fixe (beta, maxim 4); Claude se conectează din infrastructura cloud Anthropic, nu de pe dispozitiv.
- **Plan necesar:** Free (un conector), Pro, Max; pe Team/Enterprise îl adaugă owner-ul.
- **Platformă:** claude.ai web, Cowork, Desktop, mobil
- **Rollout:** GA; antetele de cerere în beta pentru organizații selectate.
- **Eligibilitate cont:** Disponibil pe Max.
- **Autentificare:** OAuth sau antete configurate în UI.
- **Allowance:** Apelurile intră în limitele planului.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul direct.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Configurare doar din UI (Customize > Connectors > Add custom connector); serverul trebuie să fie accesibil public din IP-urile Anthropic; localhost și rețelele private nu funcționează.
- **Suprafață nativă:** Customize > Connectors.
- **Cerințe locale:** Server public HTTPS.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Hub-ul, fiind doar loopback, nu poate deveni conector custom fără expunere publică; rămâne blocat până la o decizie explicită a proprietarului.
- **Suprafață de execuție:** anthropic.claude_connectors
- **Echivalent la celălalt ecosistem:** Aplicațiile MCP și extensiile de pluginuri ChatGPT (care cer și ele endpoint accesibil).
- **Ce face unic / mai bine:** Orice server MCP standard poate fi conectat.
- **Securitate:** Expunerea Hub-ului pe internet sau printr-un tunel ar crea suprafață de atac; setările de autentificare nu pot fi modificate după adăugare.
- **Cale de implementare:** Nimic acum; alternativa locală fără expunere este an-desktop-extensions-local-mcp.
- **Test necesar:** Nu
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Serverele malițioase se raportează prin programul de bug bounty Anthropic.
- **Surse citite:** https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp · https://claude.com/docs/connectors/custom/add-unlisted
- **Verificare adversarială:** CONFIRMED — Confirmat: Free un conector custom, Pro/Max pe cont propriu, Team/Enterprise adaugă owner-ul; conexiunea pleacă din cloud-ul Anthropic, localhost și rețelele private nu funcționează; opțiuni Sign in now/when needed/No sign-in, identitate publicată, DCR sau client propriu; antete în beta, maximum patru; autentificarea nu se poate modifica după adăugare. BLOCKED/REJECT este coerent cu Hub-ul doar loopback.

### MCP tunnels (conectori către servere MCP din rețele private) (`an-mcp-tunnels`)

- **Sursă oficială:** https://claude.com/docs/connectors/mcp-tunnels/overview
- **Documentație tehnică:** https://claude.com/docs/connectors/mcp-tunnels/overview
- **Ce face:** Un stack cloudflared + mcp-proxy rulat în rețeaua proprie deschide o conexiune doar de ieșire; serverele MCP interne devin conectori custom la subdomenii tunnel.anthropic.com, cu TLS exterior, TLS interior și OAuth pe fiecare server; maxim 10 tuneluri.
- **Plan necesar:** Enterprise, la cerere (research preview).
- **Platformă:** Kubernetes (Helm) sau Linux cu Docker Compose
- **Rollout:** Research preview, fără angajamente de disponibilitate.
- **Eligibilitate cont:** Neeligibil (plan Max individual).
- **Autentificare:** Cheie Tunnels API creată de owner-ul organizației Enterprise.
- **Allowance:** Nedocumentat în pagina citită.
- **Utilizare partajată:** Nu se aplică
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Necesită plan Enterprise; costuri nedocumentate.
- **Risc de facturare API:** high
- **Integrare programatică:** NONE
- **Detaliu integrare:** Nu se aplică acestui cont.
- **Suprafață nativă:** Organization settings pe Enterprise.
- **Cerințe locale:** Infrastructură container.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul.
- **Suprafață de execuție:** anthropic.claude_connectors
- **Echivalent la celălalt ecosistem:** Niciun echivalent OpenAI confirmat în sursele citite.
- **Ce face unic / mai bine:** Fără porturi de intrare.
- **Securitate:** Token-ul de tunel și cheile TLS trebuie protejate; Cloudflare vede metadate de conexiune.
- **Cale de implementare:** Niciuna.
- **Test necesar:** Nu
- **Status:** PLAN_RESTRICTED
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** high
- **Note:** Un tunel creat din claude.ai nu servește API-ul și invers.
- **Surse citite:** https://claude.com/docs/connectors/mcp-tunnels/overview
- **Verificare adversarială:** CORRECTED (corectat: apiBillingRisk (https://claude.com/docs/connectors/mcp-tunnels/overview), subscriptionIncluded (https://claude.com/docs/connectors/mcp-tunnels/overview)) — Confirmat: research preview doar pentru organizații Enterprise, la cerere; cloudflared plus mcp-proxy; subdomenii tunnel.anthropic.com; maximum 10 tuneluri; cheie Tunnels API creată de Owner; tunelurile claude.ai și API nu se servesc reciproc. Folosirea ar cere trecerea la un plan Enterprise, adică un serviciu plătit nou interzis de BillingPolicy, deci risc high, iar funcția nu este inclusă în planul Max.

### Extensii desktop (.mcpb) și servere MCP locale în Claude Desktop (`an-desktop-extensions-local-mcp`)

- **Sursă oficială:** https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop
- **Documentație tehnică:** https://claude.com/docs/connectors/building/mcpb
- **Ce face:** Pachete .mcpb (arhivă cu server MCP stdio și manifest.json) instalate cu un click în Claude Desktop; rulează local cu drepturile utilizatorului, cu acces la fișiere, instrumente locale și rețeaua internă, fără OAuth; câmpurile marcate sensitive sunt criptate în Windows Credential Manager; alternativ, configurare manuală în claude_desktop_config.json (Settings > Developer > Edit Config).
- **Plan necesar:** Claude Desktop autentificat claude.ai (orice plan); organizațiile pot restricționa.
- **Platformă:** Claude Desktop Windows și macOS (Linux beta); Node.js inclus în aplicație
- **Rollout:** GA; directorul nu mai acceptă listări MCPB (distribuirea publică se face prin pluginuri).
- **Eligibilitate cont:** Desktop 2.9939.4 instalat; extensiile existente nu au fost inspectate (configurația nu a fost citită intenționat).
- **Autentificare:** Proces local stdio.
- **Allowance:** Apelurile de instrument consumă din limitele conversației.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul direct.
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Hub-ul poate construi un server MCP stdio și îl poate împacheta cu mcpb init / mcpb pack (@anthropic-ai/mcpb); instalarea o face proprietarul (dublu-click, drag-and-drop sau Settings > Extensions > Advanced settings > Install Extension…). În tabelul pluginurilor, serverele locale sunt ignorate în Chat și se încarcă în Cowork local și Claude Code.
- **Suprafață nativă:** Settings > Extensions; Settings > Developer.
- **Cerințe locale:** Desktop deschis; după 2026-10-06 taskurile Cowork cloud ajung la conectorii locali doar prin Desktop online.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Punte locală fără expunere publică: un server MCP read-only al Hub-ului (stare misiuni, aprobări în așteptare, briefing) folosit de proprietar în Claude Desktop sau Claude Code interactiv; orice scriere trece prin aprobările Hub.
- **Suprafață de execuție:** anthropic.claude_desktop_extensions
- **Echivalent la celălalt ecosistem:** Servere MCP locale în Codex (codex mcp) și pluginuri Codex.
- **Ce face unic / mai bine:** Local, offline, secrete în depozitul sistemului de operare, format deschis MCPB.
- **Securitate:** Rulează cu drepturile utilizatorului; un server Hub ar putea fi apelat pe baza unor instrucțiuni injectate, deci trebuie să fie read-only, fără secrete, cu autentificare locală și revocabil.
- **Cale de implementare:** Fază ulterioară: server MCP stdio minimal în v2 cu instrumente read-only, manifest MCPB, teste locale fără model; instalarea doar cu aprobarea proprietarului.
- **Test necesar:** Teste unitare ale serverului (fără model); instalare manuală aprobată.
- **Status:** AVAILABLE
- **Decizie Hub:** REUSE_NATIVE
- **Încredere:** medium
- **Note:** Politicile de mașină isDesktopExtensionEnabled și isDesktopExtensionDirectoryEnabled controlează funcția în organizații.
- **Surse citite:** https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop · https://claude.com/docs/connectors/building/mcpb · https://claude.com/docs/connectors/custom/add-unlisted · https://claude.com/docs/plugins/platform-support · https://claude.com/docs/connectors/building/mcp-apps/getting-started · https://claude.com/docs/cowork/changelog
- **Verificare adversarială:** CONFIRMED — Confirmat: MCPB este arhivă cu server stdio și manifest.json; mcpb init/pack din @anthropic-ai/mcpb; instalare prin dublu-click, drag-and-drop sau Settings > Extensions > Advanced settings > Install Extension…; Node.js inclus; câmpurile sensitive în Credential Manager; politici isDesktopExtensionEnabled/isDesktopExtensionDirectoryEnabled. Conflict între surse: articolul 10949351 încă trimite dezvoltatorii spre directorul de extensii, iar documentația MCPB spune că directorul nu mai acceptă MCPB.

### Conectori interactivi / MCP Apps (UI live în conversație) (`an-mcp-apps-interactive-connectors`)

- **Sursă oficială:** https://claude.com/blog/interactive-tools-in-claude
- **Documentație tehnică:** https://claude.com/docs/connectors/building/mcp-apps/getting-started
- **Ce face:** Servere MCP care randează UI interactiv (grafice, hărți, editoare, previzualizări) direct în conversație, printr-o extensie deschisă a MCP (resurse ui://, MCP Apps SDK); parteneri la lansare: Amplitude, Asana, Box, Canva, Clay, Figma, Hex, monday.com, Slack.
- **Plan necesar:** Free, Pro, Max, Team, Enterprise.
- **Platformă:** claude.ai web, Desktop, mobil (din 2026-03-25), Cowork
- **Rollout:** Lansat 2026-01-26
- **Eligibilitate cont:** Disponibil pe plan; netestat local.
- **Autentificare:** Conform conectorului (OAuth pentru cei la distanță, local pentru stdio).
- **Allowance:** Limitele planului.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Serviciile partenerilor pot avea costuri proprii.
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Construire: registerAppTool(), registerAppResource(), App.connect() din MCP Apps SDK; pentru Claude, _meta.ui.domain = primele 32 de caractere hex ale SHA-256 din URL-ul serverului + .claudemcpcontent.com; exemplele locale rulează prin claude_desktop_config.json cu npx; Claude cere Allow sau Always allow înainte de afișare. Randarea în Claude Code nu este documentată.
- **Suprafață nativă:** Conversația (UI inline).
- **Cerințe locale:** Server MCP cu resurse UI.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Posibil viitor: panou read-only de stare/aprobări Hub randat în Claude Desktop prin serverul MCP local; aceeași aplicație ar putea rula în alte gazde compatibile.
- **Suprafață de execuție:** anthropic.claude_connectors
- **Echivalent la celălalt ecosistem:** OpenAI Apps SDK și extensiile de pluginuri ChatGPT; enable_mcp_apps din Codex este încă în dezvoltare local. Există ghid oficial de migrare de la OpenAI Apps SDK.
- **Ce face unic / mai bine:** Standard deschis, portabil între gazde.
- **Securitate:** UI în iframe sandbox; linkurile externe trebuie declarate; aprobarea afișării.
- **Cale de implementare:** REFERENCE până la existența serverului MCP local; apoi o singură vizualizare read-only.
- **Test necesar:** Nu acum.
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Feedback oficial prin mcp-apps@anthropic.com sau repo-ul ext-apps.
- **Surse citite:** https://claude.com/blog/interactive-tools-in-claude · https://claude.com/docs/connectors/building/mcp-apps/getting-started · https://support.claude.com/en/articles/12138966-release-notes · https://claude.com/docs/plugins/platform-support
- **Verificare adversarială:** CONFIRMED — Confirmat: lansat 2026-01-26 pe Free, Pro, Max, Team, Enterprise și în Cowork, pe web, desktop și mobil; registerAppTool/registerAppResource/App.connect; regula _meta.ui.domain cu SHA-256 și .claudemcpcontent.com; Allow/Always allow înainte de afișare; ghid de migrare de la OpenAI Apps SDK; randarea în Claude Code nu este documentată.

### Conectori de business cu acțiuni de scriere: write tools în conectorul Microsoft 365 și Salesforce in Claude (beta) (`an-gap-business-connectors-write-tools`)

- **Sursă oficială:** https://claude.com/docs/connectors/microsoft/365
- **Documentație tehnică:** https://support.claude.com/en/articles/12138966-release-notes
- **Ce face:** Conectorul Microsoft 365, disponibil pe toate planurile cu un cont Microsoft de serviciu sau școală și consimțământ Entra, citește SharePoint, OneDrive, Outlook și Teams; cu write actions activate poate trimite e-mail, gestiona drafturi, reguli și calendar, crea/actualiza fișiere în SharePoint și trimite mesaje în Teams. Write actions cer aprobarea permisiunilor în Entra și activare din configurarea conectorului de către administratori. Salesforce in Claude (15.09.2026, beta) este un plugin cu 37 de skill-uri de vânzări, disponibil pe planurile plătite pentru organizațiile aprobate de Salesforce.
- **Plan necesar:** M365: toate planurile (write actions: activare de admin); Salesforce: planuri plătite, organizații aprobate
- **Platformă:** claude.ai, Desktop, Cowork
- **Rollout:** M365 write tools GA din 07.07.2026; Salesforce beta
- **Eligibilitate cont:** Neverificat pentru Max: activarea write actions este descrisă prin Organization settings, iar existența unui tenant Microsoft 365 sau Salesforce nu este cunoscută.
- **Autentificare:** OAuth delegat Microsoft / Salesforce
- **Allowance:** Alocarea planului
- **Utilizare partajată:** Alocarea comună Max
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Conectorii claude.ai pot apărea automat în Claude Code (an-claudeai-connectors-in-claude-code); Hub îi exclude prin --strict-mcp-config. Fără API direct pentru Hub.
- **Suprafață nativă:** Customize > Connectors; Organization settings > Connectors
- **Cerințe locale:** Tenant Microsoft 365 sau Salesforce
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Acțiuni externe (e-mail, mesaje) operate doar de proprietar; Hub nu le declanșează.
- **Suprafață de execuție:** anthropic.claude_connectors
- **Echivalent la celălalt ecosistem:** oa-plugins-directory-install (aplicații conectate în ChatGPT cu acțiuni de scriere).
- **Ce face unic / mai bine:** Acțiuni delegate în instrumentele de business din aceeași conversație.
- **Securitate:** Trimiterea de e-mailuri și mesaje către terți; regula Hub interzice mesaje externe fără cerere explicită.
- **Cale de implementare:** Niciuna automată; eventual ASSISTED cu aprobare per acțiune.
- **Test necesar:** Niciunul
- **Status:** ELIGIBILITY_UNKNOWN
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Documentația actuală listează și trimiterea de mesaje în Teams Chat, deși release note-ul din 07.07.2026 spunea că Teams rămâne doar citire.
- **Surse citite:** https://claude.com/docs/connectors/microsoft/365.md · https://support.claude.com/en/articles/12138966-release-notes
- **Verificare adversarială:** CONFIRMED — Documentația conectorului Microsoft 365 confirmă: toate planurile, cont Microsoft de serviciu sau școală, consimțământ Entra, write actions (e-mail, drafturi, reguli, calendar, fișiere SharePoint/OneDrive, mesaje Teams Chat) activate de administratori în Organization settings > Connectors. Pe Free/Pro/Max nu există pas la nivel de organizație în Claude, deci modul de activare a write actions pe Max rămâne neclar; ELIGIBILITY_UNKNOWN este corect. Release notes din 07.07.2026 spuneau că Teams rămâne doar citire; documentația actuală listează trimiterea de mesaje. Salesforce in Claude: beta pe planurile plătite, pentru organizațiile aprobate de Salesforce.

## browser

### Claude in Chrome din Claude Code (`--chrome`) (`an-cc-chrome`)

- **Sursă oficială:** https://code.claude.com/docs/en/chrome
- **Documentație tehnică:** https://code.claude.com/docs/en/chrome
- **Ce face:** Automatizare de browser în Chrome/Edge-ul real al utilizatorului, cu sesiunile lui autentificate: navigare, formulare, consolă, DOM, upload fișiere, înregistrări GIF.
- **Plan necesar:** Plan direct Anthropic: Pro, Max, Team, Enterprise.
- **Platformă:** Windows, macOS, Linux; nu WSL.
- **Rollout:** GA (extensia ≥1.0.36)
- **Eligibilitate cont:** Max eligibil; conexiunea extensiei cu CLI neverificată.
- **Autentificare:** Obligatoriu /login claude.ai; cu API key sau setup-token integrarea rămâne oprită.
- **Allowance:** Cota Max; uneltele browser încarcă context suplimentar.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Mecanism: `claude --chrome` / `--no-chrome` / /chrome 'Enabled by default'; unelte mcp__claude-in-chrome__*; host de native messaging în HKCU pe Windows; conexiune prin bridge.claudeusercontent.com. \| Disponibil pe plan: da. \| Controlabil programatic: tehnic da într-o sesiune, dar acționează în browserul personal. \| Reutilizabil din Hub: nu pentru rulări automate. \| Interacțiune: permisiuni pe site, login/CAPTCHA manual. \| Securitate: acces la conturi autentificate; prompt injection din pagini; în auto mode clasificatorul poate sări verificarea pe site.
- **Suprafață nativă:** Chrome/Edge cu extensia; /chrome.
- **Cerințe locale:** Extensia Claude in Chrome instalată și conectată la CLI.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Asistare pentru testarea aplicațiilor locale (ex. 127.0.0.1:8011) de către proprietar.
- **Suprafață de execuție:** anthropic.claude_in_chrome
- **Echivalent la celălalt ecosistem:** Codex browser_use / pluginul chrome (active local).
- **Ce face unic / mai bine:** Folosește sesiunile reale ale utilizatorului.
- **Securitate:** Cel mai mare risc de exfiltrare dintre integrările locale.
- **Cale de implementare:** ASSISTED; Hub pasează explicit `--no-chrome` în run-urile headless pentru a nu încărca uneltele dacă proprietarul a activat Chrome implicit.
- **Test necesar:** Test simulat: --no-chrome prezent în argumente.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Sesiunea Desktop are unelte Chrome, dar asta nu dovedește conexiunea extensiei cu CLI-ul.
- **Surse citite:** https://code.claude.com/docs/en/chrome · https://code.claude.com/docs/en/cli-reference · local: claude --help (--chrome/--no-chrome) · local: sources-anthropic-local.md (unelte claude-in-chrome în sesiunea Desktop)
- **Verificare adversarială:** CONFIRMED — chrome: plan direct Anthropic (Pro/Max/Team/Enterprise), extensie ≥1.0.36, Chrome/Edge și alte Chromium, fără WSL, /login obligatoriu (cu API key sau setup-token integrarea rămâne oprită din v2.1.216), native messaging în HKCU, bridge.claudeusercontent.com, în auto mode clasificatorul poate sări verificarea pe site.

### Extensia Claude in Chrome (panou lateral) (`an-claude-in-chrome-extension`)

- **Sursă oficială:** https://support.claude.com/en/articles/12012173-getting-started-with-claude-in-chrome
- **Documentație tehnică:** https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide
- **Ce face:** Extensie care citește pagini, face click, tastează, completează formulare, navighează și gestionează mai multe taburi într-un grup; citește consola, rețeaua și DOM-ul, face capturi și încarcă imagini; pe Max/Team panoul lateral rulează ca sesiune Cowork (istoric sincronizat, skill-uri, pluginuri, conectori).
- **Plan necesar:** Pro, Max, Team, Enterprise (beta); panoul ca sesiune Cowork: Max și Team, Pro în rollout.
- **Platformă:** Google Chrome desktop conform articolului de suport; documentația Claude Code include și Edge și alte browsere Chromium; nu pe mobil.
- **Rollout:** Beta
- **Eligibilitate cont:** Plan eligibil; datele Claude Desktop conțin un folder ChromeNativeHost, dar instalarea și conectarea extensiei nu sunt verificate.
- **Autentificare:** Autentificare claude.ai în extensie.
- **Allowance:** Limitele planului; documentația nu dă rate de consum.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar prin usage credits activate.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Panoul lateral este interactiv; ruta programatică trece prin Claude Code (an-claude-code-chrome).
- **Suprafață nativă:** Panoul lateral Chrome; moduri Manually approve, Automatically approve (implicit), Skip all approvals; permisiuni pe site.
- **Cerințe locale:** Chrome deschis; extensia din Chrome Web Store.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Instrument al proprietarului pentru sarcini web autentificate, excluzând conturile financiare, medicale sau juridice.
- **Suprafață de execuție:** anthropic.claude_in_chrome
- **Echivalent la celălalt ecosistem:** Pluginurile chrome și browser din Codex, plus browser_use_external (active local).
- **Ce face unic / mai bine:** Folosește sesiunile reale ale utilizatorului; doi clasificatori (conținut și acțiuni), cu rată de succes a atacurilor sub 0,08% în testele interne declarate.
- **Securitate:** Acționează cu identitatea reală; site-urile financiare cer permisiune, cele pentru adulți și piraterie sunt blocate; din Desktop v1.32352.0 (2026-08-17) opțiunea „Allow all browser actions” a fost eliminată din cardurile de permisiune Claude in Chrome (se aprobă fiecare site, comutatorul din Settings rămâne); indisponibil pentru organizații HIPAA; capturile pot include date sensibile.
- **Cale de implementare:** ASSISTED; fără automatizare Hub.
- **Test necesar:** Nu
- **Status:** NEEDS_SETUP
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Conflict între surse privind browserele suportate (doar Chrome vs. Chromium în general).
- **Surse citite:** https://support.claude.com/en/articles/12012173-getting-started-with-claude-in-chrome · https://support.claude.com/en/articles/12902428-using-claude-in-chrome-safely · https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide (fragment de căutare) · https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork · https://claude.com/docs/cowork/changelog
- **Verificare adversarială:** CORRECTED (corectat: securityConcerns (https://claude.com/docs/cowork/changelog ; https://support.claude.com/en/articles/12902428-using-claude-in-chrome-safely)) — Data de 2026-08-20 era greșită; verificată în sursa Markdown a changelog-ului (v1.32352.0). Restul confirmat: toate planurile plătite, disponibil în Cowork și Claude Code, beta în panoul lateral; articolul de suport spune doar Chrome, pe când documentația Claude Code include Edge și alte browsere Chromium; implicit Automatically approve; clasificatori cu sub 0,08% în testele interne cu Opus 4.8.

### Claude Code + Chrome (--chrome, /chrome, serverul claude-in-chrome) (`an-claude-code-chrome`)

- **Sursă oficială:** https://code.claude.com/docs/en/chrome
- **Documentație tehnică:** https://code.claude.com/docs/en/chrome
- **Ce face:** Claude Code controlează browserul prin extensie din CLI sau VS Code: testare de aplicații web, citirea consolei și a DOM-ului, completare de formulare, extragere de date, încărcare de fișiere (maxim 10 MB), înregistrări GIF și capturi salvate pe disc; taburile sesiunii sunt grupate; la login sau CAPTCHA se oprește și cere intervenția omului.
- **Plan necesar:** Plan Anthropic direct (Pro, Max, Team, Enterprise).
- **Platformă:** Windows, macOS, Linux; Chrome, Edge și alte browsere Chromium; nu în WSL.
- **Rollout:** GA
- **Eligibilitate cont:** CLI-ul local 2.1.175 are opțiunile --chrome/--no-chrome; extensia (≥ 1.0.36) nu este verificată.
- **Autentificare:** Obligatoriu /login claude.ai; cu cheie API sau token din claude setup-token integrarea rămâne oprită.
- **Allowance:** Limitele planului; activarea implicită crește consumul de context.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar prin usage credits activate.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** claude --chrome sau /chrome (Enabled by default); server MCP intern claude-in-chrome cu instrumente observate în sesiunea curentă: tabs_context_mcp, tabs_create_mcp, navigate, read_page, find, form_input, computer, javascript_tool, read_console_messages, read_network_requests, gif_creator, file_upload, shortcuts_list, shortcuts_execute, switch_browser. Gazdă nativă com.anthropic.claude_code_browser_extension (cheie HKCU pe Windows). Funcționarea în claude -p nu este documentată.
- **Suprafață nativă:** /chrome (stare, permisiuni, reconectare, alegerea browserului).
- **Cerințe locale:** Chrome pornit cu extensia conectată; named pipe local pe Windows.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Candidat pentru verificarea UI-ului Hub (127.0.0.1:8011) de către un worker Claude, doar după decizia privind automatizarea browserului și cu grant explicit.
- **Suprafață de execuție:** anthropic.claude_code_interactive
- **Echivalent la celălalt ecosistem:** browser_use, browser_use_external și pluginul chrome din Codex (active local).
- **Ce face unic / mai bine:** Acces la consola și rețeaua paginii, sesiuni autentificate fără conectori API.
- **Securitate:** Moștenește login-urile reale din Chrome; în auto mode clasificatorul poate înlocui verificarea per site; GIF-urile pot captura date de cont; conflicte de named pipe pe Windows.
- **Cale de implementare:** Adaptorul V2 adaugă explicit --no-chrome; o capabilitate viitoare ar folosi un profil Chrome dedicat, fără conturi personale, limitat la localhost.
- **Test necesar:** Test simulat că --no-chrome apare în argumentele adaptorului; test live doar cu aprobare.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** WRAP
- **Încredere:** medium
- **Note:** Nu este documentat dacă --strict-mcp-config suprimă serverul intern claude-in-chrome; de aceea --no-chrome explicit.
- **Surse citite:** https://code.claude.com/docs/en/chrome · https://code.claude.com/docs/en/feature-availability · dovadă locală: sources-anthropic-local.md
- **Verificare adversarială:** CONFIRMED — Confirmat textual în code.claude.com/docs/en/chrome: plan Anthropic direct cu /login (cheile API și setup-token lasă integrarea oprită), Chrome/Edge/alte Chromium, nu în WSL, extensia ≥ 1.0.36, upload maxim 10 MB, cheie HKCU NativeMessagingHosts, conflicte de named pipe, pauză la login/CAPTCHA, clasificatorul auto mode poate înlocui verificarea per site, activarea implicită crește contextul. Comportamentul în -p nu este documentat.

### Claude in Chrome: scurtături, taskuri programate și fluxuri înregistrate (`an-chrome-shortcuts-scheduled`)

- **Sursă oficială:** https://support.claude.com/en/articles/12012173-getting-started-with-claude-in-chrome
- **Documentație tehnică:** https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide
- **Ce face:** Salvarea prompturilor testate ca scurtături (tastând /), taskuri programate zilnic, săptămânal, lunar sau anual în extensie, fluxuri învățate prin demonstrație (doar în panoul clasic) și fluxuri care continuă în fundal cât timp Chrome este deschis.
- **Plan necesar:** Planuri plătite.
- **Platformă:** Chrome desktop
- **Rollout:** Beta; înregistrarea fluxurilor nu există în panoul nou bazat pe Cowork.
- **Eligibilitate cont:** Eligibil pe Max; extensia neverificată.
- **Autentificare:** Autentificare claude.ai în extensie.
- **Allowance:** Fiecare rulare consumă din limitele planului.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Rulările programate pot consuma nesupravegheat; peste limită doar cu usage credits.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Crearea se face în extensie; serverul claude-in-chrome din Claude Code expune shortcuts_list și shortcuts_execute pentru scurtăturile existente.
- **Suprafață nativă:** Panoul lateral Chrome.
- **Cerințe locale:** Chrome deschis pentru taskurile programate.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință; programarea rămâne în Hub.
- **Suprafață de execuție:** anthropic.claude_in_chrome
- **Echivalent la celălalt ecosistem:** Automatizările locale și pluginul chrome din Codex (echivalență parțială).
- **Ce face unic / mai bine:** Învățare prin demonstrație.
- **Securitate:** Rulări programate în browserul autentificat real.
- **Cale de implementare:** Nimic de implementat.
- **Test necesar:** Nu
- **Status:** NEEDS_SETUP
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Detaliile de planificare provin din articolul de introducere; ghidul de permisiuni a fost citit doar ca fragment.
- **Surse citite:** https://support.claude.com/en/articles/12012173-getting-started-with-claude-in-chrome · https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide (fragment de căutare) · https://code.claude.com/docs/en/chrome
- **Verificare adversarială:** CONFIRMED — Confirmat textual în 12012173: scurtături cu /, programare zilnică/săptămânală/lunară/anuală din iconița ceas, înregistrarea fluxurilor doar în panoul clasic, nu în sesiunea Cowork; planuri plătite.

### Browserul integrat din Claude Desktop (Browser pane și panoul Cowork) (`an-desktop-built-in-browser`)

- **Sursă oficială:** https://support.claude.com/en/articles/16607400
- **Documentație tehnică:** https://code.claude.com/docs/en/desktop
- **Ce face:** Browser cu taburi și profil separat de cel personal (login-uri proprii persistente; importul login-urilor este disponibil din Chrome, Edge și Firefox pe macOS, dar doar din Firefox pe Windows și Linux) în care Claude deschide site-uri, citește pagini, face click, tastează și completează formulare; în Code tab pornește serverele de dezvoltare (.claude/launch.json), verifică automat modificările, citește consola și rețeaua; deschide și HTML, PDF, imagini, video din proiect.
- **Plan necesar:** Pro, Max, Team și Enterprise eligibile pentru Cowork; Code tab pentru previzualizare.
- **Platformă:** Claude Desktop macOS, Windows, Linux (beta); Cowork web/mobil când Desktop este online
- **Rollout:** Rollout gradual în Cowork; disponibil în Code tab.
- **Eligibilitate cont:** Disponibil: instrumentele mcp__Claude_Browser__* sunt expuse sesiunii Desktop curente.
- **Autentificare:** Sesiune claude.ai în Desktop.
- **Allowance:** Limitele planului.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar prin usage credits activate.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Instrumentele (navigate, read_page, get_page_text, find, form_input, computer, read_console_messages, read_network_requests, tabs, resize_window, preview_start/stop/logs) există doar în sesiunile Desktop, nu în CLI-ul headless. Setări de administrare: browserExternalPageTools, disableBrowserExternalNavigation.
- **Suprafață nativă:** Ctrl+Shift+B pe Windows, meniul Views, panoul lateral Cowork.
- **Cerințe locale:** Desktop deschis.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Proprietarul (sau o sesiune Desktop aprobată) verifică vizual UI-ul Hub pe 127.0.0.1:8011 fără a atinge profilul Chrome personal; localhost nu cere aprobare de site.
- **Suprafață de execuție:** anthropic.claude_desktop_browser
- **Echivalent la celălalt ecosistem:** in_app_browser din Codex (activ local).
- **Ce face unic / mai bine:** Profil curat, aprobări per site (Allow once, Always allow, Deny), clasificatori pe acțiunile de scriere în orice mod.
- **Securitate:** Login-urile salvate în profilul integrat persistă; site-urile cu risc ridicat sunt blocate; prompt injection rămâne posibil.
- **Cale de implementare:** Documentarea unei intrări .claude/launch.json pentru V2 (după aprobare) ca utilitar de previzualizare al proprietarului.
- **Test necesar:** Nu (nu se poate testa fără inferență).
- **Status:** AVAILABLE
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Nici pe site-urile aprobate Claude nu cumpără, nu creează conturi și nu ocolește CAPTCHA fără utilizator.
- **Surse citite:** https://support.claude.com/en/articles/16607400 · https://code.claude.com/docs/en/desktop · https://claude.com/docs/cowork/changelog · dovadă locală: sources-anthropic-local.md
- **Verificare adversarială:** CORRECTED (corectat: whatItDoes (https://support.claude.com/en/articles/16607400)) — Planurile (Pro, Max, Team; Enterprise cu activare), lansarea treptată în Cowork, Ctrl+Shift+B, aprobările Allow once/Always allow/Deny și setările browserExternalPageTools/disableBrowserExternalNavigation sunt confirmate. Pe acest PC Windows importul din Chrome/Edge nu este disponibil.

## computer

### Computer use din CLI Claude Code (`an-cc-computer-use-cli`)

- **Sursă oficială:** https://code.claude.com/docs/en/computer-use
- **Documentație tehnică:** https://code.claude.com/docs/en/computer-use
- **Ce face:** Server MCP încorporat computer-use care deschide aplicații, face click, tastează și capturează ecranul, pentru aplicații native fără API.
- **Plan necesar:** Pro sau Max (nu Team/Enterprise).
- **Platformă:** Doar macOS în CLI; nu Windows, nu Linux.
- **Rollout:** Research preview
- **Eligibilitate cont:** Planul Max este eligibil, dar platforma Windows nu este suportată în CLI.
- **Autentificare:** claude.ai.
- **Allowance:** Nu se aplică pe Windows.
- **Utilizare partajată:** Nu se aplică.
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** none
- **Integrare programatică:** NONE
- **Detaliu integrare:** Mecanism: activare din /mcp (computer-use), doar sesiuni interactive, nu -p; blocare o singură sesiune; aprobare per aplicație. \| Disponibil pe plan: da, dar nu pe Windows. \| Controlabil programatic: nu. \| Reutilizabil din Hub: nu. \| Interacțiune: da. \| Securitate: control real al desktopului.
- **Suprafață nativă:** Nu pe Windows.
- **Cerințe locale:** macOS.
- **Relevanță pentru Hub:** NONE
- **Rol propus:** Niciunul pe mașina Windows.
- **Suprafață de execuție:** anthropic.claude_computer_use
- **Echivalent la celălalt ecosistem:** Codex computer_use (activ local).
- **Ce face unic / mai bine:** Nu se aplică.
- **Securitate:** Nu se aplică.
- **Cale de implementare:** Niciuna; pe Windows varianta este computer use din Desktop (an-cc-desktop-computer-use).
- **Test necesar:** Niciunul.
- **Status:** NOT_APPLICABLE
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** high
- **Note:** Pe Windows, documentația trimite la computer use din aplicația Desktop.
- **Surse citite:** https://code.claude.com/docs/en/computer-use · https://code.claude.com/docs/en/feature-availability
- **Verificare adversarială:** CONFIRMED — computer-use: research preview doar pe macOS, Pro/Max (nu Team/Enterprise), doar sesiuni interactive, blocare pe o singură sesiune, aprobare per aplicație; pe Windows docs trimit la computer use din Desktop.

### Computer use în Claude Desktop (tab Code) pe Windows (`an-cc-desktop-computer-use`)

- **Sursă oficială:** https://code.claude.com/docs/en/desktop
- **Documentație tehnică:** https://code.claude.com/docs/en/desktop
- **Ce face:** În aplicația Desktop, Claude poate controla ecranul pe macOS și Windows, cu aprobare per aplicație și niveluri de acces (browsere doar vizualizare, terminale/IDE doar click).
- **Plan necesar:** Pro sau Max (nu Team/Enterprise).
- **Platformă:** Claude Desktop pe Windows și macOS.
- **Rollout:** Research preview
- **Eligibilitate cont:** Max eligibil; toggle-ul nu este activat acum.
- **Autentificare:** claude.ai în Desktop.
- **Allowance:** Cota Max.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Mecanism: Settings > General > Computer use (pe Windows efect imediat); aprobări per aplicație pe sesiune (30 min în Dispatch). \| Disponibil pe plan: da. \| Controlabil programatic: nu din Hub. \| Reutilizabil din Hub: doar ca pregătire de instrucțiuni. \| Interacțiune: da. \| Securitate: acțiuni pe desktopul real; prompt injection din ecran; un singur controller.
- **Suprafață nativă:** Claude Desktop, tab Code/Cowork.
- **Cerințe locale:** Claude Desktop actualizat și toggle activat de proprietar.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Asistare pentru sarcini GUI fără API, operate de proprietar.
- **Suprafață de execuție:** anthropic.claude_computer_use
- **Echivalent la celălalt ecosistem:** Codex computer_use / unified-computer-use.
- **Ce face unic / mai bine:** Singura rută Claude de computer use pe Windows.
- **Securitate:** Control total al desktopului.
- **Cale de implementare:** ASSISTED: Hub pregătește instrucțiuni și înregistrează rezultatul; nu activează toggle-ul.
- **Test necesar:** Niciunul automat.
- **Status:** ASSISTED_ONLY
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Hub nu devine al doilea controller al desktopului.
- **Surse citite:** https://code.claude.com/docs/en/desktop · https://code.claude.com/docs/en/computer-use · local: sources-anthropic-local.md (uneltele de control desktop neactivate în sesiunea curentă)
- **Verificare adversarială:** CONFIRMED — desktop: research preview pe macOS și Windows, Pro/Max (nu Team/Enterprise), toggle în Settings > General cu efect imediat pe Windows, aprobări per sesiune sau 30 de minute în Dispatch, browsere doar vizualizare și terminale/IDE doar click.

### Computer use în Claude Desktop pe Windows (`an-desktop-computer-use-windows`)

- **Sursă oficială:** https://support.claude.com/en/articles/14128542
- **Documentație tehnică:** https://code.claude.com/docs/en/desktop
- **Ce face:** Claude face capturi de ecran, click, tastare, drag și scurtături în aplicațiile aprobate; preferă conectorii, Bash, Claude in Chrome și panoul iOS Simulator înaintea controlului de ecran. Niveluri fixe: browsere și platforme de trading doar vizualizare, terminale și IDE-uri doar click, restul control complet.
- **Plan necesar:** Pro și Max (research preview); nu Team/Enterprise.
- **Platformă:** Claude Desktop macOS și Windows (Cowork și Code); pe Windows comutatorul are efect imediat.
- **Rollout:** Lansat 2026-03-23; Help Center îl descrie acum ca beta pentru Pro și Max, iar documentația Claude Code ca research preview; oprit implicit.
- **Eligibilitate cont:** Eligibil (Max, Windows 11); oprit implicit; instrumentele de control desktop nu sunt active în sesiunea curentă.
- **Autentificare:** Sesiune claude.ai în Desktop.
- **Allowance:** Limitele planului; mai lent și mai costisitor decât integrările directe.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar prin usage credits activate.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Doar în sesiunile Desktop (inclusiv cele create de Dispatch); pe CLI computer use există numai pe macOS și nu în -p.
- **Suprafață nativă:** Settings > General (Desktop app) > Computer use; Denied apps; Unhide apps when Claude finishes; prompt Allow for this session / Deny.
- **Cerințe locale:** Desktop deschis, computer treaz, ultima versiune.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Doar pentru sarcini GUI fără API, supravegheate de proprietar; nu pentru automatizări Hub.
- **Suprafață de execuție:** anthropic.claude_computer_use
- **Echivalent la celălalt ecosistem:** Pluginurile computer-use și unified-computer-use din Codex (active local); computer use în Agents API este API plătit (respins).
- **Ce face unic / mai bine:** Niveluri de control pe categorii de aplicații și listă de aplicații refuzate.
- **Securitate:** Fără sandbox; vede tot ce apare pe ecran; aprobările din sesiunile Dispatch expiră după 30 de minute; aplicațiile de investiții și cripto sunt blocate implicit; o singură sesiune deține controlul.
- **Cale de implementare:** Nicio integrare; politica Hub precizează că workerii nu activează computer use.
- **Test necesar:** Nu
- **Status:** NEEDS_SETUP
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Pe Windows nu sunt necesare permisiunile Accessibility/Screen Recording specifice macOS.
- **Surse citite:** https://support.claude.com/en/articles/14128542 · https://code.claude.com/docs/en/desktop · https://code.claude.com/docs/en/computer-use · https://support.claude.com/en/articles/13947068 · https://code.claude.com/docs/en/feature-availability
- **Verificare adversarială:** CORRECTED (corectat: rollout (https://support.claude.com/en/articles/14128542 ; https://code.claude.com/docs/en/desktop)) — Restul confirmat: doar Pro/Max, Desktop macOS și Windows, comutator în Settings > General (Desktop app) cu efect imediat pe Windows, niveluri pe categorii de aplicații, aplicațiile de investiții/cripto blocate implicit, aprobări pe sesiune sau 30 de minute în Dispatch, blocare pe o singură sesiune; pe CLI numai macOS și nu în -p.

### Computer use din Claude Code CLI (server MCP computer-use) (`an-cli-computer-use-macos`)

- **Sursă oficială:** https://code.claude.com/docs/en/computer-use
- **Documentație tehnică:** https://code.claude.com/docs/en/computer-use
- **Ce face:** Server MCP intern computer-use activat din /mcp per proiect, cu aprobare per aplicație și sesiune, ascunderea celorlalte aplicații, tasta Esc globală și blocare pe o singură sesiune.
- **Plan necesar:** Pro sau Max.
- **Platformă:** Doar macOS, doar sesiuni interactive (nu -p).
- **Rollout:** Research preview
- **Eligibilitate cont:** Neaplicabil pe această mașină Windows.
- **Autentificare:** Login claude.ai.
- **Allowance:** Limitele planului.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar prin usage credits activate.
- **Risc de facturare API:** low
- **Integrare programatică:** NONE
- **Detaliu integrare:** Pe Windows serverul computer-use nu apare în /mcp; documentația trimite la computer use din Desktop.
- **Suprafață nativă:** /mcp în Claude Code pe macOS.
- **Cerințe locale:** macOS cu Accessibility și Screen Recording.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul.
- **Suprafață de execuție:** anthropic.claude_code_interactive
- **Echivalent la celălalt ecosistem:** computer_use din Codex (activ local).
- **Ce face unic / mai bine:** Terminalul este exclus din capturi.
- **Securitate:** Rulează pe desktopul real.
- **Cale de implementare:** Niciuna.
- **Test necesar:** Nu
- **Status:** NOT_APPLICABLE
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** high
- **Note:** Relevant doar dacă Hub-ul rulează vreodată pe macOS.
- **Surse citite:** https://code.claude.com/docs/en/computer-use
- **Verificare adversarială:** CONFIRMED — Confirmat textual în code.claude.com/docs/en/computer-use: research preview doar pe macOS, Pro/Max, doar sesiuni interactive (nu -p); pe Windows serverul computer-use nu apare în /mcp, iar documentația trimite la computer use din Desktop.

## mobile

### Remote Control (`--remote-control`, `claude remote-control`) (`an-cc-remote-control`)

- **Sursă oficială:** https://code.claude.com/docs/en/remote-control
- **Documentație tehnică:** https://code.claude.com/docs/en/cli-reference
- **Ce face:** Permite continuarea și conducerea unei sesiuni locale din claude.ai/code sau aplicația mobilă; execuția rămâne locală, transcrierea este stocată pe serverele Anthropic.
- **Plan necesar:** Pro, Max (Team/Enterprise cu activare de admin); API keys nesuportate.
- **Platformă:** Local + claude.ai/aplicația Claude.
- **Rollout:** GA
- **Eligibilitate cont:** Max eligibil; login claude.ai verificat.
- **Autentificare:** OAuth claude.ai complet (nu setup-token, nu API key).
- **Allowance:** Cota Max.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Mecanism: `claude --remote-control [nume]` (sesiune interactivă) sau `claude remote-control` în server mode (--spawn same-dir\|worktree\|session, --capacity implicit 32); doar HTTPS outbound, fără porturi inbound; Trusted Devices opțional. \| Disponibil pe plan: da. \| Controlabil programatic: doar pornirea; controlul se face din UI-ul Anthropic. \| Reutilizabil din Hub: proprietarul poate supraveghea de pe telefon o sesiune lansată de Hub. \| Interacțiune: da. \| Securitate: control de la distanță al mașinii; aprobările date de pe telefon nu trec prin auditul Hub; transcrieri pe servere Anthropic.
- **Suprafață nativă:** claude.ai/code, aplicația Claude iOS/Android.
- **Cerințe locale:** Mașina trează și conectată.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Supraveghere mobilă a sesiunilor asistate.
- **Suprafață de execuție:** anthropic.claude_mobile_remote
- **Echivalent la celălalt ecosistem:** `codex remote-control` (experimental).
- **Ce face unic / mai bine:** Execuție locală cu control de oriunde.
- **Securitate:** Suprafață de control externă; Hub pierde vizibilitatea aprobărilor.
- **Cale de implementare:** ASSISTED: Hub poate include --remote-control doar la cererea explicită a proprietarului și marchează run-ul ca 'controlat extern'.
- **Test necesar:** Niciunul automat.
- **Status:** AVAILABLE
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Eligibilitatea exactă poate fi raportată de `claude doctor` în versiuni mai noi.
- **Surse citite:** https://code.claude.com/docs/en/remote-control · https://code.claude.com/docs/en/cli-reference · https://code.claude.com/docs/en/feature-availability · local: claude --help (--remote-control, --remote-control-session-name-prefix)
- **Verificare adversarială:** CONFIRMED — remote-control: Pro/Max/Team/Enterprise (Owner activează pe Team/Enterprise), fără API key sau setup-token, --spawn same-dir\|worktree\|session, --capacity implicit 32, doar HTTPS outbound, transcrierea stocată pe serverele Anthropic, Trusted Devices în beta.

### Sesiuni Cowork la distanță pe web și mobil (`an-cowork-remote-sessions`)

- **Sursă oficială:** https://support.claude.com/en/articles/15520349
- **Documentație tehnică:** https://support.claude.com/en/articles/15520349
- **Ce face:** Sesiunile și fișierele Cowork se salvează în cont și urmează utilizatorul între Desktop, web și mobil; taskurile cloud continuă cu dispozitivul închis; notificări pe telefon la finalizare sau când e nevoie de input; taskurile locale cer Desktop online.
- **Plan necesar:** Beta pe web/mobil pentru Pro, Max, Team; Enterprise cu activare admin.
- **Platformă:** claude.ai web, iOS, Android, Desktop
- **Rollout:** Început cu Max la 2026-07-07; remote sessions în beta.
- **Eligibilitate cont:** Eligibil pe Max; utilizarea efectivă neverificată.
- **Autentificare:** Sesiune claude.ai.
- **Allowance:** Limitele planului.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar prin usage credits activate.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Fără API.
- **Suprafață nativă:** Lista de taskuri Cowork pe orice dispozitiv; notificări push.
- **Cerințe locale:** Desktop deschis pentru fișiere locale, conectori locali, browser și computer use.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Supraveghere mobilă a taskurilor Cowork pornite de proprietar; Hub-ul rămâne local.
- **Suprafață de execuție:** anthropic.claude_cowork
- **Echivalent la celălalt ecosistem:** Codex de la distanță de pe telefon și în cloud (recap DevDay).
- **Ce face unic / mai bine:** Continuitate între dispozitive fără configurare.
- **Securitate:** Transcrierile și fișierele sunt stocate pe serverele Anthropic.
- **Cale de implementare:** Nimic de implementat.
- **Test necesar:** Nu
- **Status:** ASSISTED_ONLY
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Artifacts live create înainte de 2026-08-19 sunt disponibile doar pe desktop.
- **Surse citite:** https://support.claude.com/en/articles/15520349 · https://support.claude.com/en/articles/12138966-release-notes · https://support.claude.com/en/articles/16761823
- **Verificare adversarială:** CONFIRMED — Confirmat: Cowork în beta pe web și mobil pentru Pro/Max/Team și Enterprise cu activare; lansare începută cu Max pe 2026-07-07; accesul la fișiere, conectori locali, browser și computer use trece prin Desktop deschis; artifacts live create înainte de 2026-08-19 doar pe desktop; transcrieri stocate în cont.

### Dispatch (fir persistent: taskuri trimise de pe telefon către Desktop) (`an-dispatch`)

- **Sursă oficială:** https://support.claude.com/en/articles/13947068
- **Documentație tehnică:** https://claude.com/docs/cowork/guide/dispatch
- **Ce face:** Un agent Cowork de lungă durată primește instrucțiuni (inclusiv de pe mobil), le împarte în taskuri copil rulate ca sesiuni Cowork (muncă de cunoaștere) sau Code (cod) pe desktop, cu stări (Running, Awaiting input, Completed, Error); cererile de permisiune fără răspuns în 10 minute sunt refuzate automat; notificări push.
- **Plan necesar:** Pro sau Max; nu Team/Enterprise.
- **Platformă:** Desktop macOS/Windows (Linux fără computer use); iOS, Android
- **Rollout:** Beta limitată; indisponibil utilizatorilor noi, înlocuit treptat de experiența unificată.
- **Eligibilitate cont:** Necunoscut dacă proprietarul este utilizator Dispatch existent.
- **Autentificare:** Sesiune claude.ai pe Desktop și mobil.
- **Allowance:** Limitele planului.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar prin usage credits activate.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Fără API.
- **Suprafață nativă:** Dispatch în bara laterală Cowork și în aplicația mobilă.
- **Cerințe locale:** Desktop deschis și computer treaz.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință; delegarea din mobil ar ocoli aprobările Hub.
- **Suprafață de execuție:** anthropic.claude_mobile_remote
- **Echivalent la celălalt ecosistem:** codex remote-control [experimental] și Codex de pe telefon (recap DevDay).
- **Ce face unic / mai bine:** Rutare automată între Cowork și Code.
- **Securitate:** Rulează pe desktopul real; articolul avertizează că computer use nu trece prin porțile de permisiune ale altor instrumente; aprobările computer use expiră la 30 de minute.
- **Cale de implementare:** Nimic de implementat.
- **Test necesar:** Nu
- **Status:** ELIGIBILITY_UNKNOWN
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Un singur fir continuu; nu se pot gestiona fire separate.
- **Surse citite:** https://support.claude.com/en/articles/13947068 · https://claude.com/docs/cowork/guide/dispatch · https://code.claude.com/docs/en/desktop · https://support.claude.com/en/articles/16761823
- **Verificare adversarială:** CONFIRMED — Confirmat: beta limitată pe Pro și Max, indisponibil utilizatorilor noi, Desktop macOS/Windows x64/Linux (fără computer use pe Linux), rutare Cowork/Code, cereri de permisiune respinse automat după zece minute, aprobări computer use de 30 de minute în sesiunile Dispatch, fir unic. Stările includ și Awaiting answer și Archived.

### Remote Control (continuarea sesiunilor locale Claude Code de pe web sau telefon) (`an-remote-control`)

- **Sursă oficială:** https://code.claude.com/docs/en/remote-control
- **Documentație tehnică:** https://code.claude.com/docs/en/remote-control
- **Ce face:** Conectează claude.ai/code sau aplicația mobilă la o sesiune Claude Code care rulează local: execuția și fișierele rămân pe mașină, conversația se sincronizează între dispozitive, se pot trimite fotografii și fișiere de pe telefon, notificări push, reconectare automată după somn sau pierderea rețelei.
- **Plan necesar:** Pro, Max; Team/Enterprise cu activare admin; cheile API nu sunt acceptate.
- **Platformă:** CLI, Desktop (Code tab), VS Code; control din browser, iOS, Android
- **Rollout:** GA; Trusted Devices în beta (din 2026-06-25 pentru Team/Enterprise, activabil și pe Pro/Max).
- **Eligibilitate cont:** Disponibil: CLI-ul local are --remote-control [name]; plan Max; în datele Desktop există remote-control-state.json (conținut necitit).
- **Autentificare:** Login claude.ai complet; ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN sau apiKeyHelper blochează funcția.
- **Allowance:** Aceleași limite ale planului.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Promptul de consimțământ pentru facturarea Fable din usage credits nu ajunge pe telefon; tura se încheie dacă nimeni nu răspunde local.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Pornire: claude remote-control (mod server; --spawn same-dir\|worktree\|session, --capacity N implicit 32, --continue, --session-id, --remote-control-session-name-prefix), claude --remote-control [nume] / --rc, sau /remote-control (/rc); setarea /config Enable Remote Control for all sessions. Doar HTTPS de ieșire (înregistrare + polling + streaming); transcrierea este stocată pe serverele Anthropic. Controlul propriu-zis se face din UI-ul claude.ai sau mobil.
- **Suprafață nativă:** Lista de sesiuni din claude.ai/code și fila Code din aplicația mobilă; cod QR.
- **Cerințe locale:** Proces Claude Code pornit, computer treaz, workspace marcat ca încrezut.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Pentru sesiunile interactive ale proprietarului; interzis pentru workerii Hub, unde ar deschide un canal de comandă în afara aprobărilor și auditului Hub.
- **Suprafață de execuție:** anthropic.claude_mobile_remote
- **Echivalent la celălalt ecosistem:** codex remote-control [experimental: start/stop/pair] (local).
- **Ce face unic / mai bine:** Fără porturi deschise; server multi-sesiune cu worktree per sesiune.
- **Securitate:** Oricine controlează contul claude.ai poate conduce sesiunea (Require trusted devices recomandat); transcrieri în cloud; setarea globală de auto-conectare poate expune toate sesiunile interactive.
- **Cale de implementare:** Adaptorul V2 nu transmite --remote-control/--rc și verifică argumentele; RUNBOOK recomandă activarea Trusted Devices pe cont.
- **Test necesar:** Test simulat pe argumentele adaptorului; nicio conectare reală fără aprobare.
- **Status:** AVAILABLE
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Din aplicație nu se pot selecta modurile Auto sau Bypass pentru sesiunile Remote Control; unele comenzi (de ex. /plugin, /resume) nu funcționează de pe mobil.
- **Surse citite:** https://code.claude.com/docs/en/remote-control · https://code.claude.com/docs/en/mobile · https://code.claude.com/docs/en/feature-availability · https://code.claude.com/docs/en/model-config · https://support.claude.com/en/articles/12138966-release-notes · dovadă locală: sources-anthropic-local.md
- **Verificare adversarială:** CONFIRMED — Confirmat textual: Pro/Max, Team/Enterprise cu activare owner, fără chei API (ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN/apiKeyHelper blochează); claude remote-control cu --spawn, --capacity implicit 32, --continue, --session-id; doar HTTPS de ieșire; transcrieri pe serverele Anthropic; Trusted Devices în beta; Auto și Bypass nu se pot alege din aplicație; promptul de consimțământ Fable nu ajunge pe telefon. De adăugat ca barieră: setarea documentată disableRemoteControl în setările workerilor; organizațiile ZDR nu pot activa funcția.

### Aplicația mobilă Claude (iOS/Android) ca suprafață de continuare (`an-mobile-app`)

- **Sursă oficială:** https://code.claude.com/docs/en/mobile
- **Documentație tehnică:** https://code.claude.com/docs/en/mobile
- **Ce face:** Client pentru chat, Cowork (taskuri cloud și la distanță), fila Code (sesiuni cloud, Projects, Remote Control) și Dispatch; notificări push; randează aplicații interactive (MCP Apps) din 2026-03-25; Claude Docs doar în vizualizare.
- **Plan necesar:** Toate planurile pentru chat; Code și Dispatch conform planului.
- **Platformă:** iOS, iPadOS, Android
- **Rollout:** GA
- **Eligibilitate cont:** Eligibil pe Max; instalarea pe telefon neverificată.
- **Autentificare:** Același cont claude.ai; cheile Console nu funcționează pentru Code.
- **Allowance:** Limitele planului.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar prin usage credits activate.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Fără API; /mobile în Claude Code afișează un cod QR spre magazin.
- **Suprafață nativă:** Aplicația Claude, fila Code.
- **Cerințe locale:** Niciuna pe PC; pentru Remote Control sau Dispatch computerul trebuie să fie pornit.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Supraveghere de la distanță a lucrului nativ; Hub-ul, fiind doar loopback, nu este accesibil de pe telefon.
- **Suprafață de execuție:** anthropic.claude_mobile_remote
- **Echivalent la celălalt ecosistem:** Aplicația ChatGPT și Codex de pe telefon (recap DevDay).
- **Ce face unic / mai bine:** Un singur client pentru toate suprafețele Claude.
- **Securitate:** Din aplicație nu se pot alege modurile Bypass sau Auto în Remote Control; exportul de date nu se poate face din mobil.
- **Cale de implementare:** Nimic de implementat.
- **Test necesar:** Nu
- **Status:** ASSISTED_ONLY
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Claude Code nu are aplicație mobilă separată.
- **Surse citite:** https://code.claude.com/docs/en/mobile · https://support.claude.com/en/articles/16761823 · https://support.claude.com/en/articles/15520349 · https://support.claude.com/en/articles/12138966-release-notes
- **Verificare adversarială:** CONFIRMED — Confirmat în code.claude.com/docs/en/mobile: aplicația este client pentru sesiuni cloud, Projects, Remote Control și Dispatch; cheile Console nu funcționează pentru Code; /mobile afișează codul QR; nu există aplicație mobilă separată pentru Claude Code; Bypass nu se poate alege, iar Auto nu este disponibil pentru Remote Control.

## scheduling

### Routines (agenți cloud programați sau declanșați) (`an-cc-routines`)

- **Sursă oficială:** https://code.claude.com/docs/en/routines
- **Documentație tehnică:** https://code.claude.com/docs/en/routines
- **Ce face:** Configurații salvate (prompt, repo, mediu, conectori) rulate automat în cloud la program (minim 1 oră), prin POST API sau la evenimente GitHub.
- **Plan necesar:** Pro, Max, Team, Enterprise.
- **Platformă:** Cloud Anthropic.
- **Rollout:** Research preview
- **Eligibilitate cont:** Max eligibil; nicio routine creată (neverificat din CLI).
- **Autentificare:** claude.ai; token bearer per routine pentru API.
- **Allowance:** Consumă cota abonamentului ca sesiunile interactive; plafon zilnic de rulări; rulările one-off nu intră în plafon.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Peste plafon sau limită continuă pe usage credits doar dacă sunt activate.
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Mecanism: creare în claude.ai/code/routines, Desktop sau `/schedule` în CLI (sesiune interactivă, deci inferență; unealta RemoteTrigger); declanșare: POST https://api.anthropic.com/v1/claude_code/routines/<id>/fire cu bearer token și header beta experimental-cc-routine-2026-04-01, câmp text opțional tratat ca date neîncredere. Rulează fără prompturi de permisiune; conectorii incluși pot scrie. \| Disponibil pe plan: da. \| Controlabil programatic: declanșare da, după creare manuală. \| Reutilizabil din Hub: asistat — Hub nu creează routines; ar putea declanșa una aprobată doar dacă proprietarul acceptă stocarea tokenului. \| Interacțiune: creare și configurare de către proprietar. \| Securitate: acțiuni autonome sub identitatea GitHub și a conectorilor proprietarului; tokenul este secret.
- **Suprafață nativă:** claude.ai/code/routines, /schedule.
- **Cerințe locale:** GitHub conectat; mediu cloud.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Automatizări cloud deținute de proprietar, referite în Hub; programatorul canonic rămâne Hub.
- **Suprafață de execuție:** anthropic.claude_routines_cloud
- **Echivalent la celălalt ecosistem:** Automatizări programate OpenAI (dots, team tasks) și Codex cloud.
- **Ce face unic / mai bine:** Rulează cu laptopul închis; declanșare pe evenimente GitHub.
- **Securitate:** Al doilea planificator; autonomie completă; secret de declanșare.
- **Cale de implementare:** ASSISTED: Hub înregistrează routines existente la cererea proprietarului; nu creează și nu declanșează fără aprobare.
- **Test necesar:** Niciunul fără aprobare.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Skills doar din ~/.claude/skills nu sunt disponibile în routines.
- **Surse citite:** https://code.claude.com/docs/en/routines · https://code.claude.com/docs/en/feature-availability · https://code.claude.com/docs/en/skills
- **Verificare adversarială:** CONFIRMED — routines: research preview, Pro/Max/Team/Enterprise, minim 1 oră, endpoint /fire cu header experimental-cc-routine-2026-04-01, text încadrat ca date neîncredere, fără prompturi de permisiune, conectorii pot scrie, plafon zilnic, rulările one-off exceptate, usage credits la depășire.

### /loop și programare în sesiune (CronCreate/CronList/CronDelete) (`an-cc-loop-cron`)

- **Sursă oficială:** https://code.claude.com/docs/en/scheduled-tasks
- **Documentație tehnică:** https://code.claude.com/docs/en/scheduled-tasks
- **Ce face:** Re-rulează un prompt la interval (minim 1 minut) sau la ritm ales de Claude cât sesiunea este deschisă; sarcinile recurente expiră după 7 zile, maxim 50 per sesiune.
- **Plan necesar:** Toate planurile.
- **Platformă:** Local.
- **Rollout:** GA
- **Eligibilitate cont:** Max verificat.
- **Autentificare:** claude.ai.
- **Allowance:** Fiecare declanșare retrimite tot contextul.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Consum recurent nevăzut de Hub.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Mecanism: unelte CronCreate/CronList/CronDelete/ScheduleWakeup; rulează doar când sesiunea e deschisă și inactivă; restaurate la --resume; dezactivare CLAUDE_CODE_DISABLE_CRON=1. \| Disponibil pe plan: da. \| Controlabil programatic: doar prin prompt. \| Reutilizabil din Hub: nu — programarea canonică este în Hub. \| Interacțiune: nu. \| Securitate: consum ascuns și acțiuni repetate.
- **Suprafață nativă:** /loop.
- **Cerințe locale:** Niciuna.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Dezactivat în run-urile Hub.
- **Suprafață de execuție:** anthropic.claude_code_interactive
- **Echivalent la celălalt ecosistem:** Automatizări locale Codex (in_app_local_automation, neverificat).
- **Ce face unic / mai bine:** Polling rapid în sesiune.
- **Securitate:** Programări duble.
- **Cale de implementare:** REJECT în run-urile Hub: env CLAUDE_CODE_DISABLE_CRON=1.
- **Test necesar:** Test simulat al env-ului.
- **Status:** AVAILABLE
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Proprietarul îl poate folosi liber în sesiunile proprii.
- **Surse citite:** https://code.claude.com/docs/en/scheduled-tasks · https://code.claude.com/docs/en/costs · local: scanare stringuri claude.exe (CronCreate, ScheduleWakeup prezente)
- **Verificare adversarială:** CONFIRMED — scheduled-tasks: interval minim 1 minut, expirare după 7 zile, maxim 50 per sesiune, rulare doar cu sesiunea deschisă și inactivă, restaurare la --resume/--continue, CLAUDE_CODE_DISABLE_CRON=1.

### Sarcini programate locale în Claude Desktop (`an-cc-desktop-scheduled-tasks`)

- **Sursă oficială:** https://code.claude.com/docs/en/desktop-scheduled-tasks
- **Documentație tehnică:** https://code.claude.com/docs/en/desktop-scheduled-tasks
- **Ce face:** Desktop pornește sesiuni noi pe mașina locală la program (minim 1 minut) cât aplicația este deschisă și PC-ul treaz; o singură rulare de recuperare pentru ultimele 7 zile.
- **Plan necesar:** Toate planurile cu Desktop ≥1.1.5368.
- **Platformă:** Claude Desktop (Windows).
- **Rollout:** GA
- **Eligibilitate cont:** Max; unelte MCP scheduled-tasks prezente în sesiunea Desktop.
- **Autentificare:** claude.ai în Desktop.
- **Allowance:** Cota Max.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Mecanism: creare în Desktop (Code > Routines > Local) sau prin conversație; promptul în ~/.claude/scheduled-tasks/<nume>/SKILL.md (programul, folderul și modelul nu sunt în fișier); unelte MCP list/create/update/delete/run/list_task_runs doar în sesiunile Desktop; mod de permisiune per task, aprobări 'always allow' persistente. \| Disponibil pe plan: da. \| Controlabil programatic: doar prin MCP-ul Desktop. \| Reutilizabil din Hub: listare read-only. \| Interacțiune: creare și aprobări de către proprietar. \| Securitate: rulări nesupravegheate cu acces la fișiere locale; al doilea planificator.
- **Suprafață nativă:** Claude Desktop, pagina Routines.
- **Cerințe locale:** Desktop deschis, PC treaz.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Oglindă read-only a sarcinilor programate ale proprietarului.
- **Suprafață de execuție:** anthropic.claude_scheduled_desktop
- **Echivalent la celălalt ecosistem:** Automatizări locale ChatGPT/Codex desktop (neverificate aici).
- **Ce face unic / mai bine:** Acces la fișiere locale; catch-up după sleep.
- **Securitate:** Programări paralele cu Hub.
- **Cale de implementare:** MIRROR_STATE: listarea fișierelor SKILL.md (fără conținut sensibil) sau prin list_scheduled_tasks la cererea proprietarului.
- **Test necesar:** Listare read-only.
- **Status:** AVAILABLE
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** medium
- **Note:** Crearea de task-uri este interzisă în BUILD_SAFE.
- **Surse citite:** https://code.claude.com/docs/en/desktop-scheduled-tasks · https://code.claude.com/docs/en/scheduled-tasks · local: sources-anthropic-local.md (MCP scheduled-tasks disponibil, 0 task-uri)
- **Verificare adversarială:** CONFIRMED — desktop-scheduled-tasks: Desktop ≥1.1.5368, minim 1 minut, doar cu aplicația deschisă și PC-ul treaz, o singură rulare de recuperare pentru ultimele 7 zile, SKILL.md fără program/folder/model, mod de permisiune per task și aprobări always allow.

### Taskuri programate în Cowork (execuție la distanță) (`an-cowork-scheduled-tasks`)

- **Sursă oficială:** https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork
- **Documentație tehnică:** https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork
- **Ce face:** Taskuri recurente (orar, zilnic, săptămânal, zile lucrătoare) sau la cerere, create cu ajutorul lui Claude (/schedule sau Create with Claude) ori manual (nume, prompt, mod de aprobare, frecvență, model opțional); rulează la distanță în cloud, chiar dacă computerul doarme sau aplicația este închisă, cu conectorii și fișierele salvate în cont; nu pot fi legate de un folder de pe computer, iar un task care are nevoie de fișiere sau aplicații locale rulează doar local; au aceleași capabilități ca un task Cowork.
- **Plan necesar:** Toate planurile plătite.
- **Platformă:** Desktop, web (beta), mobil
- **Rollout:** Din 2026-02-25; taskurile programate rulează acum în cloud (Desktop v1.52386.3 din 2026-09-11 ajustează mutarea automată în cloud a taskurilor existente, pentru conturile unde a început); de la 2026-10-06 taskurile Cowork noi pe Pro/Max rulează în cloud.
- **Eligibilitate cont:** Inclus în Max; serverul MCP scheduled-tasks raportează 0 taskuri.
- **Autentificare:** Sesiune claude.ai.
- **Allowance:** Fiecare rulare consumă din limitele planului; articolul nu detaliază consumul.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Rulările nesupravegheate pot epuiza limitele; peste limită doar cu usage credits.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Niciun API documentat; gestionare din secțiunea Scheduled (Run now, Pause/Resume, Edit, Delete).
- **Suprafață nativă:** Bara laterală Scheduled; comanda /schedule în Cowork.
- **Cerințe locale:** Niciuna pentru taskurile cloud; Desktop online pentru cele locale.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Scheduler-ul canonic rămâne în Hub; proprietarul poate crea manual rapoarte recurente în Cowork, înregistrate în Hub ca automatizări externe.
- **Suprafață de execuție:** anthropic.claude_cowork_scheduled_cloud
- **Echivalent la celălalt ecosistem:** Sarcinile de echipă ChatGPT (Business, Enterprise) și in_app_local_automation din Codex (activ local).
- **Ce face unic / mai bine:** Rulează fără computer pornit, cu conectori și skill-uri ale contului.
- **Securitate:** Rulări nesupravegheate cu conectori care pot scrie; modul de aprobare se alege per task.
- **Cale de implementare:** ASSISTED: Hub-ul generează prompt și cadență; nu creează taskuri.
- **Test necesar:** Nu
- **Status:** ASSISTED_ONLY
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Articolul nu precizează numărul maxim de taskuri sau notificările.
- **Surse citite:** https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork · https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork · https://support.claude.com/en/articles/15520349 · https://support.claude.com/en/articles/12138966-release-notes · https://claude.com/docs/cowork/changelog
- **Verificare adversarială:** CORRECTED (corectat: whatItDoes (https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork), rollout (https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork ; https://claude.com/docs/cowork/changelog)) — Planurile (toate planurile plătite) și lipsa unui API sunt confirmate. Înregistrarea sugera un folder local opțional; articolul spune explicit că taskurile nu pot fi legate de un folder de pe computer. Serverul MCP scheduled-tasks din sesiunea Desktop poate reflecta taskurile locale din Code tab, nu neapărat pe cele Cowork din cloud.

### Taskuri programate locale în Claude Desktop (Code > Routines > Local) (`an-desktop-local-scheduled-tasks`)

- **Sursă oficială:** https://code.claude.com/docs/en/desktop-scheduled-tasks
- **Documentație tehnică:** https://code.claude.com/docs/en/desktop-scheduled-tasks
- **Ce face:** Pornește automat o sesiune Claude Code nouă pe mașina locală după program (Manual, Hourly, Daily, Weekdays, Weekly sau personalizat, minim 1 minut), cu folder, mod de permisiune, model și opțional worktree izolat; rulează doar cu aplicația deschisă și computerul treaz; la trezire face o singură rulare de recuperare pentru ultimele 7 zile; promptul stă în ~/.claude/scheduled-tasks/<nume>/SKILL.md.
- **Plan necesar:** Planuri claude.ai cu Claude Desktop (Code tab); Desktop ≥ 1.1.5368.
- **Platformă:** Claude Desktop macOS/Windows
- **Rollout:** GA
- **Eligibilitate cont:** Disponibil: serverul MCP scheduled-tasks (list, create, update, delete, run, list_task_runs) este expus sesiunii Desktop curente; 0 taskuri.
- **Autentificare:** Sesiune claude.ai în Desktop.
- **Allowance:** Fiecare rulare este o sesiune completă din limitele planului.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Rulările automate pot consuma fereastra de 5 ore fără supraveghere; peste limită doar cu usage credits.
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Instrumentele MCP (create_scheduled_task, update_scheduled_task etc.) sunt oferite doar sesiunilor din Desktop, nu unui client extern; definițiile pot fi citite read-only din ~/.claude/scheduled-tasks/*/SKILL.md (programul, folderul, modelul și starea nu sunt în fișier).
- **Suprafață nativă:** Code tab > Routines > New routine > Local; secțiunea Scheduled din bara laterală; panoul Always allowed.
- **Cerințe locale:** Desktop deschis și computer treaz (Keep computer awake).
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Hub-ul inventariază read-only taskurile locale existente pentru panoul de consum și risc; nu creează taskuri.
- **Suprafață de execuție:** anthropic.claude_scheduled_desktop
- **Echivalent la celălalt ecosistem:** in_app_local_automation din Codex (activ local).
- **Ce face unic / mai bine:** Acces la fișiere locale, aprobări salvate per task, worktree izolat.
- **Securitate:** Taskurile pot rula cu permisiuni salvate și pot face commituri sau PR-uri; prompturile de pe disc pot fi modificate de orice proces local.
- **Cale de implementare:** Adaptor MIRROR_STATE care listează numele și descrierea din SKILL.md fără executare și semnalează taskurile care vizează folderul Hub.
- **Test necesar:** Test local de parsare pe director gol și pe fixture.
- **Status:** AVAILABLE
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** high
- **Note:** Un task își poate modifica singur programul prin update_scheduled_task.
- **Surse citite:** https://code.claude.com/docs/en/desktop-scheduled-tasks · https://claude.com/docs/cowork/changelog · dovadă locală: sources-anthropic-local.md
- **Verificare adversarială:** CONFIRMED — Confirmat textual în desktop-scheduled-tasks: Desktop ≥ 1.1.5368, rulare doar cu aplicația deschisă și computerul treaz, interval minim 1 minut, o singură rulare de recuperare pentru ultimele 7 zile, SKILL.md fără program/folder/model/stare, aprobări salvate per task, update_scheduled_task poate modifica propriul program. Changelog-ul Desktop v1.44121.1 (2026-09-02) a adăugat /schedule și pagina Scheduled în Code tab. MIRROR_STATE rămâne coerent.

### Routines (Claude Code programat în cloud, cu declanșatori API și GitHub) (`an-routines-cloud`)

- **Sursă oficială:** https://code.claude.com/docs/en/routines
- **Documentație tehnică:** https://code.claude.com/docs/en/routines
- **Ce face:** Configurații salvate (prompt, repo-uri GitHub, mediu cloud, conectori) rulate automat pe infrastructura Anthropic: programat (minim 1 oră; cron prin /schedule update), prin POST HTTP la endpoint-ul /fire cu token per rutină, sau la evenimente GitHub (pull request, release).
- **Plan necesar:** Pro, Max, Team, Enterprise.
- **Platformă:** claude.ai/code/routines, Desktop (Routines > Cloud), CLI /schedule (alias /routines)
- **Rollout:** Research preview; /fire sub antetul beta experimental-cc-routine-2026-04-01.
- **Eligibilitate cont:** Eligibil pe Max; necesită GitHub și sesiuni cloud configurate; nicio rutină verificată.
- **Autentificare:** Login claude.ai pentru creare; declanșarea API folosește un token bearer per rutină generat în UI și afișat o singură dată.
- **Allowance:** Consumă din limitele abonamentului ca sesiunile interactive, plus un plafon zilnic de rulări (rulările one-off nu intră în plafon).
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** La plafon sau limită, rulările continuă doar cu usage credits activate; altfel sunt respinse.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** POST https://api.anthropic.com/v1/claude_code/routines/<id>/fire cu Authorization: Bearer <token>, anthropic-beta: experimental-cc-routine-2026-04-01, anthropic-version: 2023-06-01 și corp JSON cu câmpul text (livrat rutinei ca routine-fire-payload neîncrezut); răspunsul conține claude_code_session_id și URL. Endpoint doar pentru utilizatori claude.ai, nu face parte din API-ul Claude Platform. /schedule list\|update\|run în CLI.
- **Suprafață nativă:** claude.ai/code/routines; Desktop Routines; /schedule.
- **Cerințe locale:** Nimic local; repo pe GitHub cu Claude GitHub App pentru declanșatori GitHub.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Opțiune viitoare pentru joburi cloud declanșate de Hub, numai după aprobare, cu token în stocarea de secrete și conectori limitați; acum doar referință.
- **Suprafață de execuție:** anthropic.claude_routines_cloud
- **Echivalent la celălalt ecosistem:** Codex în cloud (codex cloud exec) și MCP Events pentru automatizări cu pluginuri ChatGPT.
- **Ce face unic / mai bine:** Declanșare HTTP cu autentificare de abonament; rulează cu computerul oprit.
- **Securitate:** Rulează autonom fără selector de permisiuni; toți conectorii sunt incluși implicit, cu scrieri fără aprobare; oricine are token-ul poate declanșa; codul trebuie să fie pe GitHub; acțiunile apar ca proprietarul.
- **Cale de implementare:** REFERENCE acum; o integrare ar stoca token-ul în vault-ul Hub, ar limita conectorii și ar cere grant per declanșare.
- **Test necesar:** Niciun test fără aprobare (orice rulare consumă din plan).
- **Status:** NEEDS_SETUP
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Token-ul are aspectul unui token OAuth Anthropic și trebuie tratat ca secret; o conexiune GitHub expirată oprește rutina după 72 de ore.
- **Surse citite:** https://code.claude.com/docs/en/routines · https://code.claude.com/docs/en/feature-availability · https://code.claude.com/docs/en/desktop-scheduled-tasks · https://code.claude.com/docs/en/claude-projects
- **Verificare adversarială:** CONFIRMED — Confirmat textual: research preview; Pro/Max/Team/Enterprise; programare cu minim 1 oră și cron prin /schedule update; /fire cu Bearer per rutină, anthropic-beta experimental-cc-routine-2026-04-01, anthropic-version 2023-06-01, câmp text învelit ca routine-fire-payload; endpoint doar pentru utilizatori claude.ai; declanșatori GitHub pull request/release; toți conectorii incluși implicit; consum din abonament plus plafon zilnic (one-off exceptate); continuare doar cu usage credits; oprire după 72 de ore fără GitHub.

## documents

### Artifacts din Claude Code (unealta Artifact, /artifacts) (`an-cc-artifacts`)

- **Sursă oficială:** https://code.claude.com/docs/en/artifacts
- **Documentație tehnică:** https://code.claude.com/docs/en/artifacts
- **Ce face:** Publică pagini HTML/Markdown private pe claude.ai din sesiune, actualizate în loc, cu partajare, date live prin conectori și, pe Team/Enterprise, comentarii.
- **Plan necesar:** Pro, Max, Team (activat implicit) și Enterprise (activat de Owner), cu sesiune claude.ai prin /login; indisponibil cu API key, token de gateway sau furnizori cloud.
- **Platformă:** CLI, Desktop; implicit oprit în Agent SDK, GitHub Action și contexte MCP-server.
- **Rollout:** GA
- **Eligibilitate cont:** Max eligibil; versiunea locală conține funcția într-o formă mai veche.
- **Autentificare:** claude.ai.
- **Allowance:** Generarea consumă tokeni de ieșire.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Mecanism: unealta Artifact (în afara plan mode poate publica fără prompt la cererea utilizatorului); /artifacts listează; dezactivare: enableArtifact false, CLAUDE_CODE_DISABLE_ARTIFACT=1 sau deny Artifact. \| Disponibil pe plan: da. \| Controlabil programatic: prin model în sesiune. \| Reutilizabil din Hub: proprietarul publică rapoarte, Hub înregistrează URL-ul. \| Interacțiune: partajarea este manuală. \| Securitate: egress de conținut către claude.ai; în run-urile Hub unealta rămâne exclusă prin --tools.
- **Suprafață nativă:** claude.ai/code/artifacts.
- **Cerințe locale:** Niciuna.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Canal de raportare asistat, în afara execuției Hub.
- **Suprafață de execuție:** anthropic.claude_artifacts
- **Echivalent la celălalt ecosistem:** OpenAI Dynamic Pages / Space pages.
- **Ce face unic / mai bine:** Pagini live cu conectori per vizitator.
- **Securitate:** Publicare de conținut fără prompt în afara plan mode.
- **Cale de implementare:** ASSISTED; în run-uri Hub, Artifact rămâne exclus.
- **Test necesar:** Test simulat: Artifact absent din --tools.
- **Status:** AVAILABLE
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Nu se publică nimic din date private fără decizia proprietarului.
- **Surse citite:** https://code.claude.com/docs/en/artifacts · https://code.claude.com/docs/en/tools-reference · local: scanare stringuri claude.exe (disableArtifact prezent)
- **Verificare adversarială:** CORRECTED (corectat: planRequired (https://code.claude.com/docs/en/artifacts ; https://code.claude.com/docs/en/feature-availability)) — artifacts confirmă publicarea fără prompt în afara plan mode pentru prompturile tastate, dezactivarea prin enableArtifact/CLAUDE_CODE_DISABLE_ARTIFACT/deny Artifact și oprirea implicită în Agent SDK, GitHub Action și contexte MCP-server; nuanța pentru Enterprise adăugată.

### Artifacts în claude.ai (livrabile interactive lângă conversație) (`an-artifacts-chat`)

- **Sursă oficială:** https://support.claude.com/en/articles/17153992
- **Documentație tehnică:** https://support.claude.com/en/articles/17153992
- **Ce face:** Livrabile generate de Claude (designuri, prezentări, documente, dashboarduri, instrumente interactive) deschise lângă conversație, editabile și partajabile; pornesc private; stocare de până la 20 MB text per artifact; conectorii apelați din artifact cer autorizarea fiecărui utilizator.
- **Plan necesar:** Crearea: toate planurile inclusiv Free; șabloanele Design/Slides/Docs: planuri plătite (beta).
- **Platformă:** claude.ai web, Desktop, Claude Code, iOS, Android
- **Rollout:** GA; artifacts create în chat înainte de 2026-09-16 devin „legacy”; șabloanele Design/Slides/Docs sunt în beta din 2026-09-16 (doar planuri plătite); Desktop v2.110.0 (2026-09-15) a reparat citirea și actualizarea artifacts existente din taskurile Cowork.
- **Eligibilitate cont:** Disponibil pe Max.
- **Autentificare:** Sesiune claude.ai.
- **Allowance:** Limitele planului autorului la creare; la un artifact partajat, utilizarea se contorizează în limitele fiecărui vizitator, nu ale autorului, pe orice plan.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar prin usage credits activate.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** În chat nu există API; ruta programatică este publicarea din Claude Code (an-artifacts-claude-code). Necesită Settings > Capabilities > Cloud code execution and file creation.
- **Suprafață nativă:** Fila Artifacts; selectorul Output din caseta de mesaj.
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință; proprietarul poate construi vizualizări ad-hoc, Hub-ul are UI local propriu.
- **Suprafață de execuție:** anthropic.claude_artifacts
- **Echivalent la celălalt ecosistem:** ChatGPT Dynamic Pages (Pro, Business, Enterprise conform recap) și Canvas.
- **Ce face unic / mai bine:** Stocare persistentă în artifact, conectori live cu permisiunea vizitatorului.
- **Securitate:** Pe Pro/Max singura partajare este linkul public; conectorii rulează cu contul vizitatorului.
- **Cale de implementare:** Nimic de implementat.
- **Test necesar:** Nu
- **Status:** ASSISTED_ONLY
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Anularea publicării unui artifact vechi șterge definitiv datele stocate.
- **Surse citite:** https://support.claude.com/en/articles/17153992 · https://support.claude.com/en/articles/12111783-create-and-edit-files-with-claude · https://claude.com/docs/cowork/changelog
- **Verificare adversarială:** CORRECTED (corectat: rollout (https://support.claude.com/en/articles/17153992 ; https://claude.com/docs/cowork/changelog), allowance (https://support.claude.com/en/articles/17153992)) — Confirmat: crearea pe toate planurile inclusiv Free, șabloane în beta doar pe planuri plătite (implicit active pe Pro/Max/Team), 20 MB text per artifact, conectori cu contul vizitatorului, necesită Cloud code execution and file creation. În changelog nu există o intrare din 2026-09-17 despre artifacts; modificarea relevantă este fix-ul din 2026-09-15.

### Artifacts publicate din Claude Code (instrumentul Artifact, /artifacts) (`an-artifacts-claude-code`)

- **Sursă oficială:** https://code.claude.com/docs/en/artifacts
- **Documentație tehnică:** https://code.claude.com/docs/en/artifacts
- **Ce face:** Claude Code publică o pagină HTML sau Markdown auto-conținută la un URL privat claude.ai/code/artifact/…, actualizată în loc la fiecare republicare (versiuni selectabile); paginile pot apela conectori claude.ai la vizualizare, oferi descărcări, primi comentarii (Team/Enterprise); limită 16 MiB, CSP strict, fără backend.
- **Plan necesar:** Pro, Max, Team; Enterprise cu activare admin.
- **Platformă:** Claude Code CLI și Claude Desktop ≥ 1.13576.0; nu pe Bedrock, Vertex sau Foundry.
- **Rollout:** Disponibil; /artifacts cere v2.1.208+, conectorii din pagină v2.1.209+, comentariile v2.1.221+.
- **Eligibilitate cont:** Instrumentul Artifact este expus sesiunii Desktop curente (dovadă locală); CLI-ul npm 2.1.175 este sub versiunile minime pentru /artifacts.
- **Autentificare:** Obligatoriu login claude.ai (/login); sesiunile cu cheie API, token de gateway sau furnizor cloud nu pot publica.
- **Allowance:** Tokeni de ieșire din limitele planului; paginile stilizate costă mai mult decât textul.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar prin usage credits activate.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Instrument intern Artifact în sesiunile Claude Code CLI și Desktop. Dezactivare: enableArtifact: false (setat prin --settings, în setările user sau managed nu mai poate fi reactivat; în setările de proiect e respectat de la v2.1.242), CLAUDE_CODE_DISABLE_ARTIFACT=1 sau Artifact în permissions.deny; CLAUDE_CODE_ARTIFACT_AUTO_OPEN=0 oprește deschiderea browserului. Oprit implicit în contextele Agent SDK, GitHub Action și MCP-server și cu CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC; pagina headless descrie claude -p ca „Agent SDK via the CLI”, deci workerii -p ai Hub-ului sunt foarte probabil în regimul oprit implicit, iar reactivarea în -p nu este documentată. Cu feature-flag fetching oprit, Claude Code cere aprobare înainte de prima publicare. Listare/ștergere prin Compliance API pentru organizații.
- **Suprafață nativă:** Galeria claude.ai/code/artifacts, butonul Share, /artifacts și Ctrl+] în CLI.
- **Cerințe locale:** Claude Code recent (≥ 2.1.208 pentru listare); acces la api.anthropic.com pentru politica organizației.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Opțional, publicarea privată a rapoartelor de misiune doar cu grant explicit; implicit oprit în workerii Hub.
- **Suprafață de execuție:** anthropic.claude_code_interactive
- **Echivalent la celălalt ecosistem:** ChatGPT Dynamic Pages și Sites (Sites cu pluginuri: Business+).
- **Ce face unic / mai bine:** Pagini vii actualizate în timpul sesiunii, date live prin conectori, private implicit.
- **Securitate:** În afara plan mode, un artifact nou publicat la un prompt tastat nu cere permisiune; conținutul ajunge pe infrastructura Anthropic; pe Max partajarea înseamnă link public; paginile altora sunt date neîncrezute.
- **Cale de implementare:** Adaptorul V2 adaugă CLAUDE_CODE_DISABLE_ARTIFACT=1 (sau regula deny) în mediul controlat al fiecărui turn; o capabilitate separată „publică raport” ar reactiva instrumentul doar cu grant per publicare și ar înregistra URL-ul în audit.
- **Test necesar:** Test simulat că variabila/regula apare în mediul și argumentele adaptorului; test live doar cu aprobare.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Auditul claude_artifact_* și politicile de retenție există doar pentru Team/Enterprise.
- **Surse citite:** https://code.claude.com/docs/en/artifacts · https://code.claude.com/docs/en/feature-availability · https://support.claude.com/en/articles/17153992 · dovadă locală: sources-anthropic-local.md
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://code.claude.com/docs/en/artifacts ; https://code.claude.com/docs/en/headless)) — Restul confirmat: planuri Pro/Max/Team și Enterprise cu activare, login claude.ai obligatoriu, nu pe Bedrock/Vertex/Foundry, Desktop ≥ 1.13576.0, versiunile 2.1.208/2.1.209/2.1.221, 16 MiB, CSP strict, publicare fără prompt în afara plan mode, pe Pro/Max doar link public (paginile cu conectori rămân private), audit claude_artifact_*. Decizia WRAP rămâne coerentă, dar partea de reactivare per grant trebuie verificată separat.

### Claude Docs (documente vii colaborative) (`an-claude-docs`)

- **Sursă oficială:** https://support.claude.com/en/articles/16923645
- **Documentație tehnică:** https://code.claude.com/docs/en/artifacts
- **Ce face:** Documente redactate de Claude pe ecran și editate în timp real cu echipa, cu comentarii și mențiuni @Claude, grafice/diagrame fără actualizare automată, export .docx, PDF, Markdown, Google Docs sau Claude Slides; salvate în fila Artifacts.
- **Plan necesar:** Beta pe Pro, Max, Team (activ implicit) și Enterprise (activare owner); indisponibil cu CMEK, ZDR sau HIPAA.
- **Platformă:** claude.ai web, Desktop, Claude Code, iOS/Android (doar vizualizare pe mobil)
- **Rollout:** Beta din 2026-09-16
- **Eligibilitate cont:** Conectorul Claude Docs (8 instrumente) este activ în sesiunea Desktop curentă, deci funcția este pornită pe cont.
- **Autentificare:** Sesiune claude.ai; în Claude Code, conector claude.ai.
- **Allowance:** Intră în limitele planului; cererile mari consumă mai mult.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar prin usage credits activate.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Ajunge în Claude Code ca conector „claude.ai Claude Docs”, furnizat de Anthropic fără configurare pe conturile eligibile (vizibil în /mcp); instrumente observate local: create, batch, update, read, query, export, delete, guide. Pagina Agent SDK (claude -p este Agent SDK prin CLI) precizează că la login claude.ai conectorii claude.ai se încarcă și în SDK, iar mcpServers gol nu îi suprimă; se opresc cu --strict-mcp-config/strictMcpConfig, disableClaudeAiConnectors, ENABLE_CLAUDEAI_MCP_SERVERS=false, deniedMcpServers [„claude.ai Claude Docs”] sau toggle /mcp.
- **Suprafață nativă:** claude.ai/artifacts; Output > Docs; comentarii în document.
- **Cerințe locale:** Login claude.ai; conectorul trebuie permis în sesiune.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Destinație opțională pentru documente destinate oamenilor (oferte, specificații); Hub-ul păstrează sursa canonică și linkul.
- **Suprafață de execuție:** anthropic.claude_artifacts
- **Echivalent la celălalt ecosistem:** ChatGPT Dynamic Pages (Pro, Business, Enterprise).
- **Ce face unic / mai bine:** Colaborare în timp real, export Word/PDF/Google Docs, atribuirea modificărilor.
- **Securitate:** Pe Pro/Max partajarea este prin link public; fără istoric de versiuni; conținutul stă în cloud-ul Anthropic.
- **Cale de implementare:** Workerii Hub rulează cu --strict-mcp-config (conectorul nu se încarcă); o misiune de tip „document partajat” ar permite explicit doar acest conector, cu aprobare.
- **Test necesar:** Test live doar cu aprobare (crearea unui document consumă din plan).
- **Status:** AVAILABLE
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Nu există nivel doar-comentariu; Compliance API nu înregistrează încă activitatea din documente.
- **Surse citite:** https://support.claude.com/en/articles/16923645 · https://support.claude.com/en/articles/17153992 · https://code.claude.com/docs/en/artifacts · dovadă locală: sources-anthropic-local.md
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://code.claude.com/docs/en/mcp ; https://code.claude.com/docs/en/agent-sdk/claude-code-features ; https://code.claude.com/docs/en/headless)) — Confirmat textual: beta pe Pro/Max/Team (activ implicit) și Enterprise (activare owner), indisponibil cu CMEK/ZDR/HIPAA, mobil doar vizualizare, export Word/PDF/Markdown/Google Docs și conversie Slides, partajare prin link pe Pro/Max, fără istoric de versiuni și fără nivel doar-comentariu, Compliance API încă neacoperit.

### Claude Slides (prezentări editabile) (`an-claude-slides`)

- **Sursă oficială:** https://support.claude.com/en/articles/17153992
- **Documentație tehnică:** https://code.claude.com/docs/en/artifacts
- **Ce face:** Prezentări construite din note, rapoarte sau conversație, cu editare directă a slide-urilor, prezentare din aplicație și export PowerPoint (.pptx) și PDF.
- **Plan necesar:** Șablon beta pe Pro, Max, Team (implicit activ); Enterprise cu activare owner.
- **Platformă:** claude.ai web, Desktop (editare într-un browser desktop), Claude Code, mobil
- **Rollout:** Beta din 2026-09-16
- **Eligibilitate cont:** Probabil activ pe Max (șabloanele sunt implicite); neverificat direct.
- **Autentificare:** Sesiune claude.ai.
- **Allowance:** Limitele planului.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar prin usage credits activate.
- **Risc de facturare API:** low
- **Integrare programatică:** UNKNOWN
- **Detaliu integrare:** Comanda /slides <brief> în Claude Code (≥ v2.1.265, într-o sesiune cu artifacts disponibile); CLI-ul local 2.1.175 nu îndeplinește versiunea; folosirea în claude -p nu este documentată.
- **Suprafață nativă:** Output > Slides; fila Artifacts.
- **Cerințe locale:** Claude Code ≥ 2.1.265 (actualizarea necesită aprobarea proprietarului).
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Proprietarul produce prezentări pentru clienți pornind de la briefinguri exportate de Hub.
- **Suprafață de execuție:** anthropic.claude_artifacts
- **Echivalent la celălalt ecosistem:** ChatGPT Collaborative Slides (Pro, Business, Enterprise; export PowerPoint/Google Slides).
- **Ce face unic / mai bine:** Integrare cu Docs și Design; export .pptx nativ.
- **Securitate:** Conținutul de client ajunge în cloud; partajare publică pe Pro/Max.
- **Cale de implementare:** Acum ASSISTED; eventual o capabilitate viitoare cu /slides după actualizarea CLI și un test aprobat.
- **Test necesar:** Verificarea versiunii CLI; test live doar cu aprobare.
- **Status:** ASSISTED_ONLY
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Dacă organizația dezactivează șablonul, /slides nu apare.
- **Surse citite:** https://support.claude.com/en/articles/17153992 · https://code.claude.com/docs/en/artifacts · https://support.claude.com/en/articles/16923645
- **Verificare adversarială:** CONFIRMED — Confirmat: șablon beta doar pe planuri plătite, activ implicit pe Pro/Max/Team, Enterprise cu activare owner; /slides cere Claude Code ≥ v2.1.265 și o sesiune cu artifacts disponibile; export PowerPoint/PDF. programmaticIntegration UNKNOWN este justificat: artifacts sunt oprite implicit în contextele Agent SDK, iar documentația tratează claude -p ca Agent SDK prin CLI.

### Claude Design (designuri, prototipuri, one-pagers) (`an-claude-design`)

- **Sursă oficială:** https://support.claude.com/en/articles/14604416-get-started-with-claude-design
- **Documentație tehnică:** https://code.claude.com/docs/en/artifacts
- **Ce face:** Creare vizuală conversațională pe canvas (artboards): mockup-uri, prototipuri interactive, pagini de prezentare; preia automat design system-ul (GitHub, fișiere, încărcări, cod local prin /design-sync); editare prin chat, comentarii inline și control direct; export ZIP, PDF, PPTX, HTML, Google Slides (doar claude.ai/design) și integrări (Canva, Vercel, Netlify, Miro etc.); predare către Claude Code.
- **Plan necesar:** Beta pe Pro, Max, Team (activ implicit); Enterprise cu activare owner.
- **Platformă:** claude.ai/design, conversații (Output > Design), Claude Code (/design, /design-sync), mobil doar vizualizare
- **Rollout:** Lansat 2026-04-17 (Anthropic Labs); integrat ca șablon de artifact 2026-09-16.
- **Eligibilitate cont:** Probabil disponibil pe Max; neverificat direct.
- **Autentificare:** Sesiune claude.ai.
- **Allowance:** Aceleași limite ca restul Claude, fără alocare separată; la limită designurile devin indisponibile până la resetare sau usage credits.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Continuarea peste limită presupune usage credits (dezactivate implicit); exporturile către servicii terțe pot avea costuri proprii.
- **Risc de facturare API:** low
- **Integrare programatică:** UNKNOWN
- **Detaliu integrare:** /design <brief> (≥ v2.1.265) și /design-sync în Claude Code, doar cu login claude.ai; utilizarea în claude -p nu este documentată.
- **Suprafață nativă:** claude.ai/design; Output > Design; fila Artifacts.
- **Cerințe locale:** Claude Code ≥ 2.1.265 pentru comenzi.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Proprietarul poate prototipa ecrane Hub sau materiale Ifrim Digital; design system-ul Hub poate fi importat manual.
- **Suprafață de execuție:** anthropic.claude_artifacts
- **Echivalent la celălalt ecosistem:** Fără echivalent OpenAI direct confirmat; pluginul Canva apare în catalogul Codex (neinstalat).
- **Ce face unic / mai bine:** Import de design system din cod și predare directă către Claude Code.
- **Securitate:** Importul design system-ului dintr-un repo local trimite cod în cloud; exporturile către Vercel/Netlify publică.
- **Cale de implementare:** ASSISTED: Hub-ul oferă .ifrim/DESIGN_SYSTEM.md curățat ca sursă de import manual.
- **Test necesar:** Nu
- **Status:** ASSISTED_ONLY
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Limitări: fără istoric de versiuni, editarea simultană multi-persoană nesigură, comentariile inline pot eșua.
- **Surse citite:** https://support.claude.com/en/articles/14604416-get-started-with-claude-design · https://support.claude.com/en/articles/17153992 · https://code.claude.com/docs/en/artifacts · https://support.claude.com/en/articles/12138966-release-notes · https://code.claude.com/docs/en/feature-availability
- **Verificare adversarială:** CONFIRMED — Confirmat textual în 14604416: beta pe Pro/Max/Team (activ implicit) și Enterprise (activare owner); aceleași limite ca restul Claude, fără alocare separată; la limită Design devine indisponibil până la resetare, iar cu usage credits activate se poate continua; lansat ca „Claude Design by Anthropic Labs” odată cu Opus 4.7 (2026-04-17). UNKNOWN pentru -p rămâne justificat.

### Creare și editare de fișiere (docx, xlsx, pptx, pdf, cod) cu execuție de cod (`an-file-creation`)

- **Sursă oficială:** https://support.claude.com/en/articles/12111783-create-and-edit-files-with-claude
- **Documentație tehnică:** https://code.claude.com/docs/en/skills
- **Ce face:** Claude rulează cod într-un container izolat pentru a crea și edita Excel cu formule, Word, PowerPoint, PDF, CSV și fișiere de cod; conversii, extragere din PDF, analize și grafice; descărcare sau salvare în Google Drive; din 2026-09-29 Desktop creează direct Google Docs/Sheets/Slides din selectorul Output (Drive conectat). Fișiere de până la 30 MB.
- **Plan necesar:** Toate planurile; pe Free/Pro/Max activ implicit, cu acces la rețea pentru manageri de pachete.
- **Platformă:** claude.ai web, Desktop, mobil; Cowork
- **Rollout:** GA (articol actualizat 2026-08-06)
- **Eligibilitate cont:** Skill-urile Anthropic docx, xlsx, pptx, pdf sunt activate pe cont (ListSkills local).
- **Autentificare:** Sesiune claude.ai; în Claude Code, login claude.ai pentru skill-urile sincronizate.
- **Allowance:** Consumă mai mult din limita planului decât un chat obișnuit.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar prin usage credits activate.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** În aplicații doar UI. Ruta programatică: Claude Code încarcă skill-urile activate pe cont (inclusiv pdf, xlsx) în ~/.claude/skills/synced/ (≥ v2.1.273; în -p cu CLAUDE_CODE_SYNC_SKILLS=1) sau pluginul oficial document-skills@anthropic-agent-skills (github.com/anthropics/skills; skill-urile de documente sunt source-available, nu open source); scripturile rulează local în workspace-ul workerului.
- **Suprafață nativă:** Chat, selectorul Output, Settings > Capabilities (Code execution and file creation, nivel de acces la rețea).
- **Cerințe locale:** Claude Code ≥ 2.1.273 pentru sincronizare (local 2.1.175); runtime-uri pentru scripturile skill-urilor.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Livrabile de birou (oferte, rapoarte, prezentări) produse de un worker Claude în workspace-ul Hub, verificate și aprobate în Hub.
- **Suprafață de execuție:** anthropic.claude_chat
- **Echivalent la celălalt ecosistem:** Pluginurile Codex documents, pdf, spreadsheets, presentations (instalate local din openai-primary-runtime).
- **Ce face unic / mai bine:** Formule Excel funcționale, skill-uri mature, aceeași logică în chat și în Claude Code.
- **Securitate:** Sandboxul cloud cu rețea poate fi folosit la exfiltrare prin prompt injection; skill-urile descărcate rulează scripturi local; licența skill-urilor de documente nu permite redistribuirea lor în Hub.
- **Cale de implementare:** Nu se vendorizează skill-urile source-available; după o actualizare CLI aprobată se folosește sincronizarea oficială sau pluginul oficial, cu listă explicită de skill-uri permise per misiune; fișierele rezultate sunt verificate de Hub.
- **Test necesar:** Verificare fără inferență a listei /skills după actualizare; test live doar cu grant.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** WRAP
- **Încredere:** medium
- **Note:** Pe Team/Enterprise rețeaua sandboxului este oprită implicit; egress-ul nu acoperă MCP.
- **Surse citite:** https://support.claude.com/en/articles/12111783-create-and-edit-files-with-claude · https://claude.com/docs/skills/overview · https://code.claude.com/docs/en/skills · https://github.com/anthropics/skills · https://claude.com/docs/cowork/changelog
- **Verificare adversarială:** CONFIRMED — Confirmat textual: disponibil pe toate planurile, activ implicit cu rețea pe Free/Pro/Max, rețea oprită implicit pe Team/Enterprise, 30 MB per fișier, egress care nu acoperă MCP; crearea de Google Docs/Sheets/Slides din Output este în Desktop v2.16120.0 (2026-09-29); sincronizarea skill-urilor cere v2.1.273; pluginul document-skills@anthropic-agent-skills există, iar skill-urile docx/pdf/pptx/xlsx sunt source-available, nu open source.

### Vizualizări interactive inline (grafice și diagrame în răspuns) (`an-inline-visualizations`)

- **Sursă oficială:** https://support.claude.com/en/articles/12138966-release-notes
- **Documentație tehnică:** https://support.claude.com/en/articles/12138966-release-notes
- **Ce face:** Claude generează grafice, diagrame și vizualizări personalizate direct în răspuns (din 2026-03-12).
- **Plan necesar:** Neprecizat în nota de lansare.
- **Platformă:** claude.ai, Desktop; aplicațiile interactive și pe mobil din 2026-03-25
- **Rollout:** GA
- **Eligibilitate cont:** Conectorul visualize este prezent în sesiunea Desktop curentă.
- **Autentificare:** Sesiune claude.ai.
- **Allowance:** Limitele planului.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar prin usage credits activate.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Fără API documentat.
- **Suprafață nativă:** Răspunsurile din conversație.
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință; Hub-ul are grafice proprii.
- **Suprafață de execuție:** anthropic.claude_chat
- **Echivalent la celălalt ecosistem:** Pluginul visualize din Codex (instalat local).
- **Ce face unic / mai bine:** Fără configurare.
- **Securitate:** Niciuna specifică.
- **Cale de implementare:** Niciuna.
- **Test necesar:** Nu
- **Status:** ASSISTED_ONLY
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Surse citite:** https://support.claude.com/en/articles/12138966-release-notes · dovadă locală: sources-anthropic-local.md
- **Verificare adversarială:** CONFIRMED — Confirmat în release notes: pe 2026-03-12 Claude poate crea grafice, diagrame și vizualizări inline; aplicațiile interactive au ajuns pe mobil pe 2026-03-25; nota nu precizează planurile. Conectorul visualize este prezent în sesiunea Desktop curentă.

### Claude for M365: add-in-uri Claude for Excel, PowerPoint, Word și Outlook (`an-gap-claude-for-m365`)

- **Sursă oficială:** https://claude.com/docs/office-agents/overview
- **Documentație tehnică:** https://claude.com/docs/office-agents/excel
- **Ce face:** Add-in-uri Office care citesc și editează direct fișierul deschis: Excel (celule, formule, formatare, pivot tables, grafice, citări la nivel de celulă), PowerPoint (slide-uri din template-uri, grafice native), Word (redactare, tracked changes, comentarii), Outlook (triere, răspunsuri, programări; cere consimțământ Microsoft Graph de la admin). Partajează contextul conversației între aplicații, aplică skill-urile activate, folosesc conectori și dictare; conversațiile lungi se compactează automat.
- **Plan necesar:** Pro, Max, Team, Enterprise (Excel, PowerPoint și Word GA; Outlook beta)
- **Platformă:** Excel/PowerPoint pe web, Windows cu abonament Microsoft 365 (build ≥16.0.13127.20296), Mac ≥16.46; instalare din Microsoft AppSource
- **Rollout:** GA pentru Claude for Excel, PowerPoint și Word; Claude for Outlook este în beta (Pro, Max, Team, Enterprise) și cere consimțământ Microsoft Graph de la admin.
- **Eligibilitate cont:** Eligibil pe Max; add-in-ul nu este instalat, iar existența unui abonament Microsoft 365 nu a fost verificată.
- **Autentificare:** Login claude.ai în add-in
- **Allowance:** Aceleași limite ca în contul Claude
- **Utilizare partajată:** Comună cu toate suprafețele contului
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar dacă usage credits sunt activate.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Fără API pentru Hub. Istoricul este stocat local în IndexedDB-ul browserului/add-in-ului, nu pe serverele Anthropic, nu se sincronizează între dispozitive; Hub nu îl poate oglindi. Enterprise: sesiunile apar în Compliance API (beta).
- **Suprafață nativă:** Panoul Claude din Excel, PowerPoint, Word, Outlook
- **Cerințe locale:** Microsoft 365 / Office pe web; instalare add-in (acțiune a proprietarului)
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Suprafață pentru livrabile Office operate de proprietar; Hub pregătește brief-ul și arhivează fișierul final.
- **Suprafață de execuție:** anthropic.claude_office_addins
- **Echivalent la celălalt ecosistem:** ChatGPT for Excel/Word/PowerPoint; oa-codex-document-plugins.
- **Ce face unic / mai bine:** Editare nativă în fișierul Office, cu păstrarea formulelor și a template-urilor, și context comun între aplicații.
- **Securitate:** Risc de prompt injection din fișiere și date importate; datele backend se șterg în 30 de zile; nu moștenește retenția personalizată a organizației.
- **Cale de implementare:** ASSISTED: Hub generează instrucțiuni și verifică fișierul rezultat; fără automatizare.
- **Test necesar:** Niciunul automat; validare manuală de către proprietar.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** an-file-creation acoperă doar crearea de fișiere în chat. Articolul de suport redirecționează acum către claude.com/docs/office-agents.
- **Surse citite:** https://claude.com/docs/office-agents/overview.md · https://claude.com/docs/office-agents/excel.md · https://claude.com/docs/office-agents/powerpoint.md · https://support.claude.com/en/articles/12138966-release-notes · https://www.anthropic.com/news/finance-agents · https://claude.com/docs/llms.txt
- **Verificare adversarială:** CORRECTED (corectat: rollout (https://claude.com/docs/office-agents/word.md ; https://claude.com/docs/office-agents/outlook.md), planRequired (https://claude.com/docs/office-agents/excel.md ; https://claude.com/docs/office-agents/word.md ; https://claude.com/docs/office-agents/outlook.md)) — Confirmat: cerințele Excel (Windows cu Microsoft 365, build ≥16.0.13127.20296; Mac ≥16.46), AppSource, context comun între aplicații, istoric local în IndexedDB fără stocare pe servere Anthropic, ștergerea inputurilor pe backend în 30 de zile, Compliance API (beta) pentru Enterprise. Corectat: Word este GA, nu doar „documentat în aceeași familie”.

## collaboration

### Channels (push de evenimente într-o sesiune deschisă) (`an-cc-channels`)

- **Sursă oficială:** https://code.claude.com/docs/en/channels
- **Documentație tehnică:** https://code.claude.com/docs/en/channels
- **Ce face:** Un server MCP împinge evenimente (chat, CI, webhook) într-o sesiune Claude deschisă, iar Claude poate răspunde pe același canal.
- **Plan necesar:** claude.ai sau Console; Pro/Max fără admin; Team/Enterprise cu activare.
- **Platformă:** Local; pluginurile oficiale necesită Bun.
- **Rollout:** Research preview
- **Eligibilitate cont:** Max eligibil.
- **Autentificare:** claude.ai.
- **Allowance:** Fiecare eveniment poate porni un turn.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Mecanism: `claude --channels plugin:<nume>@<marketplace>` (nelistat în help); pluginuri Telegram, Discord, iMessage, fakechat; canal propriu doar cu `--dangerously-load-development-channels` în preview; allowlist de expeditori; relay de permisiuni opțional. \| Disponibil pe plan: da. \| Controlabil programatic: da, prin server MCP. \| Reutilizabil din Hub: potențial canal Hub → sesiune pentru notificări, după ieșirea din preview. \| Interacțiune: sesiunea trebuie să fie deschisă. \| Securitate: oricine din allowlist poate aproba unelte prin relay; prompt injection din mesaje.
- **Suprafață nativă:** Sesiunea terminal.
- **Cerințe locale:** Bun pentru pluginurile oficiale (neinstalat).
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință pentru notificări push viitoare.
- **Suprafață de execuție:** anthropic.claude_code_interactive
- **Echivalent la celălalt ecosistem:** MCP Events în pluginurile ChatGPT (anunțat la DevDay).
- **Ce face unic / mai bine:** Reacție imediată la evenimente externe.
- **Securitate:** Suprafață de injecție și de aprobare externă.
- **Cale de implementare:** REFERENCE.
- **Test necesar:** Niciunul.
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Flag-ul de dezvoltare nu se folosește în Hub.
- **Surse citite:** https://code.claude.com/docs/en/channels · https://code.claude.com/docs/en/feature-availability · local: scanare stringuri claude.exe (--channels prezent)
- **Verificare adversarială:** CONFIRMED — channels: research preview, claude.ai sau Console API key, Pro/Max fără verificări de organizație, pluginuri oficiale pe Bun, --channels nelistat în help, allowlist de expeditori și relay de permisiuni, funcționează și în -p.

### Mesagerie între sesiuni (SendMessage/ListAgents) (`an-cc-cross-session-messaging`)

- **Sursă oficială:** https://code.claude.com/docs/en/cross-session-messaging
- **Documentație tehnică:** https://code.claude.com/docs/en/cross-session-messaging
- **Ce face:** Claude poate lista și trimite mesaje text altor sesiuni Claude Code locale (sau, prin Remote Control, de pe alte mașini/cloud).
- **Plan necesar:** Toate planurile; peste mașină doar cu claude.ai + Remote Control.
- **Platformă:** Pe Windows nativ necesită v2.1.234+ (named pipe cu token).
- **Rollout:** GA în versiunile noi
- **Eligibilitate cont:** Indisponibil pe CLI local 2.1.175.
- **Autentificare:** Local: socket/named pipe per sesiune.
- **Allowance:** Mesajele primite pornesc turn-uri noi.
- **Utilizare partajată:** Da.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu.
- **Risc de facturare API:** low
- **Integrare programatică:** UNKNOWN
- **Detaliu integrare:** Mecanism: unelte SendMessage/ListAgents; socket de inbox (named pipe pe Windows) cu CLAUDE_CODE_MESSAGING_SOCKET și CLAUDE_CODE_MESSAGING_TOKEN pentru procesele copil; crossSessionInbound accept\|hold\|refuse; isolatePeerMachines. \| Disponibil pe plan: da, dar nu în versiunea locală. \| Controlabil programatic: parțial (scripturi copil). \| Reutilizabil din Hub: nu acum; mesajele nu pot aproba nimic. \| Interacțiune: aprobări pentru mesajele reținute. \| Securitate: mesaje între sesiuni cu permisiuni diferite.
- **Suprafață nativă:** /list-agents.
- **Cerințe locale:** Update CLI.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință.
- **Suprafață de execuție:** anthropic.claude_code_interactive
- **Echivalent la celălalt ecosistem:** `codex queue` (mesaj în coadă către o sesiune existentă).
- **Ce face unic / mai bine:** Coordonare între sesiuni proprii.
- **Securitate:** Mesaje între sesiuni cu permisiuni diferite; după update, și sesiunile `claude -p` își leagă un inbox socket (named pipe pe Windows), iar fără `crossSessionInbound` o sesiune care cere permisiuni (dontAsk/acceptEdits) primește mesajele celorlalte sesiuni locale ale utilizatorului ca turn-uri noi; mesajele nu pot aproba nimic, dar pot direcționa munca.
- **Cale de implementare:** REFERENCE; după orice update ≥2.1.234, run-urile Hub pasează `--settings` cu crossSessionInbound refuse și deny pentru `SendMessage` și `ListAgents`.
- **Test necesar:** Niciunul.
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Hub nu scrie în inbox-urile sesiunilor.
- **Surse citite:** https://code.claude.com/docs/en/cross-session-messaging · https://code.claude.com/docs/en/feature-availability · local: scanare stringuri claude.exe (CLAUDE_CODE_MESSAGING_SOCKET și crossSessionInbound absente)
- **Verificare adversarială:** CORRECTED (corectat: securityConcerns (https://code.claude.com/docs/en/cross-session-messaging), implementationPath (https://code.claude.com/docs/en/cross-session-messaging)) — cross-session-messaging: v2.1.224 pe macOS/Linux, v2.1.234 pe Windows nativ (named pipe cu token CLAUDE_CODE_MESSAGING_TOKEN), mesajele nu pot aproba permisiuni; secțiunea Non-interactive sessions confirmă inbox-ul pentru -p și regula implicită de livrare.

### Claude în Slack: Claude Tag (Team/Enterprise) și varianta anterioară Claude Code in Slack (calea pentru Pro/Max) (`an-gap-claude-in-slack`)

- **Sursă oficială:** https://claude.com/docs/claude-tag/overview
- **Documentație tehnică:** https://code.claude.com/docs/en/slack
- **Ce face:** Claude Tag (public beta, 23.06.2026) pune @Claude în canalele Slack ca identitate comună a organizației, cu conexiuni administrate, memorie per canal și rutine; munca din canale se facturează din soldul de utilizare al organizației, cu spend limit. Varianta anterioară Claude Code in Slack rulează fiecare sesiune sub contul individual: la @Claude cu o sarcină de cod creează o sesiune Claude Code în cloud cu depozitele conectate și limitele planului (moduri Code only sau Code + Chat).
- **Plan necesar:** Claude Tag: Team sau Enterprise (nu Free/Pro/Max). Claude Code in Slack: Pro, Max, Team, Enterprise, cu sesiuni cloud activate.
- **Platformă:** Slack (plan Slack plătit, aprobare de admin Slack)
- **Rollout:** Claude Tag public beta; varianta anterioară se retrage pentru Team/Enterprise, rămâne calea pentru Pro/Max.
- **Eligibilitate cont:** Claude Tag nu este disponibil pe Max. Varianta anterioară este eligibilă pe Max, dar cere un workspace Slack, instalarea aplicației și GitHub conectat la claude.ai/code.
- **Autentificare:** Legare cont Slack ↔ cont Claude (OAuth)
- **Allowance:** Varianta anterioară: limitele planului Max. Claude Tag: soldul organizației.
- **Utilizare partajată:** Alocarea comună Max pentru varianta anterioară
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** Claude Tag cere usage credits pe Team (nimic nu rulează fără sold) și facturare fără plafon pe Enterprise până la setarea unui spend limit.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Fără API pentru Hub; sesiunile create din Slack sunt sesiuni cloud Claude Code, vizibile în claude.ai/code.
- **Suprafață nativă:** Slack (@Claude, App Home > Routing Mode)
- **Cerințe locale:** Workspace Slack; GitHub conectat
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință; ar crea un al doilea proprietar al ciclului de viață al taskurilor (Slack) în afara Hub-ului.
- **Suprafață de execuție:** anthropic.claude_slack
- **Echivalent la celălalt ecosistem:** oa-chatgpt-slack-teams și oa-codex-cloud-integrations (@codex în Slack).
- **Ce face unic / mai bine:** Delegare de sarcini de cod direct din firul de discuție, cu rezultate înapoi în Slack.
- **Securitate:** Conținutul canalelor ajunge în sesiuni cloud; sarcinile pot deschide PR-uri; regula Hub interzice mesaje externe fără cerere explicită.
- **Cale de implementare:** Niciuna acum; dacă proprietarul adoptă Slack, Hub doar înregistrează sesiunile rezultate.
- **Test necesar:** Niciunul
- **Status:** NEEDS_SETUP
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Pentru varianta Claude Tag statusul este PLAN_RESTRICTED pe Max.
- **Surse citite:** https://claude.com/docs/claude-tag/overview.md · https://claude.com/docs/claude-tag/admins/setup-overview.md · https://claude.com/docs/claude-tag/admins/set-spend-limit.md · https://claude.com/docs/connectors/slack/index.md · https://code.claude.com/docs/en/slack.md · https://www.anthropic.com/news/introducing-claude-tag · https://support.claude.com/en/articles/12138966-release-notes
- **Verificare adversarială:** CONFIRMED — Claude Tag: public beta, doar Team și Enterprise, indisponibil pe Free/Pro/Max; munca din canale se facturează din soldul organizației; pe Team nimic nu rulează fără sold finanțat, iar pe Enterprise facturat prin invoice nu există plafon până la setarea unui spend limit. code.claude.com/docs/en/slack confirmă că varianta anterioară se retrage pentru Team/Enterprise și rămâne calea pentru Pro/Max, cu sesiuni cloud sub contul individual, limitele planului, GitHub conectat și modurile Code only / Code + Chat.

## knowledge

### Projects în claude.ai (chat) — spații de lucru cu cunoștințe, instrucțiuni și memorie proprie (`an-claudeai-projects`)

- **Sursă oficială:** https://support.claude.com/en/articles/9517075-what-are-projects
- **Documentație tehnică:** https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects
- **Ce face:** Spații de lucru separate, fiecare cu istoric de chat, bază de cunoștințe (fișiere, text, cod încărcate sau fișierele unui repo GitHub prin integrarea GitHub), instrucțiuni de proiect și memorie proprie, separată de chaturile din afara proiectului; pe planurile plătite Claude poate căuta și în celelalte chaturi ale aceluiași proiect. Pe Team/Enterprise proiectele se pot partaja (Can view / Can edit).
- **Plan necesar:** Toate planurile; Free limitat la 5 proiecte; Pro/Max acces complet; partajarea doar pe Team/Enterprise.
- **Platformă:** claude.ai web, Claude Desktop (Windows/macOS), aplicațiile iOS/Android
- **Rollout:** GA. O versiune nouă de Projects (beta) se lansează treptat, pornind de la Claude Code pe Pro/Max; proiectele vechi din chat/Cowork funcționează până când le atinge noua experiență.
- **Eligibilitate cont:** Inclus în planul Max (verificat local: subscriptionType max).
- **Autentificare:** Sesiune claude.ai în aplicație; nu există cheie sau API pentru această funcție.
- **Allowance:** Limitele planului Max (fereastră de 5 ore + limită săptămânală).
- **Utilizare partajată:** Da: aceeași limită pentru claude.ai, Desktop, Cowork și Claude Code.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar dacă proprietarul a activat usage credits (dezactivate implicit); starea nu poate fi citită de Hub.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Documentația citită nu descrie niciun API, CLI sau MCP pentru crearea sau alimentarea proiectelor claude.ai; totul se face din UI (claude.ai/projects, + New Project, încărcare fișiere, Set project instructions).
- **Suprafață nativă:** claude.ai/projects; panoul de cunoștințe din dreapta; Set project instructions; stea, arhivare, ștergere.
- **Cerințe locale:** Niciuna în afara aplicației sau a browserului.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Proprietarul poate ține un proiect dedicat Hub-ului, alimentat manual cu briefinguri exportate de Hub; Hub-ul rămâne sursa canonică pentru companie, misiuni și decizii.
- **Suprafață de execuție:** anthropic.claude_projects
- **Echivalent la celălalt ecosistem:** ChatGPT Projects / ChatGPT Space (Space: Pro, Business, Enterprise conform recap DevDay 2026).
- **Ce face unic / mai bine:** Memorie izolată per proiect, RAG automat pe planurile plătite, instrucțiuni persistente.
- **Securitate:** Încărcarea trimite conținut privat în cloud-ul Anthropic; nu se încarcă .ifrim/private, configurări sau fișiere cu secrete.
- **Cale de implementare:** Hub-ul generează un pachet Markdown fără secrete (stare misiuni, decizii, reguli) pentru încărcare manuală și înregistrează exportul în audit.
- **Test necesar:** Niciun test automat posibil; confirmare manuală de către proprietar.
- **Status:** ASSISTED_ONLY
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Integrarea GitHub (support.claude.com/en/articles/10167454) adaugă în cunoștințele proiectului sau în chat fișierele unui repo de pe un branch, cu Sync manual, fără istoric de commituri sau PR-uri; în experiența unificată „Add from GitHub” nu este suportat. Sincronizarea repo-ului Hub ar trimite cod privat în cloud, deci nu se face fără aprobare.
- **Surse citite:** https://support.claude.com/en/articles/9517075-what-are-projects · https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects · https://support.claude.com/en/articles/11473015-retrieval-augmented-generation-rag-for-projects · https://support.claude.com/en/articles/11817273 · https://claude.com/pricing
- **Verificare adversarială:** CORRECTED (corectat: whatItDoes (https://support.claude.com/en/articles/11817273 ; https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects), notes (https://support.claude.com/en/articles/10167454-use-the-github-integration ; https://support.claude.com/en/articles/16761823)) — Verificat textual: Projects pentru toate planurile, Free maximum cinci proiecte, partajare doar Team/Enterprise, RAG doar pe planuri plătite, versiunea nouă (beta) pornește cu Claude Code pentru o parte din abonații Pro/Max; niciun API. Afirmația că contextul circulă doar prin baza de cunoștințe era depășită (memorie per proiect, căutare în chaturile proiectului), iar integrarea GitHub există ca funcție separată de conectori.

### Cunoștințe de proiect extinse (RAG pentru Projects) (`an-project-knowledge-rag`)

- **Sursă oficială:** https://support.claude.com/en/articles/11473015-retrieval-augmented-generation-rag-for-projects
- **Documentație tehnică:** https://support.claude.com/en/articles/11473015-retrieval-augmented-generation-rag-for-projects
- **Ce face:** Când baza de cunoștințe a proiectului se apropie de limita ferestrei de context, Claude trece automat în mod RAG și folosește un instrument de căutare în cunoștințele proiectului, extinzând capacitatea de până la aproximativ 10 ori; revine la modul standard dacă proiectul se micșorează.
- **Plan necesar:** Pro, Max, Team, Enterprise.
- **Platformă:** claude.ai web, Desktop, mobil
- **Rollout:** GA
- **Eligibilitate cont:** Inclus în Max.
- **Autentificare:** Sesiune claude.ai.
- **Allowance:** Limitele planului; căutările apar ca apeluri de instrument în conversație.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar prin usage credits activate de proprietar.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Activare automată, fără configurare și fără API documentat; articolul nu publică limite tehnice exacte sau lista completă de tipuri de fișiere.
- **Suprafață nativă:** Panoul de cunoștințe al proiectului.
- **Cerințe locale:** Niciuna
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Permite proprietarului să încarce documentație voluminoasă (fără secrete) pentru întrebări ad-hoc; Hub-ul nu depinde de această funcție.
- **Suprafață de execuție:** anthropic.claude_projects
- **Echivalent la celălalt ecosistem:** Fișierele din ChatGPT Projects (echivalență neverificată în această sesiune).
- **Ce face unic / mai bine:** Capacitate de circa 10x fără configurare și fără cost separat.
- **Securitate:** Fără control asupra indexării; aceleași riscuri ca orice încărcare în cloud.
- **Cale de implementare:** Hub-ul poate produce pachete de cunoștințe segmentate, filtrate de secrete, pentru încărcare manuală.
- **Test necesar:** Nu
- **Status:** ASSISTED_ONLY
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Articolul nu menționează integrarea GitHub sau Google Drive în cunoștințele proiectului.
- **Surse citite:** https://support.claude.com/en/articles/11473015-retrieval-augmented-generation-rag-for-projects · https://support.claude.com/en/articles/9517075-what-are-projects · https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects
- **Verificare adversarială:** CONFIRMED — Verificat textual în 11473015 și 9517075: RAG pe Pro, Max, Team, Enterprise, activare automată la apropierea de limita de context, capacitate de până la 10 ori, revenire posibilă la procesarea în context; fără API și fără listă de tipuri de fișiere.

### Projects în Cowork (inclusiv proiecte bazate pe foldere locale) (`an-cowork-projects-local-folders`)

- **Sursă oficială:** https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork
- **Documentație tehnică:** https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork
- **Ce face:** Grupează taskurile Cowork în spații cu fișiere, instrucțiuni, context (foldere locale, proiecte de chat, URL-uri) și memorie automată limitată la proiect; permite taskuri programate per proiect. Se creează de la zero, dintr-un proiect de chat sau dintr-un folder de pe computer.
- **Plan necesar:** Pro, Max, Team, Enterprise.
- **Platformă:** Claude Desktop macOS/Windows (ultima versiune); suportul pe web/mobil diferă pe funcție.
- **Rollout:** Disponibil
- **Eligibilitate cont:** Inclus în Max; Claude Desktop 2.9939.4 este instalat local (pachet MSIX).
- **Autentificare:** Sesiune claude.ai în Desktop.
- **Allowance:** Limitele planului.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar prin usage credits activate.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Niciun API sau CLI documentat; proiectele bazate pe foldere rămân locale și nu se sincronizează cu contul.
- **Suprafață nativă:** Cowork > Projects în Claude Desktop.
- **Cerințe locale:** Claude Desktop deschis pentru accesul la folderele locale.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Proprietarul poate atașa un folder de export al Hub-ului (fără secrete) unui proiect Cowork pentru muncă de birou.
- **Suprafață de execuție:** anthropic.claude_cowork
- **Echivalent la celălalt ecosistem:** ChatGPT Work cu spații/proiecte (neverificat în această sesiune).
- **Ce face unic / mai bine:** Memorie per proiect și acces direct la foldere locale fără încărcare manuală.
- **Securitate:** Nu se conectează rădăcina repo-ului Hub (conține .ifrim/private); Cowork poate scrie în folder; ștergerea cere permisiune explicită.
- **Cale de implementare:** Hub-ul expune un director de export dedicat, curățat de secrete; atașarea o face proprietarul.
- **Test necesar:** Nu
- **Status:** ASSISTED_ONLY
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Limitare documentată: proiectele există doar în Cowork, nu și în Claude Code (suport planificat).
- **Surse citite:** https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork · https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork · https://support.claude.com/en/articles/12138966-release-notes
- **Verificare adversarială:** CONFIRMED — Verificat textual în 14116274: planuri plătite; proiectele noi se salvează în cont, cele create dintr-un folder local rămân pe computer; proiectele există doar în Cowork, nu în Claude Code (suport planificat); partajare pe Team/Enterprise. Încrederea poate fi ridicată la high.

### Integrarea GitHub din claude.ai (depozit în chat sau fișiere din depozit în cunoștințele unui proiect) (`an-gap-claudeai-github-integration`)

- **Sursă oficială:** https://support.claude.com/en/articles/10167454-use-the-github-integration
- **Documentație tehnică:** https://claude.com/docs/connectors/github/index
- **Ce face:** Adaugă un depozit GitHub într-o conversație sau fișiere și foldere selectate în cunoștințele unui proiect privat (nu în proiecte partajate). Claude citește numele și conținutul fișierelor de pe branch, nu istoricul commit-urilor, PR-urile, issue-urile sau metadatele. Sync now reîmprospătează manual conținutul; depozitele private cer instalarea aplicației Claude GitHub App.
- **Plan necesar:** Toate planurile, inclusiv Free
- **Platformă:** claude.ai (web, Desktop)
- **Rollout:** GA
- **Eligibilitate cont:** Eligibil pe Max; necesită conectarea contului GitHub.
- **Autentificare:** OAuth GitHub + Claude GitHub App pentru depozite private
- **Allowance:** Conținutul adăugat consumă context și alocare
- **Utilizare partajată:** Alocarea comună Max
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nu
- **Risc de facturare API:** none
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Fără API; configurare și sincronizare doar din UI (Customize > Connectors > GitHub Integration).
- **Suprafață nativă:** + > Add from GitHub; Project knowledge > + > GitHub
- **Cerințe locale:** Cont GitHub
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință; Hub lucrează cu depozitul local prin Claude Code, nu prin cunoștințele de proiect claude.ai.
- **Suprafață de execuție:** anthropic.claude_projects
- **Echivalent la celălalt ecosistem:** Conectorul GitHub din ChatGPT / sursele din proiectele ChatGPT.
- **Ce face unic / mai bine:** Context de cod în chat fără Claude Code, pe orice plan.
- **Securitate:** Codul privat ajunge în contul claude.ai; GitHub App poate primi acces la toate depozitele dacă nu se restrânge.
- **Cale de implementare:** Niciuna în Hub; eventual ASSISTED pentru consultanță pe cod în chat.
- **Test necesar:** Niciunul
- **Status:** NEEDS_SETUP
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Afirmația criticului că integrarea nu funcționează în experiența unificată nu apare în documentația actuală.
- **Surse citite:** https://claude.com/docs/connectors/github/index.md · https://support.claude.com/en/articles/10167454-use-the-github-integration
- **Verificare adversarială:** CONFIRMED — claude.com/docs/connectors/github confirmă: toate planurile inclusiv Free, depozit în conversație sau în cunoștințele unui proiect privat (nu partajat), citește doar numele, conținutul fișierelor și conținutul branch-ului (nu commit history, PR-uri, issues, metadate), Sync now manual, Claude GitHub App pentru depozite private; pe Team/Enterprise apare doar dacă organizația a activat GitHub.

## research

### Research (cercetare agentică multi-căutare cu citări) (`an-research`)

- **Sursă oficială:** https://support.claude.com/en/articles/11088861-use-research-on-claude
- **Documentație tehnică:** https://support.claude.com/en/articles/11088861-use-research-on-claude
- **Ce face:** Claude efectuează agentic căutări succesive care se construiesc una pe alta, explorează unghiuri diferite ale întrebării și livrează un răspuns cu citări verificabile; poate folosi web-ul, Google Workspace (Gmail, Calendar, Docs) și aplicațiile conectate.
- **Plan necesar:** Pro, Max, Team, Enterprise (Free nu are Research).
- **Platformă:** claude.ai web, Desktop, mobil
- **Rollout:** GA; din 2026-08-18 Desktop pune automat în coadă mesajele trimise în timpul unei rulări Research.
- **Eligibilitate cont:** Inclus în Max.
- **Autentificare:** Sesiune claude.ai.
- **Allowance:** Aceleași limite ca conversațiile, dar consumate mai repede din cauza numărului mare de surse.
- **Utilizare partajată:** Da
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Doar prin usage credits activate.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Activare manuală din + > Research sau, în experiența unificată, prin /deep-research; niciun API documentat. Contul are activat skill-ul deep-research (ListSkills local), iar skill-urile contului se sincronizează în Claude Code ≥ v2.1.273 (/anthropic-skills:deep-research); echivalența cu Research din claude.ai (surse Google Workspace, citări) nu este documentată. Alternativa programatică sigură rămâne un worker Claude Code cu WebSearch/WebFetch.
- **Suprafață nativă:** Butonul + din caseta de chat > Research (indicator albastru); în experiența unificată și comanda /deep-research.
- **Cerințe locale:** Web search activat.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Proprietarul rulează Research pentru întrebări de piață sau tehnologie; Hub-ul pregătește briefingul și arhivează raportul cu citări în misiune.
- **Suprafață de execuție:** anthropic.claude_research
- **Echivalent la celălalt ecosistem:** ChatGPT deep research (neverificat în această sesiune).
- **Ce face unic / mai bine:** Include Google Workspace și conectori, cu citări directe.
- **Securitate:** Conectorii activi pot fi citiți în timpul cercetării; paginile web pot conține prompt injection.
- **Cale de implementare:** Șablon de brief în Hub și formular de import pentru raport și surse; fără automatizare.
- **Test necesar:** Nu
- **Status:** ASSISTED_ONLY
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Pagina curentă nu precizează durata; afirmații mai vechi (5–45 de minute) din rezultatele de căutare nu au fost confirmate pe pagina citită.
- **Surse citite:** https://support.claude.com/en/articles/11088861-use-research-on-claude · https://claude.com/docs/cowork/changelog · https://claude.com/pricing
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://support.claude.com/en/articles/16761823 ; https://code.claude.com/docs/en/skills), nativeUserSurface (https://support.claude.com/en/articles/16761823)) — Planurile (Pro, Max, Team, Enterprise; fără Free), consumul mai rapid al limitelor și lipsa unui API sunt confirmate textual în 11088861; punerea în coadă a mesajelor este confirmată în changelog-ul Desktop v1.32885.1 din 2026-08-18.

### Căutare web în chatul Claude și uneltele WebSearch/WebFetch din Claude Code (`an-gap-web-search-fetch`)

- **Sursă oficială:** https://support.claude.com/en/articles/10684626-enable-and-use-web-search
- **Documentație tehnică:** https://code.claude.com/docs/en/tools-reference
- **Ce face:** În chat, web search aduce informații actuale cu citări, inclusiv web fetch pentru URL-uri date și rezultate de imagini; în experiența Claude nouă nu mai există comutator, Claude caută când ajută. În Claude Code, WebSearch interoghează backend-ul de căutare Anthropic (până la opt căutări interne per apel, allowed_domains/blocked_domains, limită de 200 de apeluri per sesiune de la 2.1.212), iar WebFetch descarcă pagina, o convertește în Markdown și o procesează cu un model mic (rezultat cu pierderi), cache 15 minute, refuză localhost, nu urmează redirecționări între gazde. Înainte de fetch, numele gazdei este verificat la api.anthropic.com (dezactivabil cu skipWebFetchPreflight).
- **Plan necesar:** Chat: toate planurile (Team/Enterprise necesită activare de Owner). Claude Code: oricare plan pe Claude API.
- **Platformă:** claude.ai web, Desktop, mobil; Claude Code CLI/Desktop
- **Rollout:** GA
- **Eligibilitate cont:** Disponibil contului Max
- **Autentificare:** OAuth de abonament
- **Allowance:** Din alocarea planului: articolul de suport spune că web search și web fetch se contorizează în limitele de utilizare; nu este menționat un cost separat pe abonament. Paginile lungi aduse prin fetch consumă mult context.
- **Utilizare partajată:** Alocarea comună Max
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nedocumentat un cost separat pe abonament; pe API căutarea web are preț separat, irelevant pentru OAuth.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** În rulările Hub: uneltele se includ sau se exclud prin --tools; reguli WebFetch(domain:...) și WebSearch (fără specificator) în permissions din --settings; în dontAsk o unealtă nepermisă este refuzată; --restricted elimină WebFetch dacă nu e numit. skipWebFetchPreflight prin --settings dacă numele gazdelor nu trebuie trimise la api.anthropic.com. CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION (≥2.1.212) acceptă orice întreg pozitiv, deci plafonul poate fi coborât per proces (de exemplu 10) sau ridicat, dar nu dezactivat; se numără și căutările subagenților. Chatul claude.ai: fără API, doar interactiv.
- **Suprafață nativă:** Butonul + > Web search în chat; permisiuni în Claude Code
- **Cerințe locale:** 2.1.175 are WebSearch, WebFetch și skipWebFetchPreflight; nu are CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Unealtă de cercetare permisă per task de politica Hub, cu tot conținutul tratat ca neîncrezător.
- **Suprafață de execuție:** anthropic.claude_code_headless
- **Echivalent la celălalt ecosistem:** Gap-ul web_search din Codex (căutare web în Codex/ChatGPT).
- **Ce face unic / mai bine:** Citări automate; backend oficial fără cheie separată; verificare de siguranță a domeniilor.
- **Securitate:** Conținut web neîncrezător (prompt injection); în interactiv, „don't ask again” scrie o regulă în .claude/settings.local.json; preflight-ul trimite numele gazdei la Anthropic; WebFetch nu citește allowlist-ul sandbox-ului.
- **Cale de implementare:** Politică Hub: WebSearch/WebFetch dezactivate implicit, activate per misiune cu aprobare; rezultatele marcate ca date neîncrezătoare în memoria Hub.
- **Test necesar:** Fără model: argv/permisiuni. LIVE_VALIDATION: un run cu WebSearch permis și unul refuzat.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** medium
- **Note:** an-cc-file-tools nu acoperea uneltele web; an-research acoperă Research, nu căutarea simplă.
- **Surse citite:** https://support.claude.com/en/articles/10684626-enable-and-use-web-search · https://code.claude.com/docs/en/tools-reference.md · https://code.claude.com/docs/en/data-usage.md · https://code.claude.com/docs/en/env-vars.md · https://code.claude.com/docs/en/permissions.md · https://code.claude.com/docs/en/cli-reference.md · https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan
- **Verificare adversarială:** CORRECTED (corectat: subscriptionIncluded (https://support.claude.com/en/articles/10684626-enable-and-use-web-search), allowance (https://support.claude.com/en/articles/10684626-enable-and-use-web-search), programmaticDetail (https://code.claude.com/docs/en/env-vars.md ; https://code.claude.com/docs/en/tools-reference.md)) — Comportamentele WebSearch/WebFetch sunt confirmate (până la opt căutări interne per apel, allowed_domains/blocked_domains, limită de 200 de apeluri, model mic pentru extracție, cache 15 minute, refuz localhost, redirecționări între gazde returnate, preflight către api.anthropic.com). În chat, Team/Enterprise cer activare de Owner, iar în experiența nouă nu există comutator. Corectat: incluziunea în abonament este documentată (se consumă din limite), iar variabila de plafon poate și coborî limita.

## Întrebări deschise

- Nivelul exact al planului Max (5x sau 20x) nu apare în claude auth status și nici în get_usage; îl confirmă proprietarul din Settings → Billing.
- CLI-ul npm local este 2.1.175 (12.06.2026), iar ultima versiune este 2.1.285 (29.09.2026). Opus 5.5 (≥2.1.280), Sonnet 5.5 (≥2.1.284) și Fable 5.1 (≥2.1.257) cer actualizare, adică o instalare de pachet care necesită aprobarea explicită a proprietarului.
- Ce modele rezolvă efectiv aliasurile default, opus, sonnet și fable în CLI 2.1.175 pe Max? Din istoricul documentației reiese probabil Opus 4.8 ca implicit și Fable 5 pentru fable; se confirmă doar prin system/init într-un turn live aprobat.
- Emite CLI 2.1.175 rate_limit_event în stream-json? Câmpurile credits_required cer ≥2.1.181.
- Documentația spune că --bare va deveni implicit pentru -p într-o versiune viitoare, iar --bare nu folosește abonamentul. Ce opțiune va exista pentru a păstra autentificarea cu abonament în -p? Este un risc direct pentru ruta Claude a Hub-ului.
- Poate fi neutralizat fallbackModel [opus, haiku] din .claude/settings.json al proiectului pentru rulările Hub (de ex. prin --settings sau --setting-sources) fără modificarea fișierului? Proprietarul decide dacă setarea rămâne.
- Comportamentul switchModelsOnFlag=false (pauză cu alegere) nu este documentat pentru modul non-interactiv -p.
- Trimis ca prompt în -p, /usage este strict o comandă locală sau generează și cereri către model? Nu este verificat.
- Detaliile resetării gratuite oferite la lansarea Opus 5.5 (număr, expirare) apar doar în Settings → Usage; are proprietarul o resetare disponibilă?
- Cantitățile absolute ale limitelor Max 5x/20x și mărimea creșterii din 22.09.2026 nu sunt publicate în sursele oficiale citite.
- Nu există API public pentru procentele de plan în afara sesiunilor (status line, stream-json, Claude Desktop). Acceptă proprietarul un script de status line care scrie doar local sau snapshoturi manuale?
- Politica Anthropic presupune utilizare individuală obișnuită, fără prag cantitativ publicat. Ce ritm de automatizare zilnică este acceptabil pentru Hub?
- Funcționează --max-budget-usd pe abonament ca plafon local asupra estimării, fără efecte de facturare? Ar putea deveni o siguranță suplimentară dacă politica V2 se revizuiește.
- Haiku 4.5 are retragerea programată nu mai devreme de 15.10.2026, iar Haiku 5.5 este anunțat fără dată. Ce efect va avea asupra aliasului haiku din fallbackModel?
- Articolul Help Center 11145838 afirmă că trecerea pe credite cere consimțământ explicit, dar documentația Claude Code precizează că -p și Agent SDK facturează Fable fără prompt. Se recomandă aplicarea regulii stricte și o clarificare oficială.
- Subcomanda non-interactivă claude ultrareview cere confirmare de facturare când rulările gratuite s-au terminat? Documentația citită nu o spune explicit.
- Permite Anthropic ca un orchestrator local privat (Hub-ul Ifrim Digital, folosit doar de proprietar) să conducă binarul Claude Code nemodificat prin `claude -p` cu login-ul Max al proprietarului? Pagina legală permite autentificarea utilizatorului final în binarul nemodificat, dar cere API key pentru dezvoltatorii de produse cu Agent SDK; este recomandată o confirmare scrisă.
- Sunt usage credits (extra usage) dezactivate pe contul proprietarului? Nu există o comandă CLI documentată care să returneze starea; trebuie verificat manual în claude.ai/settings/usage.
- Care este nivelul exact al planului Max (5x sau 20x)? `claude auth status` raportează doar subscriptionType max.
- Modelele Fable sunt incluse în limitele acestui cont Max sau se facturează pe usage credits cu consimțământ? Până la răspuns, Hub respinge aliasul fable.
- Care este formatul exact documentat al control_request pentru interrupt pe `--input-format stream-json` fără SDK? Pe 2.1.175 lipsește capabilitatea interrupt_receipt_v1; este relevant pentru anularea eșuată din HUB-018.
- Apelurile clasificatorului auto mode se numără în limitele Max? Documentația precizează doar Enterprise/API.
- Aprobă proprietarul actualizarea CLI de la 2.1.175 la versiunea curentă (2.1.285)? Aduce --permission-prompts, --restricted, --forward-subagent-text, interrupt_receipt_v1, remedieri de securitate la worktree (2.1.205) și rewind (2.1.216), dar și modul auto implicit în sesiuni interactive (2.1.283).
- `--safe-mode` în -p pe 2.1.175 exclude efectiv hooks și serverele din .mcp.json ale proiectului? Necesită un test live aprobat.
- Documentația anunță că --bare va deveni implicit pentru -p într-o versiune viitoare; cum va rămâne disponibilă ruta prin abonament pentru -p după această schimbare?
- Pe 2.1.175 sunt suportate comenzile attach/logs/stop/rm/daemon și --bg (stringul --bg există în binar, dar nu apare în help)?
- Este activată implicit unealta PowerShell pe 2.1.175 pentru acest cont pe Windows cu Git Bash? Se confirmă din system/init la primul turn aprobat.
- Blochează `forceLoginMethod: claudeai` din managed settings credențialele ANTHROPIC_API_KEY la pornire pe versiunea locală (documentația leagă aplicarea generală de 2.1.212+)?
- Este extensia Claude in Chrome conectată la CLI (native messaging host) sau doar la aplicația Desktop?
- Este contul conectat la GitHub (Claude GitHub App sau /web-setup), condiție pentru sesiuni cloud și routines?
- Proprietarul păstrează setarea fallbackModel [opus, haiku] din .claude/settings.json al proiectului? Ea schimbă modelul efectiv în run-urile -p fără cererea Hub-ului.
- A ajuns experiența Claude unificată (chat + Cowork) pe contul Max al lui Catalin? Proprietarul poate confirma vizual dacă mai vede opțiunile separate Chat și Cowork.
- Usage credits sunt dezactivate pe contul claude.ai? Hub-ul nu poate citi Settings > Usage; confirmarea este necesară pentru ca riscul de facturare să rămână „low”.
- Planul este Max 5x sau Max 20x? claude auth status raportează doar „max”.
- Cowork local funcționează pe Windows 11 Home? Nu există o sursă oficială citită despre cerința Hyper-V; doar surse neoficiale. După 2026-10-06 taskurile noi rulează oricum în cloud: accesul la foldere locale prin Desktop funcționează pe Home?
- Extensia Claude in Chrome este instalată și conectată? Datele Desktop conțin folderul ChromeNativeHost, dar conexiunea nu a fost verificată (verificarea read-only prin list_connected_browsers nu a fost făcută).
- Proprietarul este utilizator Dispatch existent? Dispatch nu mai este disponibil utilizatorilor noi.
- Projects din Claude Code (coordonator cloud) a ajuns pe cont? Lansarea începe cu conturile care au folosit sesiuni cloud și nu au proiecte existente în chat/Cowork.
- CLI-ul npm local 2.1.175 este mult sub versiunile documentate (/artifacts 2.1.208, /slides și /design 2.1.265, sincronizarea skill-urilor 2.1.273, fire locale Projects 2.1.280). Proprietarul aprobă o actualizare și, înainte de ea, setările de izolare (syncClaudeAiSkills: false, CLAUDE_CODE_DISABLE_ARTIFACT=1, ENABLE_CLAUDEAI_MCP_SERVERS=false, --no-chrome)?
- În claude -p, cu --strict-mcp-config, se încarcă totuși conectorii claude.ai, serverul intern claude-in-chrome sau instrumentul Artifact? Documentația nu spune explicit; trebuie verificat din evenimentul init al unui tur aprobat.
- Starea comutatorului Computer use și a listei Denied apps în Desktop; trebuie să rămână oprit pentru orice sesiune legată de Hub?
- Se folosește modul Require trusted devices pentru Remote Control pe contul Max?
- Extensiile desktop instalate direct (.mcpb) se încarcă în chatul Desktop după unificare? Tabelul pluginurilor spune că serverele locale incluse în pluginuri sunt ignorate în Chat.
- Memoria claude.ai este vizibilă în vreun fel pentru Claude Code în terminal? Documentația citită nu o menționează.
- Discrepanța privind activarea implicită a memoriei pe Free (nota de lansare vs. articolul de suport).
- Claude Science apare în pagina de prețuri pentru Pro+, dar nu a fost investigat în această felie.
- Eligibilitatea unui cont Max individual pentru achiziții în Claude Marketplace (anunțul nu precizează planurile).
- Deja acoperite, fără record nou: „Edit Claude's drafts in place” (12.06) → an-artifacts-chat; Trusted Devices pentru Remote Control (25.06) → an-remote-control; custom roles, model entitlements, HIPAA self-serve, smart reports → an-plan-team-enterprise. Claude Corps este un program de fellowship, nu o capabilitate, deci apare doar în index. Programele de trusted access pentru Mythos 5.1 se suprapun parțial cu an-model-mythos-5-1.
- Contradicție cu decizia Hub: CLI-ul local 2.1.175 nu poate folosi Opus 5.5 (≥2.1.280) sau Sonnet 5.5 (≥2.1.284) și primește 400 claude_code_version_too_old; aliasurile rezolvă la Opus 4.8, Fable 5 și un Sonnet anterior lui 5. Proprietarul trebuie să aprobe un upgrade fixat (stable 2.1.280 nu acoperă Sonnet 5.5; Desktop include deja 2.1.284).
- Contradicție cu decizia Hub: --setting-sources user lasă active env-ul, apiKeyHelper, hook-urile, pluginurile și (de la 2.1.273) skill-urile claude.ai sincronizate din setările user. Verificarea apiKeySource din init nu prinde ANTHROPIC_BASE_URL sau schimbarea furnizorului. Recomandat: --settings cu env gol și disableAllHooks acum, --restricted după upgrade.
- Nedocumentat: o valoare goală în --settings env pentru ANTHROPIC_BASE_URL sau ANTHROPIC_API_KEY este tratată ca nesetată? Documentația confirmă doar pentru selecția furnizorului. Și există o anulare per proces pentru apiKeyHelper din setările user?
- Nedocumentat: --restricted funcționează cu autentificarea OAuth claude.ai și încarcă CLAUDE.md/auto memory? De verificat în LIVE_VALIDATION după upgrade.
- Nedocumentat: disableSideloadFlags acceptă un --mcp-config gol ({"mcpServers":{}}) și este valid --strict-mcp-config fără --mcp-config? Contează doar dacă se instalează managed settings (azi nu există local).
- Nedocumentat: --setting-sources user exclude skill-urile din .claude/skills și CLAUDE.md ale proiectului? Documentația menționează doar setările și .mcp.json.
- Facturarea căutării web pe abonament (web search în claude.ai și WebSearch/WebFetch în Claude Code) nu este documentată ca separată; de confirmat că intră integral în alocarea Max.
- De ce instalarea npm a rămas la 2.1.175 deși auto-update-ul e implicit activ (director npm neinscriptibil, DISABLE_AUTOUPDATER setat, alt motiv)? claude doctor ar răspunde, dar pornește servere stdio din .mcp.json, deci cere aprobare.
- Poate Hub-ul folosi binarul Claude Code inclus în Desktop (%APPDATA%\Claude\claude-code\<versiune>\claude.exe)? Nu este un punct de intrare documentat; recomandarea rămâne o instalare npm/nativă fixată și aprobată.
- /import rulat în -p pornește inferență sau doar listează local? Nedocumentat.
- Afirmația criticului că integrarea GitHub nu funcționează în experiența Claude unificată nu apare în documentația actuală.
- Vizibilitatea Monthly recap pe acest cont Max (lansare graduală, cere memoria activă) nu a fost verificată.
- Write actions ale conectorului Microsoft 365 pe planuri individuale: activarea este descrisă prin Organization settings; nu este clar cum se activează pe Max. Documentația actuală listează și trimiterea de mesaje în Teams, spre deosebire de release note-ul din 07.07.
- Varianta anterioară Claude Code in Slack este eligibilă pe Max, dar cere un workspace Slack cu aplicația aprobată; nu se știe dacă Ifrim Digital are Slack.
- Aliasul sonnet pe 2.1.175: tabelul de versiuni spune doar că a trecut la Sonnet 5 la 2.1.197; rezoluția anterioară (probabil Sonnet 4.6) este dedusă.

## Surse inaccesibile

- https://support.claude.com/en/articles/11014257-about-claude-s-max-plan-usage (HTTP 404)
- https://support.claude.com/en/articles/14246053-extra-usage-credit-for-pro-max-and-team-plans (HTTP 404)
- https://claude.com/pricing: citită, dar prețul Max 20x nu apare în HTML-ul static (selector „From $100”); prețul de 200 USD provine din articolul 11049741.
- https://www.anthropic.com/news: listarea afișează doar aproximativ 15 intrări; datele celorlalte articole provin din metadatele datePublished ale fiecărei pagini, găsite prin sitemap.xml.
- Detaliile resetării gratuite oferite la lansarea Opus 5.5 (număr, expirare) nu apar pe paginile oficiale citite; apar doar în surse terțe (pasqualepillitteri.it), necitite integral și nefolosite ca dovadă.
- Articolele Help Center 11049741, 12429409, 15424964, 17007452, 9797557, 11647753 și 11145838 au fost citite printr-un rezumat automat (WebFetch), nu ca text integral; release notes și documentația code.claude.com au fost verificate și în forma brută.
- https://academy.claude.com/tutorials/choosing-the-right-claude-model: pagina nu are dată și menționează modele anterioare (Sonnet 5, Opus 5).
- https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md — citit doar parțial: instrumentul a returnat numai intrările 2.1.280–2.1.285 din cauza dimensiunii; intrările 2.1.176–2.1.279 nu au fost citite.
- https://code.claude.com/docs/en/whats-new/index.md și paginile săptămânale 2026-w13…w37 — necitite în această sesiune.
- https://platform.claude.com/docs/en/api/claude-code/routines-fire — referința API completă pentru /fire nu a fost citită.
- https://code.claude.com/docs/en/agent-sdk/typescript — citit prin rezumat; tipurile SDKControlInterruptResponse, SDKMessageOrigin și startup_failure_reason au fost trunchiate de instrument.
- https://support.claude.com/en/articles/9450526-export-your-claude-data — nu a fost deschis; s-a folosit doar fragmentul din rezultatele căutării.
- https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide — nu a fost deschis; s-a folosit doar fragmentul din rezultatele căutării.
- https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork — secțiunea Current limitations a fost trunchiată la extragere.
- https://claude.com/docs/cowork/guide/projects — nu a fost citit (s-a folosit articolul de suport 14116274).
- https://claude.com/marketplace — pagina marketplace-ului nu a fost deschisă direct; doar anunțul oficial de pe blog.
- Cerințele Windows (Hyper-V / Virtual Machine Platform) pentru Cowork local: nu a fost găsită o pagină oficială; rezultatele au fost doar surse neoficiale (fast.io, betterclaw.io, issue-uri GitHub) și nu au fost folosite ca dovadă.
- Detaliile oficiale despre taskurile programate și înregistrarea fluxurilor din extensia Chrome nu au fost citite într-o pagină dedicată.
- https://www.anthropic.com/news: listarea este paginată pe client; indexul a fost extras din datele încorporate în pagină (aprox. 207 postări) și poate fi incomplet. Pentru câteva postări (claude-for-teachers, anthropic-public-record, cognizant-anthropic, ust-claude, enterprise-ai-services-company, accenture-embedded-evaluation) a fost citit doar titlul.
- Nu am citit ~/.claude/settings.json, ~/.claude.json, .credentials.json sau fișierele de configurare Claude Desktop (reguli de confidențialitate); starea lor efectivă (env, apiKeyHelper, hooks, pluginuri) rămâne necunoscută.
- claude doctor nu a fost rulat (pornește servere stdio din .mcp.json), deci starea auto-update-ului nu a fost verificată.
