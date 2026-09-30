# Audit capabilități OpenAI (Milestone 01)

> Generat din `v2/config/ecosystem/` de `v2/scripts/gen-ecosystem-docs.mjs`. Verificat: 2026-09-30. Nu edita manual: modifică JSON-ul și regenerează.

Recapitularea DevDay 2026 (29.09.2026) este indexul; documentația specifică este autoritatea tehnică. Statusurile descriu contul tău, nu disponibilitatea generală: DOCUMENTED ≠ AVAILABLE.

## Tabel sintetic

| ID | Capabilitate | Status | Plan | Inclus | Risc API | Control | Decizie Hub | Relevanță |
|---|---|---|---|---|---|---|---|---|
| oa-model-gpt-6-1-sol | GPT-6.1 Sol (gpt-6.1-sol) | DOCUMENTED | Plus, toate nivelurile Pro, Business, Enterprise, Edu (Ente… | yes | low | PROGRAMMATIC | WRAP | HIGH |
| oa-model-gpt-6-astra | GPT-6 Astra (gpt-6-astra) | DOCUMENTED | Plus, Pro, Business, Enterprise/Edu (Enterprise cere eligib… | yes | low | PROGRAMMATIC | WRAP | HIGH |
| oa-model-gpt-6-sol | GPT-6 Sol (gpt-6-sol) | DOCUMENTED | Plus, Pro, Business, Enterprise, Edu (ChatGPT Work și Codex… | yes | low | PROGRAMMATIC | WRAP | MEDIUM |
| oa-model-gpt-6-luna | GPT-6 Luna (gpt-6-luna) | DOCUMENTED | Toate planurile: Free și Go (doar în desktop app, Standard … | yes | low | PROGRAMMATIC | WRAP | HIGH |
| oa-model-gpt-5-6-legacy | GPT-5.6 Sol / Terra / Luna (modele disponibile în perioada de tranziț… | DOCUMENTED | Conform planului (Sol/Terra pe planuri plătite; Luna larg d… | yes | low | PROGRAMMATIC | REFERENCE | LOW |
| oa-model-retirements | Retragerea GPT-5.5 (14.10.2026) și a modelelor Codex vechi | DOCUMENTED | Toate planurile. | not_applicable | none | PROGRAMMATIC | REFERENCE | MEDIUM |
| oa-model-daybreak-cyber | Daybreak Blue / Daybreak Red / GPT-5.6 Cyber și rerutarea cyber | ELIGIBILITY_UNKNOWN | Aprobare Trusted Access for Cyber; Daybreak Red cere aproba… | partial | low | PROGRAMMATIC | REFERENCE | LOW |
| oa-speed-fast-mode | Fast mode în Codex / ChatGPT Work | AVAILABLE | Plus, Pro, Business, Enterprise (și API key) cu ChatGPT sig… | yes | low | PROGRAMMATIC | WRAP | HIGH |
| oa-speed-ultrafast-codex | GPT-6 Astra Ultrafast în Codex și ChatGPT Work | PLAN_RESTRICTED | Pro 500 (500 $/lună) și planuri Enterprise/Edu eligibile (E… | no | high | PROGRAMMATIC | REJECT | MEDIUM |
| oa-speed-ultrafast-api | Ultrafast mode în OpenAI API (service_tier: ultrafast) | BLOCKED | Cont OpenAI API cu facturare (toți utilizatorii API, limite… | no | high | PROGRAMMATIC | REJECT | NONE |
| oa-reasoning-effort-max-ultra | Reasoning effort în Codex: Light→Extra High, Max și Ultra (subagenți) | DOCUMENTED | Conform modelului și planului; Max/Ultra pot depinde de set… | yes | low | PROGRAMMATIC | WRAP | HIGH |
| oa-model-selection-guidance | Ghid oficial de alegere model/effort (pentru routerul Hub) | DOCUMENTED | n/a | not_applicable | none | NONE | REFERENCE | HIGH |
| oa-plan-free-go | Planurile ChatGPT Free (0 $) și Go (8 $/lună) | NOT_APPLICABLE | Free / Go. | yes | none | NONE | NOT_APPLICABLE | LOW |
| oa-plan-plus | ChatGPT Plus (20 $/lună) | DOCUMENTED | Plus. | yes | low | NONE | REFERENCE | LOW |
| oa-plan-pro-tiers | ChatGPT Pro: Pro 100, Pro 200, Pro 500 | DOCUMENTED | Pro 100 / Pro 200 / Pro 500; facturare doar lunară. | yes | low | PROGRAMMATIC | MIRROR_STATE | HIGH |
| oa-plan-pro-500 | Pro 500 (500 $/lună) — nivel nou cu Astra Ultrafast | PLAN_RESTRICTED | Pro 500. | no | high | NONE | REJECT | LOW |
| oa-codex-plan-type-prolite | Semnificația Codex account planType „prolite” | DOCUMENTED | n/a | not_applicable | none | PROGRAMMATIC | MIRROR_STATE | HIGH |
| oa-plan-business | ChatGPT Business (20 $/utilizator/lună anual, 25 $ lunar, minim 2 uti… | PLAN_RESTRICTED | Business. | partial | low | NONE | NOT_APPLICABLE | LOW |
| oa-plan-business-premium | ChatGPT Business Premium | DOCUMENTED | Business Premium. | unknown | unknown | NONE | NOT_APPLICABLE | NONE |
| oa-plan-enterprise-edu | ChatGPT Enterprise / Edu (preț personalizat) | PLAN_RESTRICTED | Enterprise / Edu. | partial | high | NONE | NOT_APPLICABLE | NONE |
| oa-codex-work-usage-limits | Limitele de utilizare Codex / ChatGPT Work (alocare comună, ferestre … | DOCUMENTED | Toate planurile ChatGPT (valori diferite). | yes | low | PROGRAMMATIC | MIRROR_STATE | HIGH |
| oa-usage-telemetry-app-server | Telemetrie de plan și consum prin Codex app-server (account/*) | AVAILABLE | Autentificare ChatGPT (API key și Bedrock nu suportă accoun… | yes | none | PROGRAMMATIC | MIRROR_STATE | HIGH |
| oa-credits-flexible-usage | Credite ChatGPT (flexible usage) pentru Codex și ChatGPT Work pe plan… | BLOCKED | Plus și Pro (Free/Go doar grup limitat); Business/Enterpris… | no | high | ASSISTED | MIRROR_STATE | HIGH |
| oa-credits-auto-reload | Automatic reload (auto top-up) pentru credite | BLOCKED | Planuri personale cu credite (unde este disponibil). | no | high | NONE | REJECT | HIGH |
| oa-rate-limit-reset-credits | Resetări de limită câștigate (banked resets) și resetări unice | ELIGIBILITY_UNKNOWN | Plus/Pro eligibili (promoții). | yes | none | PROGRAMMATIC | ASSISTED | MEDIUM |
| oa-codex-api-key-billing | Codex cu API key (facturare API) | BLOCKED | Cont OpenAI API cu facturare. | no | high | PROGRAMMATIC | REJECT | HIGH |
| oa-siwc-plan-usage-sharing | Sign in with ChatGPT: folosirea planului și a creditelor în aplicații… | ELIGIBILITY_UNKNOWN | Plus/Pro pentru plan sharing; autentificarea simplă pentru … | partial | low | PROGRAMMATIC | REFERENCE | LOW |
| oa-luna-reserve-fallback | Luna Reserve fallback (semnal experimental în protocolul Codex) | ELIGIBILITY_UNKNOWN | Necunoscut (experiment). | unknown | unknown | UNKNOWN | REJECT | LOW |
| oa-private-safety-processing | Private Intelligence: Zero Data Retention cu Private Safety Processin… | NOT_APPLICABLE | Organizații API aprobate pentru ZDR; activare per proiect d… | no | high | PROGRAMMATIC | NOT_APPLICABLE | NONE |
| oa-private-inference | Private Inference (preview, confidential computing) | DOCUMENTED | Orientat spre enterprise; condiții nepublicate. | no | high | UNKNOWN | NOT_APPLICABLE | NONE |
| oa-marketplace | OpenAI Marketplace | NOT_APPLICABLE | Clienți enterprise cu angajament financiar. | no | high | NONE | NOT_APPLICABLE | NONE |
| oa-bedrock-managed-agents | Amazon Bedrock Managed Agents, powered by OpenAI | BLOCKED | Cont AWS cu acces Bedrock (facturare AWS). | no | high | PROGRAMMATIC | REJECT | NONE |
| oa-codex-bedrock-provider | Codex / ChatGPT Work local cu Amazon Bedrock ca model_provider | BLOCKED | Cont AWS cu acces la modelele OpenAI în Bedrock. | no | high | PROGRAMMATIC | REJECT | MEDIUM |
| oa-decisions-api | Decisions API (Luna pentru decizii cu răspunsuri predefinite) | BLOCKED | Acces limitat în preview; rollout larg planificat. | no | high | UNKNOWN | REJECT | LOW |
| oa-codex-app-server | Codex app-server: protocol JSON-RPC 2.0 (thread/turn/item, aprobări, … | AVAILABLE | Orice plan ChatGPT care include Codex (tabel pricing: Plus,… | yes | low | PROGRAMMATIC | WRAP | HIGH |
| oa-codex-account-usage-read | Citire cont, plan și limite: account/read, account/rateLimits/read, a… | AVAILABLE | Cont ChatGPT; account/usage/read cere autentificare pe serv… | yes | none | PROGRAMMATIC | MIRROR_STATE | HIGH |
| oa-codex-app-server-side-effect-methods | Metode app-server cu efecte laterale (resetare limită, e-mail către o… | BLOCKED | n/a | not_applicable | high | PROGRAMMATIC | REJECT | HIGH |
| oa-codex-thread-history-mirror | Istoricul sesiunilor Codex: thread/list, thread/read, thread/turns/li… | AVAILABLE | Orice cont Codex | yes | none | PROGRAMMATIC | MIRROR_STATE | MEDIUM |
| oa-codex-shared-daemon | Daemonul app-server local partajat (codex app-server daemon; pornire … | AVAILABLE | Orice plan cu Codex | yes | low | PROGRAMMATIC | MIRROR_STATE | MEDIUM |
| oa-codex-agents-overview | Vizualizarea /agents: codex agents (agent command center) | AVAILABLE | Toate planurile (recap DevDay) | yes | low | NATIVE_INTERACTIVE | MIRROR_STATE | MEDIUM |
| oa-codex-queue | codex queue și cozi de prompturi (Queue/Steer) | AVAILABLE | Toate planurile cu Codex | yes | low | PROGRAMMATIC | REFERENCE | LOW |
| oa-codex-session-lifecycle | Reluare, fork, arhivare, ștergere de sesiuni (resume/fork/archive/una… | AVAILABLE | Toate planurile cu Codex | yes | low | PROGRAMMATIC | WRAP | HIGH |
| oa-codex-worktrees | Worktree-uri Git integrate (Codex-managed worktrees, handoff) | AVAILABLE | Toate planurile (tabel pricing: Worktrees and built-in Git … | yes | low | NATIVE_INTERACTIVE | REIMPLEMENT | MEDIUM |
| oa-codex-voice | Conversații vocale: /voice și F8 în Codex CLI; ChatGPT Voice în deskt… | AVAILABLE | Desktop: Plus, Pro, Business, Edu, Enterprise; indisponibil… | yes | low | NATIVE_INTERACTIVE | REFERENCE | LOW |
| oa-codex-goals | Goal mode: /goal și thread/goal/set\|get\|clear | AVAILABLE | Toate planurile cu Codex (goal mode nu mai e experimental d… | yes | low | PROGRAMMATIC | WRAP | HIGH |
| oa-codex-hooks | Hooks pe ciclul de viață Codex | AVAILABLE | Toate planurile cu Codex | yes | none | PROGRAMMATIC | MIRROR_STATE | MEDIUM |
| oa-codex-memories | Memories locale Codex | AVAILABLE | Tabel pricing: Limited* (regional) pe toate planurile; disp… | yes | low | PROGRAMMATIC | REFERENCE | MEDIUM |
| oa-codex-subagents | Subagenți și agenți custom (multi_agent) | AVAILABLE | Toate planurile (tabel: Subagents and custom agents) | yes | low | PROGRAMMATIC | WRAP | MEDIUM |
| oa-codex-auto-review | Auto-review al aprobărilor (approvals_reviewer = auto_review) | AVAILABLE | Toate planurile (tabel: Auto-review for approval requests) | yes | low | PROGRAMMATIC | REJECT | MEDIUM |
| oa-codex-import-external-agent | Import din Claude Code/Cursor (/import, externalAgentConfig) | AVAILABLE | Toate planurile cu Codex | yes | none | PROGRAMMATIC | MIRROR_STATE | MEDIUM |
| oa-codex-exec | codex exec: rulare non-interactivă (JSONL, --output-schema) | AVAILABLE | Tabel pricing: Codex SDK, codex exec și fluxuri scriptabile… | yes | low | PROGRAMMATIC | WRAP | MEDIUM |
| oa-codex-sdk | Codex SDK (TypeScript @openai/codex-sdk, Python openai-codex) | DOCUMENTED | Aceleași planuri ca codex exec | yes | low | PROGRAMMATIC | REFERENCE | LOW |
| oa-codex-github-action | Codex GitHub Action (openai/codex-action@v1) | BLOCKED | Cheie OpenAI API (openai-api-key). | no | high | PROGRAMMATIC | REJECT | LOW |
| oa-codex-access-tokens | Codex access tokens pentru automatizare de încredere | PLAN_RESTRICTED | Doar Business și Enterprise (tabel pricing: nu Plus, nu Pro… | partial | low | PROGRAMMATIC | NOT_APPLICABLE | LOW |
| oa-codex-remote-control | Remote control de pe telefon și codex remote-control | NEEDS_SETUP | Mobile remote control: Plus, Pro, Business, Enterprise (nu … | yes | low | ASSISTED | ASSISTED | MEDIUM |
| oa-codex-ssh-remote-hosts | Gazde SSH, handoff între gazde și TUI remote (codex --remote) | DOCUMENTED | Toate planurile (tabel: SSH remote connections) | yes | low | PROGRAMMATIC | REFERENCE | LOW |
| oa-codex-desktop-app | Codex în ChatGPT desktop app (Windows) | AVAILABLE | Chaturi locale: Plus, Pro, Business, Enterprise, API key; F… | yes | low | NATIVE_INTERACTIVE | ASSISTED | HIGH |
| oa-codex-in-app-browser | Browser integrat în desktop (previzualizare, comentarii, browser use,… | AVAILABLE | Previzualizări și comentarii: toate planurile din tabel; Co… | yes | low | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| oa-codex-browser-extension | Extensia ChatGPT pentru Chrome/Edge/Brave/Opera/Vivaldi (browser cont… | NEEDS_SETUP | Use ChatGPT with Chrome: Limited* (regional) pe toate planu… | yes | low | NATIVE_INTERACTIVE | ASSISTED | LOW |
| oa-codex-computer-use | Computer Use (plugin computer-use / unified-computer-use) | ASSISTED_ONLY | Limited* (regional) pe toate planurile; disponibil în SEE/U… | yes | low | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| oa-codex-document-plugins | Pluginuri pentru documente, foi de calcul, prezentări, PDF și vizuali… | AVAILABLE | Toate planurile (pluginuri incluse) | yes | low | ASSISTED | REUSE_NATIVE | MEDIUM |
| oa-codex-local-environments | Local environments (scripturi de setup și acțiuni pentru worktree-uri) | DOCUMENTED | Toate planurile (tabel: Local environments and repeatable a… | yes | none | ASSISTED | REFERENCE | LOW |
| oa-codex-scheduled-tasks | Scheduled tasks (automatizări locale în desktop și pe web) | AVAILABLE | Toate planurile din tabel (Project and standalone scheduled… | yes | low | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| oa-codex-event-triggered-tasks | Taskuri declanșate de evenimente Gmail/Slack/GitHub | ELIGIBILITY_UNKNOWN | Planuri eligibile (nespecificate în detaliu) | partial | low | NATIVE_INTERACTIVE | NOT_APPLICABLE | LOW |
| oa-codex-cloud-environments | Codex Cloud: medii cloud reutilizabile | NEEDS_SETUP | Plus, Pro, Business, Enterprise (nu API key); cloud necesit… | yes | low | ASSISTED | ASSISTED | MEDIUM |
| oa-codex-cloud-tasks-cli | Taskuri Codex Cloud din CLI (codex cloud exec/list/status/diff/apply,… | NEEDS_SETUP | Plus, Pro, Business, Enterprise (nu API key) | yes | low | PROGRAMMATIC | WRAP | MEDIUM |
| oa-codex-cloud-integrations | Delegare cloud: @codex în GitHub issues/PR, Slack, Linear | NEEDS_SETUP | GitHub @codex și Linear: planuri plătite (Plus, Pro, Busine… | yes | low | ASSISTED | ASSISTED | LOW |
| oa-codex-review-local | Code review local: codex review, /review, review/start | AVAILABLE | Toate planurile (tabel: Local code review with /review) | yes | low | PROGRAMMATIC | WRAP | HIGH |
| oa-codex-review-desktop | Experiența Code Review în desktop (plugin Code Review) | NEEDS_SETUP | Toate planurile (recap DevDay); pluginul Code Review funcți… | yes | low | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| oa-codex-review-github-auto | Review-uri automate în cloud pentru PR-uri GitHub (@codex review) | NEEDS_SETUP | Plus, Pro, Business, Enterprise (nu API key) | yes | low | ASSISTED | REUSE_NATIVE | MEDIUM |
| oa-codex-review-gitlab | Review și taskuri pentru GitLab (merge requests) | DOCUMENTED | Beta pe toate planurile ChatGPT | yes | low | ASSISTED | NOT_APPLICABLE | LOW |
| oa-codex-security-review-pr | Codex Security Review pentru PR-uri GitHub (@codex security review) | ELIGIBILITY_UNKNOWN | Enterprise, Business, Edu și Pro; nu Plus. | yes | low | ASSISTED | ASSISTED | MEDIUM |
| oa-codex-security-plugin-local | Plugin Codex Security (scanări locale într-un task Codex) | NEEDS_SETUP | Pagina nu precizează planul. | unknown | low | ASSISTED | ASSISTED | MEDIUM |
| oa-codex-security-cli | Codex Security CLI și SDK (npx @openai/codex-security) | ELIGIBILITY_UNKNOWN | Acces Codex Security (beta); recomandat Trusted Access for … | partial | high | PROGRAMMATIC | REFERENCE | MEDIUM |
| oa-codex-security-cloud | Codex Security Cloud (scanări cloud pentru depozite GitHub conectate) | ELIGIBILITY_UNKNOWN | Conflict: recapul DevDay spune toți utilizatorii Codex; tab… | unknown | unknown | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| oa-codex-plugins-runtime | Pluginuri Codex (instalare, utilizare, inventar) | AVAILABLE | Plugins pe toate planurile (API key: limitat); plugin shari… | yes | none | PROGRAMMATIC | MIRROR_STATE | MEDIUM |
| oa-codex-plugin-marketplaces | Marketplace-uri de pluginuri și formatul portabil Agent Plugins | AVAILABLE | Toate planurile | yes | none | PROGRAMMATIC | REUSE_NATIVE | MEDIUM |
| oa-codex-skills | Skills Codex (SKILL.md, standardul Agent Skills) | AVAILABLE | Toate planurile | yes | none | PROGRAMMATIC | REUSE_NATIVE | HIGH |
| oa-codex-mcp-client | Codex ca client MCP | AVAILABLE | Toate planurile (tabel: MCP) | yes | low | PROGRAMMATIC | WRAP | HIGH |
| oa-codex-mcp-server-removed | Codex ca server MCP (codex mcp-server) — eliminat | NOT_APPLICABLE | n/a | not_applicable | none | NONE | REJECT | LOW |
| oa-codex-fast-mode | Fast mode și Astra Ultrafast (niveluri de viteză) | AVAILABLE | Fast: toate planurile din tabel; Astra Ultrafast: Pro 500 U… | yes | low | PROGRAMMATIC | REJECT | MEDIUM |
| oa-codex-sandbox-permissions | Sandbox și permisiuni Codex (Windows sandbox, permission profiles, ex… | AVAILABLE | Toate planurile | yes | none | PROGRAMMATIC | WRAP | HIGH |
| oa-codex-exec-server | codex exec-server (executor remote standalone) | AVAILABLE | n/a | not_applicable | none | PROGRAMMATIC | NOT_APPLICABLE | LOW |
| oa-codex-appshots | Appshots pe Windows | ELIGIBILITY_UNKNOWN | Plus, Pro, Business, API key; nu Enterprise (tabel pricing). | yes | low | NATIVE_INTERACTIVE | NOT_APPLICABLE | LOW |
| oa-codex-macos-only-features | Funcții doar macOS: Computer History, Record & Replay, locked use, sn… | NOT_APPLICABLE | Variabil (Computer History: Pro, Business, Enterprise) | not_applicable | none | NONE | NOT_APPLICABLE | NONE |
| oa-codex-cli-interactive | Codex CLI interactiv, forma nouă (TUI reproiectat) | AVAILABLE | Toate planurile (recap DevDay); tabel: Plus, Pro, Business,… | yes | low | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| oa-plugin-extensions | Plugin extensions: sidebar apps, conversation panels, file viewers/ed… | DOCUMENTED | Recap DevDay: toate abonamentele. Documentația: pe web exte… | yes | none | ASSISTED | REFERENCE | MEDIUM |
| oa-plugin-builder-submission | Plugin Creator, încărcare ZIP, trimitere la review, publicare și desc… | DOCUMENTED | Creare: toate abonamentele (recap); trimitere publică: orga… | yes | none | ASSISTED | ASSISTED | MEDIUM |
| oa-plugins-directory-install | Utilizarea pluginurilor din directorul universal (instalare, conectar… | AVAILABLE | Directorul pe toate planurile; fiecare plugin depinde de pl… | yes | low | PROGRAMMATIC | MIRROR_STATE | HIGH |
| oa-mcp-apps-ui | Apps SDK / UI MCP Apps în ChatGPT (componente iframe, bridge window.o… | DOCUMENTED | Folosire: planurile cu pluginuri. Dezvoltare și testare în … | yes | none | ASSISTED | REFERENCE | MEDIUM |
| oa-developer-mode-custom-mcp | Developer mode și aplicații MCP personalizate în ChatGPT (web) | ELIGIBILITY_UNKNOWN | MCP complet (inclusiv scrieri), în beta: Business și Enterp… | yes | none | ASSISTED | REFERENCE | MEDIUM |
| oa-local-mcp-plugin-desktop | Aplicații MCP locale în pluginuri personale și servere MCP locale în … | NEEDS_SETUP | Nespecificat pentru uz personal; în workspace-uri cere perm… | yes | none | ASSISTED | ASSISTED | HIGH |
| oa-secure-mcp-tunnel | Secure MCP Tunnel (tunnel-client outbound pentru servere MCP private) | BLOCKED | Organizație pe platforma API cu permisiuni Tunnels Read + M… | unknown | unknown | PROGRAMMATIC | REJECT | LOW |
| oa-sites | ChatGPT Sites (site-uri și aplicații ușoare găzduite, cu automatizări… | ELIGIBILITY_UNKNOWN | Beta public pentru workspace-uri, Plus și Pro (learn: Plus,… | partial | none | NATIVE_INTERACTIVE | ASSISTED | LOW |
| oa-sites-connected-plugins | Sites cu pluginuri/aplicații conectate (date per vizitator) | PLAN_RESTRICTED | Business și Enterprise (recap: și Healthcare, Education) | not_applicable | none | NONE | NOT_APPLICABLE | LOW |
| oa-sites-hosted-plugin | Găzduirea unui plugin (server MCP) pe ChatGPT Sites | DOCUMENTED | Help-urile despre găzduire și despre pluginuri spun „toate … | partial | none | NATIVE_INTERACTIVE | REJECT | LOW |
| oa-mcp-events | MCP Events pentru automatizări de pluginuri (events/list, events/subs… | BLOCKED | Recap: toate abonamentele; sarcinile declanșate de evenimen… | yes | low | ASSISTED | REIMPLEMENT | MEDIUM |
| oa-space | ChatGPT Space (spații, pagini, fișiere; înlocuiește Library) | ELIGIBILITY_UNKNOWN | Pro, Business, Enterprise | yes | none | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| oa-dynamic-pages | Dynamic Pages (pagini cu grafice, dashboard-uri, @dot/@ChatGPT, actua… | ROLLOUT_PENDING | Pro, Business, Enterprise | yes | none | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| oa-collaborative-slides | Collaborative Slides (editor de prezentări în ChatGPT, export PowerPo… | ROLLOUT_PENDING | Pro, Business, Enterprise (recap) | yes | none | NONE | REFERENCE | MEDIUM |
| oa-teams-team-tasks | Teams în ChatGPT și team tasks (sarcini recurente sau declanșate de e… | PLAN_RESTRICTED | Business și Enterprise | partial | low | NONE | NOT_APPLICABLE | LOW |
| oa-chatgpt-slack-teams | @ChatGPT în Slack și Microsoft Teams | PLAN_RESTRICTED | Business și Enterprise; instalare de către adminii ChatGPT … | unknown | unknown | NONE | REJECT | LOW |
| oa-meetings-record | Meetings plugin / ChatGPT Record (înregistrare, transcriere și rezuma… | ROLLOUT_PENDING | Meetings plugin: beta pe Mac pentru Pro și Business; Window… | yes | none | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| oa-shareable-profiles | Shareable profiles (profil ChatGPT cu activitate și vitrină de Sites) | DOCUMENTED | Toate planurile non-Enterprise; Enterprise în curând | yes | none | NONE | NOT_APPLICABLE | LOW |
| oa-siwc-identity | Sign in with ChatGPT (doar identitate) | NOT_APPLICABLE | Global pentru utilizatorii autentificați; pentru integrator… | not_applicable | none | NONE | NOT_APPLICABLE | NONE |
| oa-siwc-plan-usage | Utilizarea planului ChatGPT în alte aplicații (Sign in with ChatGPT –… | ELIGIBILITY_UNKNOWN | Utilizarea planului: doar Plus și Pro (conectarea la instru… | yes | low | PROGRAMMATIC | REFERENCE | MEDIUM |
| oa-dots | dots (agenți mereu activi cu computer propriu în cloud) | PLAN_RESTRICTED | Pro 100/200/500 doar pentru utilizatori peste 18 ani în afa… | partial | low | NONE | REFERENCE | MEDIUM |
| oa-agents-api | Agents API (harness Codex gestionat de OpenAI) | BLOCKED | Cont API (cheie API) | no | high | PROGRAMMATIC | REJECT | MEDIUM |
| oa-agents-api-computer-use | Computer use în Agents API (browser găzduit) și în Codex/Work pentru … | BLOCKED | API; recap: și în Codex și ChatGPT Work pentru abonații Pro… | no | high | PROGRAMMATIC | REJECT | LOW |
| oa-chatgpt-work | ChatGPT Work (agent pentru sarcini lungi, cu livrabile) | ELIGIBILITY_UNKNOWN | Web și mobil: planuri plătite eligibile. Desktop: când Work… | yes | low | NATIVE_INTERACTIVE | ASSISTED | HIGH |
| oa-work-computer-use-desktop | Computer Use în ChatGPT Desktop (Work și Codex) | AVAILABLE | Work sau Codex, în regiunile suportate | yes | low | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| oa-work-cloud-browser | Cloud browser în ChatGPT Work (succesorul modului agent) | ELIGIBILITY_UNKNOWN | Navigarea pe site-uri care cer autentificare (web și mobil)… | yes | low | NATIVE_INTERACTIVE | ASSISTED | LOW |
| oa-chatgpt-agent-mode-legacy | ChatGPT agent (mod agent, retras) | NOT_APPLICABLE | n/a | not_applicable | none | NONE | NOT_APPLICABLE | NONE |
| oa-chatgpt-memory | Memoria ChatGPT (saved memories, chat history) și memoriile locale Co… | DOCUMENTED | Controalele variază după plan, regiune și workspace | yes | none | NATIVE_INTERACTIVE | REIMPLEMENT | HIGH |
| oa-chatgpt-projects | Projects în ChatGPT (chaturi, fișiere, instrucțiuni, surse partajate) | DOCUMENTED | Toți utilizatorii autentificați; partajarea pe Free, Go, Pl… | yes | none | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| oa-scheduled-tasks | Scheduled tasks în ChatGPT (unice, recurente, monitorizare) | DOCUMENTED | Free, Go, Plus, Pro, Business, Enterprise, Edu; sarcini act… | yes | low | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| oa-event-triggered-tasks | Sarcini Work declanșate de evenimente (Gmail, Slack, GitHub PR) | ELIGIBILITY_UNKNOWN | Plus, Pro, Business, Enterprise, Edu, Healthcare; nu Free/G… | yes | low | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| oa-deep-research | Deep research în ChatGPT | ELIGIBILITY_UNKNOWN | Variază după plan și țară; inclus în Pro | yes | none | NATIVE_INTERACTIVE | ASSISTED | HIGH |
| oa-deep-research-api | Deep research prin API (Responses API, background mode) | BLOCKED | Cont API | no | high | PROGRAMMATIC | REJECT | LOW |
| oa-workspace-agents | ChatGPT Workspace Agents și declanșarea lor prin API | PLAN_RESTRICTED | Business și Enterprise (Enterprise oprit implicit) | unknown | unknown | PROGRAMMATIC | REFERENCE | LOW |
| oa-site-tools-webmcp | Site tools (WebMCP) în browserul ChatGPT Desktop | DOCUMENTED | Enterprise cu aprobare admin; Edu nesuportat; alte planuri … | yes | none | ASSISTED | REFERENCE | MEDIUM |
| oa-chatgpt-skills | Skills în ChatGPT (creare, încărcare, partajare) | PLAN_RESTRICTED | Biblioteca Skills din ChatGPT (creare, încărcare cu scanare… | not_applicable | none | NONE | REFERENCE | LOW |
| oa-chatgpt-data-export | Exportul datelor ChatGPT (istoric și date de cont) | DOCUMENTED | Free, Go, Plus, Pro și Edu eligibil; nu Business, Enterpris… | yes | none | ASSISTED | ASSISTED | MEDIUM |
| oa-import-other-agent | Import din alt agent (Claude Code, Claude Cowork, Cursor) în ChatGPT … | DOCUMENTED | Nespecificat | yes | none | PROGRAMMATIC | REFERENCE | MEDIUM |
| oa-chatgpt-access-tokens | Access tokens ChatGPT (Codex, Workspace Agents) și conturi de serviciu | PLAN_RESTRICTED | Tokeni Codex: Business și Enterprise; conturi de serviciu: … | partial | low | PROGRAMMATIC | REFERENCE | LOW |
| oa-compliance-analytics-api | Compliance API, Conversation API și Analytics API pentru workspace-uri | PLAN_RESTRICTED | Enterprise (și Edu după caz) | not_applicable | none | PROGRAMMATIC | REFERENCE | LOW |
| oa-gap-app-server-auth-policy | Politica OpenAI pentru autentificarea Codex app-server în aplicații p… | AVAILABLE | Orice plan ChatGPT care include Codex. Conform help center,… | yes | low | PROGRAMMATIC | WRAP | HIGH |
| oa-gap-codex-requirements-toml | Configurație gestionată Codex: requirements.toml de sistem (allowed_l… | NEEDS_SETUP | Tabelul Feature availability din pricing: requirements.toml… | yes | none | ASSISTED | ASSISTED | HIGH |
| oa-gap-codex-auth-precedence-env | Precedența autentificării Codex și variabilele de mediu care schimbă … | AVAILABLE | n/a | not_applicable | high | PROGRAMMATIC | WRAP | HIGH |
| oa-gap-codex-image-generation | Generarea de imagini în Codex și ChatGPT Work (gpt-image-2, skill $im… | AVAILABLE | Planuri plătite (Plus, Pro, Business, Enterprise/Edu); nu F… | yes | low | PROGRAMMATIC | WRAP | MEDIUM |
| oa-gap-codex-model-integrity | Integritatea identității modelului în Codex: allowProviderModelFallba… | ELIGIBILITY_UNKNOWN | n/a (comportament de protocol) | unknown | unknown | PROGRAMMATIC | REJECT | HIGH |
| oa-gap-codex-command-exec | Execuție de comenzi în sandbox-ul Codex fără inferență: command/exec … | AVAILABLE | Orice plan (nu folosește modelul). | not_applicable | none | PROGRAMMATIC | WRAP | MEDIUM |
| oa-gap-codex-debug-commands | codex debug: app-server send-message-v2, models, prompt-input | BLOCKED | send-message-v2 consumă planul; celelalte nu folosesc model… | yes | low | PROGRAMMATIC | REJECT | MEDIUM |
| oa-gap-codex-feature-flags | Feature flags Codex: citire (codex features list, experimentalFeature… | AVAILABLE | Toate planurile | not_applicable | none | PROGRAMMATIC | MIRROR_STATE | HIGH |
| oa-gap-codex-doctor | codex doctor [--json]: raport de diagnostic redactat (instalare, conf… | AVAILABLE | Toate planurile | not_applicable | none | PROGRAMMATIC | WRAP | MEDIUM |
| oa-gap-codex-skills-isolation | Izolarea skill-urilor native în firele Codex lansate de Hub ([[skills… | NEEDS_SETUP | Toate planurile | not_applicable | none | PROGRAMMATIC | WRAP | HIGH |
| oa-gap-codex-web-search | Căutarea web în Codex (web_search: disabled \| cached \| indexed \| l… | AVAILABLE | Toate planurile cu Codex | yes | low | PROGRAMMATIC | WRAP | HIGH |
| oa-gap-codex-oss-local-providers | Furnizori locali open source în Codex (codex --oss, --local-provider … | NEEDS_SETUP | Niciun plan OpenAI necesar pentru inferența locală. | not_applicable | none | PROGRAMMATIC | WRAP | MEDIUM |
| oa-gap-codex-cloud-legacy | Codex Cloud (Legacy): mediile vechi pentru Code Review și integrările… | DOCUMENTED | Codex Cloud: Plus eligibil, toate nivelurile Pro, Business,… | yes | low | ASSISTED | REFERENCE | LOW |
| oa-gap-codex-ide-extension | Extensia Codex pentru IDE (VS Code, Cursor, Windsurf; integrări Xcode… | DOCUMENTED | Toate planurile cu Codex | yes | low | NATIVE_INTERACTIVE | MIRROR_STATE | LOW |
| oa-gap-browser-annotation-api | Annotations Extensibility / Browser Annotation API (document.oai.anno… | DOCUMENTED | Planuri non-Enterprise/Edu (Pro inclus implicit prin exclud… | yes | low | ASSISTED | REUSE_NATIVE | LOW |
| oa-gap-chatgpt-visualizations | Visualizations (@Visualize în Chat și Work, /visualize în paginile Sp… | ROLLOUT_PENDING | Depinde de plan, platformă, cont și workspace (preview). | yes | none | NATIVE_INTERACTIVE | ASSISTED | LOW |
| oa-gap-chatgpt-apps-connections | Apps (conectori) în ChatGPT: conexiuni de cont per furnizor, permisiu… | AVAILABLE | Apps personale: depind de aplicație, plan, regiune și model… | partial | low | ASSISTED | ASSISTED | MEDIUM |
| oa-gap-chatgpt-office-addins | ChatGPT pentru Excel, Word și PowerPoint (add-in Microsoft) și ChatGP… | DOCUMENTED | Word: toate planurile ChatGPT, inclusiv Free. Excel, Google… | yes | low | ASSISTED | ASSISTED | MEDIUM |
| oa-gap-custom-gpts | Custom GPTs: retragere planificată și migrarea fluxurilor către plugi… | PLAN_RESTRICTED | Utilizare: toate planurile. Creare: nu pe conturile persona… | partial | none | NONE | REJECT | LOW |
| oa-gap-chatgpt-pro-models | Modele Pro în Chat: GPT-6 Pro (pe GPT-6 Astra) și GPT-5.6 Sol Pro | ELIGIBILITY_UNKNOWN | GPT-6 Pro: Pro $100, Pro $200, Business, Enterprise. GPT-5.… | yes | none | NATIVE_INTERACTIVE | ASSISTED | MEDIUM |
| oa-gap-model-gpt-rosalind | GPT-Rosalind (gpt-rosalind-research) — model pentru științele vieții,… | PLAN_RESTRICTED | Organizații aprobate; nu este inclus automat în planurile p… | no | unknown | NONE | NOT_APPLICABLE | LOW |
| oa-gap-agents-sdk | OpenAI Agents SDK (Python și TypeScript, open source) | DOCUMENTED | Cont API OpenAI (cheie API) pentru modelele OpenAI; nu folo… | no | high | NONE | REFERENCE | LOW |
| oa-gap-agents-api-plugins-tool | Unealta Plugins din Agents API (pachete de skills + configurație MCP … | BLOCKED | Cont API OpenAI (Agents API, facturare pe tokeni și unelte). | no | high | NONE | REFERENCE | LOW |

## Index de surse (anunțuri / release notes)

| Data | Titlu | Relevanță | URL |
|---|---|---|---|
| 2026-09-29 | DevDay 2026 pe scurt (recapitulare, peste 20 de anunțuri) | HIGH – sursa de index pentru toate capabilitățile OpenAI noi | https://openai.com/index/devday-2026-recap/ |
| 2026-09-29 | Introducing dots | MEDIUM – fără API; pe Pro indisponibil în SEE/UK/CH | https://openai.com/index/introducing-dots/ |
| 2026-09-29 | Introducing GPT-6.1 Sol | HIGH – model implicit propus pentru router | https://openai.com/index/introducing-gpt-6-1-sol/ |
| 2026-09-29 | Ultrafast (GPT-6 Astra Ultrafast) | LOW – blocat de BillingPolicy | https://learn.chatgpt.com/docs/agent-configuration/speed#ultrafast-mode |
| 2026-09-29 | Astra Ultrafast în API | NONE – API plătit | https://developers.openai.com/api/docs/guides/ultrafast-mode |
| 2026-09-29 | Private Intelligence (ZDR with Private Safety Processing + preview Private Inference) | NONE – enterprise/API | https://developers.openai.com/api/docs/guides/private-safety-processing |
| 2026-09-29 | Codex în cloud (medii reutilizabile) | MEDIUM – asistat, cere repo conectat | https://learn.chatgpt.com/docs/cloud |
| 2026-09-29 | Reusable cloud environments | MEDIUM | https://learn.chatgpt.com/docs/environments/cloud-environments |
| 2026-09-29 | Codex CLI, formă nouă | HIGH – runtime-ul OpenAI al Hub-ului | https://learn.chatgpt.com/docs/codex/cli |
| 2026-09-29 | Code review în ChatGPT desktop | MEDIUM | https://learn.chatgpt.com/docs/code-review |
| 2026-09-29 | Codex Security Cloud | MEDIUM – asistat | https://learn.chatgpt.com/docs/security/setup |
| 2026-09-29 | Decisions API | LOW – API plătit | https://openai.com/index/devday-2026-recap/#new-tools-for-developers-in-codex-api |
| 2026-09-29 | Computer use în Agents API | LOW – API plătit / Pro 500 | https://developers.openai.com/api/docs/guides/agents-api/tools/computer-use |
| 2026-09-29 | Amazon Bedrock Managed Agents for OpenAI | NONE – serviciu plătit nou | https://developers.openai.com/api/docs/guides/agents-api/bedrock-managed-agents |
| 2026-09-29 | Plugin Extensions | LOW – necesită expunere publică | https://developers.openai.com/plugins/build/extensions |
| 2026-09-29 | Creare, trimitere spre review și descoperire de pluginuri | LOW | https://developers.openai.com/plugins/deploy/submission |
| 2026-09-29 | Sites cu pluginuri conectate | NONE – plan de echipă, indisponibil în SEE | https://learn.chatgpt.com/docs/sites |
| 2026-09-29 | MCP Events pentru automatizări | LOW – Hub doar loopback | https://developers.openai.com/plugins/build/mcp-events |
| 2026-09-29 | Website annotations (Annotations Extensibility) | LOW | https://learn.chatgpt.com/docs/annotations-extensibility |
| 2026-09-29 | ChatGPT Space | LOW – Hub rămâne sursa canonică | https://learn.chatgpt.com/docs/space |
| 2026-09-29 | Dynamic Pages | LOW – export manual din Hub | https://learn.chatgpt.com/docs/space/pages |
| 2026-09-29 | Collaborative Slides | LOW | https://openai.com/index/devday-2026-recap/#people-and-ai-working-together |
| 2026-09-29 | Teams și Team Tasks | NONE – plan de echipă | https://learn.chatgpt.com/docs/enterprise/teams |
| 2026-09-29 | @ChatGPT în Slack și Microsoft Teams | NONE | https://learn.chatgpt.com/docs/enterprise/chatgpt-slack-and-teams |
| 2026-09-29 | Workspace connections | NONE | https://learn.chatgpt.com/docs/enterprise/shared-connections |
| 2026-09-29 | Agent Security | LOW – referință pentru politica Hub | https://learn.chatgpt.com/docs/enterprise/agent-security |
| 2026-09-29 | Work across devices | LOW | https://learn.chatgpt.com/docs/get-started-with-work |
| 2026-09-29 | Meetings plugin | NONE | https://openai.com/index/devday-2026-recap/#people-and-ai-working-together |
| 2026-09-29 | Shareable profiles | NONE | https://openai.com/index/devday-2026-recap/#people-and-ai-working-together |
| 2026-09-29 | Sign in with ChatGPT | LOW – Hub-ul nu este partener eligibil | https://help.openai.com/en/articles/20001410-sign-in-with-chatgpt |
| 2026-09-29 | Noul nivel Pro (Pro 500) | MEDIUM – plan și politică de facturare | https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers |
| 2026-09-29 | OpenAI Marketplace | NONE | https://openai.com/index/devday-2026-recap/#do-more-with-your-chatgpt-subscription |
| 2026-09-29 | DevDay 2026 în documentația ChatGPT/Codex | HIGH – index tehnic verificabil | https://learn.chatgpt.com/docs/whats-new/devday-2026 |
| 2026-09-29 | Codex CLI 0.159.1 | HIGH – local rulează 0.158.0-alpha.2.1 | https://github.com/openai/codex/releases/tag/rust-v0.159.1 |
| 2026-09-22 | Introducing GPT-6 Sol and Luna | HIGH – modele pentru router | https://openai.com/index/introducing-gpt-6-sol-and-luna/ |
| 2026-09-14 | Pregătirea retragerii GPT-5.5 | MEDIUM – igienă de configurare | https://learn.chatgpt.com/docs/models#gpt-55-retirement |
| 2026-09-10 | Introducing the Agents API | LOW – API plătit | https://openai.com/index/introducing-the-agents-api/ |
| 2026-09-03 | GPT-6 Astra | HIGH – nivel de escaladare | https://openai.com/index/gpt-6-astra/ |
| 2026-09-29 | Codex CLI 0.159.1 și 0.159.0 (changelog) | HIGH | https://learn.chatgpt.com/docs/changelog |
| 2026-09-28 | Codex CLI 0.158.0 | MEDIUM | https://learn.chatgpt.com/docs/changelog |
| 2026-09-25 | Codex CLI 0.157.0 | HIGH | https://learn.chatgpt.com/docs/changelog |
| 2026-09-22 | Codex CLI 0.156.0 | HIGH | https://learn.chatgpt.com/docs/changelog |
| 2026-09-17 | Codex CLI 0.155.0 | MEDIUM | https://learn.chatgpt.com/docs/changelog |
| 2026-09-05 | Codex MCP server eliminat | HIGH | https://learn.chatgpt.com/docs/changelog |
| 2026-09-29 | What's new: DevDay 2026 (Codex) | HIGH | https://learn.chatgpt.com/docs/whats-new |
| 2026-09-30 (citit) | Codex App Server | HIGH | https://learn.chatgpt.com/docs/app-server |
| 2026-09-30 (citit) | Pricing Codex (tabel de disponibilitate pe planuri) | HIGH | https://learn.chatgpt.com/docs/pricing |
| 2026-09-30 (citit) | Command line options (referința CLI) | HIGH | https://learn.chatgpt.com/docs/cli/reference |
| 2026-09-30 (citit) | codex-app-server-daemon README | MEDIUM | https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server-daemon/README.md |
| 2026-09-30 (citit) | Remote connections | MEDIUM | https://learn.chatgpt.com/docs/remote-connections |
| 2026-09-30 (citit) | Scheduled tasks | MEDIUM | https://learn.chatgpt.com/docs/automations |
| 2026-09-30 (citit) | Computer Use | MEDIUM | https://learn.chatgpt.com/docs/computer-use |
| 2026-09-30 (citit) | Build plugins (developers) | MEDIUM | https://developers.openai.com/plugins/build/plugins |
| 2026-09-30 (citit) | Build skills | HIGH | https://learn.chatgpt.com/docs/build-skills |
| 2026-09-30 (citit) | Codex Security CLI FAQ | MEDIUM | https://learn.chatgpt.com/docs/security/cli/faq |
| 2026-08-19 | GitLab în Codex cloud (beta) | LOW | https://learn.chatgpt.com/docs/whats-new |
| 2026-06-16 | Mai multe funcții Codex în SEE, UK și Elveția | MEDIUM | https://learn.chatgpt.com/docs/changelog |
| 2026-09-29 | DevDay 2026 recap (captură locală, ediția ro-RO) | HIGH — baza inventarului; unele disponibilități sunt contrazise de Help Center … | https://openai.com/index/devday-2026-recap/ |
| 2026-09-29 | Introducing dots (captură locală) | MEDIUM — referință de produs, fără integrare. | https://openai.com/index/introducing-dots/ |
| 2026-09-10 | Introducing the Agents API (captură locală) | LOW — facturare API, respins. | https://openai.com/index/introducing-the-agents-api/ |
| 2026-09-30 | Plugin extensions | MEDIUM — posibil panou read-only în viitor. | https://developers.openai.com/plugins/build/extensions |
| 2026-09-30 | openai/mcp-extensions | MEDIUM | https://github.com/openai/mcp-extensions |
| 2026-09-30 | MCP Events | MEDIUM — semantică reimplementată intern. | https://developers.openai.com/plugins/build/mcp-events |
| 2026-09-30 | Triggers and Events Working Group charter | MEDIUM — specificația nu este finalizată. | https://modelcontextprotocol.io/community/working-groups/triggers-events |
| 2026-09-30 | Plugins overview și packaging | MEDIUM | https://developers.openai.com/plugins/build/plugins |
| 2026-09-30 | Plugin submission | LOW — publicare respinsă pentru Hub. | https://developers.openai.com/plugins/deploy/submission |
| 2026-09-30 | Submit a Claude plugin | MEDIUM — portabilitate între vendori. | https://developers.openai.com/plugins/guides/submit-claude-plugin |
| 2026-09-30 | Connect to ChatGPT (developer mode) | MEDIUM | https://developers.openai.com/plugins/deploy/connect-chatgpt |
| 2026-09-30 | Build UI for ChatGPT plugins | MEDIUM | https://developers.openai.com/plugins/build/chatgpt-ui |
| 2026-09-30 | Plugin auth | LOW | https://developers.openai.com/plugins/build/auth |
| 2026-09-30 | Secure MCP Tunnel | LOW — cere cheie API. | https://developers.openai.com/api/docs/guides/secure-mcp-tunnels |
| 2026-09-30 | Sign in with ChatGPT – developer docs | MEDIUM — explică de ce Hub-ul nu este eligibil și de ce nu are nevoie. | https://developers.openai.com/siwc/token-sharing-open-source |
| 2026-09-30 | Using your ChatGPT plan in other apps and sites | HIGH — risc de facturare de verificat în Settings > Usage. | https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites |
| 2026-09-30 | Sign in with ChatGPT (Help) | NONE | https://help.openai.com/en/articles/20001410-sign-in-with-chatgpt |
| 2026-09-30 | Sign in with ChatGPT (learn) | MEDIUM | https://learn.chatgpt.com/docs/sign-in-with-chatgpt.md |
| 2026-09-30 | About ChatGPT Pro tiers | HIGH — planul real al contului rămâne de confirmat. | https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers |
| 2026-09-30 | Agents API overview | LOW | https://developers.openai.com/api/docs/guides/agents-api/overview.md |
| 2026-09-30 | Agents API computer use | LOW | https://developers.openai.com/api/docs/guides/agents-api/tools/computer-use |
| 2026-09-30 | API pricing | LOW | https://developers.openai.com/api/docs/pricing.md |
| 2026-09-30 | Meet dots și subpagini | MEDIUM — probabil neeligibil în România. | https://learn.chatgpt.com/docs/dots.md |
| 2026-09-30 | ChatGPT Work and Codex | HIGH | https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex |
| 2026-09-30 | Get started with ChatGPT Work | HIGH | https://learn.chatgpt.com/docs/get-started-with-work.md |
| 2026-09-30 | Pricing (learn) | HIGH | https://learn.chatgpt.com/docs/pricing.md |
| 2026-09-30 | Computer Use | MEDIUM | https://learn.chatgpt.com/docs/computer-use.md |
| 2026-09-30 | Browser | LOW | https://learn.chatgpt.com/docs/browser.md |
| 2026-09-15 | ChatGPT agent | NONE | https://help.openai.com/en/articles/11752874-chatgpt-agent |
| 2026-09-30 | Scheduled tasks in ChatGPT | MEDIUM | https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt |
| 2026-09-30 | Scheduled tasks (learn) | MEDIUM | https://learn.chatgpt.com/docs/automations.md |
| 2026-09-30 | Creating and using ChatGPT Sites | LOW | https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites |
| 2026-09-30 | Hosting a plugin with ChatGPT Sites | LOW | https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites |
| 2026-09-30 | Getting started with Space in ChatGPT | MEDIUM | https://help.openai.com/en/articles/20001549-getting-started-with-space-in-chatgpt |
| 2026-09-30 | Teams in ChatGPT | LOW | https://help.openai.com/en/articles/20001541-teams-in-chatgpt |
| 2026-09-30 | @ChatGPT in Slack and Microsoft Teams | LOW | https://learn.chatgpt.com/docs/enterprise/chatgpt-slack-and-teams.md |
| 2026-09-30 | ChatGPT Record / Meetings | MEDIUM — indisponibil pe Windows. | https://help.openai.com/en/articles/11487532-chatgpt-record |
| 2026-09-30 | Shareable profiles in ChatGPT | LOW | https://help.openai.com/en/articles/20001539-shareable-profiles-in-chatgpt |
| 2026-09-22 | Deep research in ChatGPT | HIGH — flux ASSISTED de cercetare. | https://help.openai.com/en/articles/10500283-deep-research-in-chatgpt |
| 2026-09-30 | Deep research (API) | LOW | https://developers.openai.com/api/docs/guides/deep-research |
| 2026-09-20 | Memory in ChatGPT | HIGH — memoria canonică rămâne în Hub. | https://help.openai.com/en/articles/8590148-memory-faq |
| 2026-09-30 | Memories (learn) | MEDIUM | https://learn.chatgpt.com/docs/customization/memories.md |
| 2026-09-20 | Projects in ChatGPT | MEDIUM | https://help.openai.com/en/articles/10169521-projects-in-chatgpt |
| 2026-09-30 | Plugins in ChatGPT (Help) | HIGH — deschide calea MCP locală. | https://help.openai.com/en/articles/20001256-plugins-in-chatgpt |
| 2026-08-30 | Developer mode and MCP apps in ChatGPT | MEDIUM | https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt |
| 2026-08-30 | Build with the Apps SDK | LOW | https://help.openai.com/en/articles/12515353-build-with-the-apps-sdk |
| 2026-09-26 | ChatGPT Workspace Agents for Enterprise and Business | LOW — plan restricționat. | https://help.openai.com/en/articles/20001143-chatgpt-workspace-agents-for-enterprise-and-business |
| 2026-09-30 | Workspace Agents API docs | LOW | https://developers.openai.com/workspace-agents/llms-full.txt |
| 2026-09-30 | Access tokens și Service accounts | LOW | https://learn.chatgpt.com/docs/enterprise/access-tokens.md |
| 2026-09-30 | Codex App Server | HIGH — sursa pentru oglindirea read-only. | https://learn.chatgpt.com/docs/app-server.md |
| 2026-09-30 | Model Context Protocol (learn) | HIGH | https://learn.chatgpt.com/docs/extend/mcp.md |
| 2026-09-30 | Site tools (WebMCP) | MEDIUM | https://learn.chatgpt.com/docs/webmcp.md |
| 2026-09-30 | Import from another agent | MEDIUM | https://learn.chatgpt.com/docs/import.md |
| 2026-08-30 | Exporting your ChatGPT history and data | MEDIUM — portabilitate. | https://help.openai.com/en/articles/7260999-exporting-your-chatgpt-history-and-data |
| 2026-08-30 | Skills in ChatGPT | LOW | https://help.openai.com/en/articles/20001066-skills-in-chatgpt |
| 2026-08-30 | Documents, spreadsheets and presentations with ChatGPT Work | MEDIUM | https://help.openai.com/en/articles/20001278-creating-and-editing-documents-spreadsheets-and-presentations-with-chatgpt-work |
| 2026-09-30 | What's new: DevDay 2026 și 28.09–02.10.2026 | MEDIUM | https://learn.chatgpt.com/docs/whats-new/september-28-october-2-2026.md |

## models

### GPT-6.1 Sol (gpt-6.1-sol) (`oa-model-gpt-6-1-sol`)

- **Sursă oficială:** https://openai.com/index/introducing-gpt-6-1-sol/
- **Documentație tehnică:** https://learn.chatgpt.com/docs/models#gpt-61-sol ; https://developers.openai.com/api/docs/models/gpt-6.1-sol
- **Ce face:** Versiune îmbunătățită a GPT-6 Sol pentru agentic coding, computer use și muncă profesională; performanță apropiată de GPT-6 Astra la un cost mult mai mic. OpenAI îl recomandă explicit pentru muncă complexă, repetată și de lungă durată în Codex și ChatGPT Work. Context 1.050.000 tokeni, max. 128.000 output, knowledge cutoff 30.04.2026; reasoning effort în API: low, medium (implicit), high, xhigh, max (fără none/minimal); în Codex: Light→Ultra.
- **Plan necesar:** Plus, toate nivelurile Pro, Business, Enterprise, Edu (Enterprise/Edu: dezactivat implicit până îl activează un administrator). Free și Go nu sunt incluse la lansare.
- **Platformă:** Codex (ChatGPT desktop app, Codex CLI, IDE extension), ChatGPT Work (web și mobil), OpenAI API. Nu este disponibil încă în Chat.
- **Rollout:** Lansat 29.09.2026 pentru Plus, Pro, Business, Enterprise și Edu în ChatGPT Work și Codex (Enterprise/Edu: oprit implicit până la activarea de către admin); Standard și Fast la lansare. Ultrafast pentru 6.1 Sol: pagina Models din Codex spune că vine mai târziu, recapitularea DevDay spune „în curând”, ghidul API Ultrafast nu îl listează, dar postarea de lansare afirmă că GPT-6.1 Sol Ultrafast este disponibil în API și pe Pro 500. Sursele se contrazic, deci se tratează ca neconfirmat. Codex CLI 0.159.1 (29.09.2026) îl face model implicit în catalogul inclus și în cataloagele Bedrock Mantle/Runtime; ultima versiune este 0.159.2.
- **Eligibilitate cont:** Neverificată în V2. V1 a raportat planType prolite (nivel Pro), deci eligibilitatea este probabilă. Catalogul inclus în binarul local 0.158.0-alpha.2.1 nu conține gpt-6.1-sol (grep read-only). model/list descrie un catalog, nu un drept de acces: câmpul available_in_plans din catalogul local listează chiar și free/go pentru gpt-6-astra. Accesul se confirmă doar printr-un turn finalizat, aprobat explicit.
- **Autentificare:** ChatGPT sign-in în Codex (codex login status: Logged in using ChatGPT). Ruta API key este refuzată de BillingPolicy.
- **Allowance:** Plus / Standard Business: aprox. 15–160 mesaje locale per 5 ore (estimare, nu limită fixă); Pro: în prezent fără limită de 5 ore, pot exista limite săptămânale. Rată credite: 50 / 2,5 / 250 credite per 1M tokeni input / cached input / output.
- **Utilizare partajată:** Aceeași alocare cu ChatGPT Work, Codex cloud, ChatGPT for Excel/Word/PowerPoint și Workspace Agents (unde sunt disponibile pe plan).
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** După epuizarea alocării incluse, consumul trece automat pe soldul de credite dacă există sold; automatic reload poate cumpăra credite. Fast mode consumă de 2,5x alocarea inclusă. Prețul API (2 $ / 0,10 $ / 10 $ per 1M) nu se aplică rutei de abonament.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Codex app-server (JSON-RPC pe stdio): model/list (id, isDefault, hidden, supportedReasoningEfforts, defaultReasoningEffort, serviceTiers, defaultServiceTier, upgradeInfo) → thread/start {model: gpt-6.1-sol, serviceTier: null} → turn/start {effort: low\|medium\|high\|xhigh\|max\|ultra, serviceTierForTurn: default}. Echivalent CLI: codex exec -m gpt-6.1-sol; config.toml: model = gpt-6.1-sol. Notificări de urmărit: model/rerouted, model/verification.
- **Suprafață nativă:** Selectorul model/reasoning (Power slider, Advanced) din ChatGPT desktop pentru Work/Codex, /model în Codex CLI, switcher în IDE extension.
- **Cerințe locale:** Codex desktop/CLI autentificat cu ChatGPT; recomandat Codex ≥ 0.159.1 pentru catalogul nou (local: 0.158.0-alpha.2.1).
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Model OpenAI implicit al Hub-ului pentru Builder (implementare) și Reviewer: medium pentru muncă tehnică complexă, xhigh pentru livrabile finale și decizii din dovezi contradictorii.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** Claude Opus 5.5 / Sonnet 5.5 prin Claude Code headless pe abonamentul Max.
- **Ce face unic / mai bine:** Raport cost/calitate declarat de vendor foarte bun (aprox. 1/5 din prețul Astra), context 1,05M, suport Ultra (subagenți paraleli) în Codex, modelul recomandat implicit de OpenAI pentru coding agentic.
- **Securitate:** Ghidul GPT-6 descrie sensibilitatea crescută la instrucțiunile din skills și AGENTS.md ca un comportament observat la GPT-6 Astra și cere ca promptingul să fie evaluat pe modelul ales; auditarea fișierelor de instrucțiuni rămâne recomandată și pentru 6.1 Sol. Backend-ul poate reruta turnul pe alt model (model/rerouted, motiv HighRiskCyberActivity). Hub-ul nu trebuie să seteze thread/start.allowProviderModelFallback (experimental), care poate înlocui un model indisponibil cu modelul implicit al providerului.
- **Cale de implementare:** Router Hub: descoperă modelele prin model/list la fiecare sesiune (fără ID-uri fixate în cod), selectează gpt-6.1-sol pentru rolurile Builder/Reviewer, fixează serviceTier standard, înregistrează modelul efectiv din răspunsul thread/start și orice model/rerouted în audit.
- **Test necesar:** Verificare read-only a contului (account/read, model/list, account/rateLimits/read) fără turn; apoi un singur turn live aprobat explicit (grant LIVE_VALIDATION) cu gpt-6.1-sol, effort medium, serviceTier standard.
- **Status:** DOCUMENTED
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Benchmark-urile din postare sunt raportate de vendor. Contradicția despre Ultrafast este între postarea de lansare (disponibil) și documentația Codex plus recapitularea DevDay (mai târziu / în curând). Recapitularea nu îl anunță ca disponibil în API.
- **Surse citite:** https://learn.chatgpt.com/docs/models.md · https://developers.openai.com/api/docs/models/gpt-6.1-sol.md · https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra.md · https://learn.chatgpt.com/docs/pricing.md · https://learn.chatgpt.com/docs/agent-configuration/speed.md · https://github.com/openai/codex/releases/tag/rust-v0.159.1 · scratchpad/sources-openai-devday.md (captură openai.com: introducing-gpt-6-1-sol, devday-2026-recap)
- **Verificare adversarială:** CORRECTED (corectat: rollout (https://learn.chatgpt.com/docs/models.md ; https://openai.com/index/introducing-gpt-6-1-sol/ (ediția ro-RO, browser integrat) ; https://openai.com/index/devday-2026-recap/ (secțiunea Ultrafast) ; https://developers.openai.com/api/docs/guides/ultrafast-mode.md ; https://learn.chatgpt.com/docs/changelog), accountEligibility (grep read-only pe %LOCALAPPDATA%\OpenAI\Codex\bin\faa963e871dd422c\codex.exe ; https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server.md), securityConcerns (https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra.md ; https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server-protocol/src/protocol/v2/thread.rs), notes (https://openai.com/index/introducing-gpt-6-1-sol/ ; https://openai.com/index/devday-2026-recap/ ; https://learn.chatgpt.com/docs/models.md)) — Verificat în models.md, pricing.md, speed.md, pagina API gpt-6.1-sol (effort low–max, fără none/minimal; 1,05M context; 128K output; cutoff 30.04.2026; 2/0,10/10 $), changelog 0.159.1 și postarea de lansare. Planurile, alocările (15–160 pe 5 ore pe Plus; fără limită de 5 ore pe Pro), ratele de credite (50/2,5/250), subscriptionIncluded, apiBillingRisk low, PROGRAMMATIC și WRAP sunt corecte.

### GPT-6 Astra (gpt-6-astra) (`oa-model-gpt-6-astra`)

- **Sursă oficială:** https://openai.com/index/gpt-6-astra/
- **Documentație tehnică:** https://learn.chatgpt.com/docs/models ; https://developers.openai.com/api/docs/models/gpt-6-astra
- **Ce face:** Cel mai capabil model OpenAI (lansat în Codex/ChatGPT Work la începutul lui septembrie 2026): reasoning avansat, coding, computer use, research și creare de documente; OpenAI îl descrie și ca cel mai bine aliniat model al său. Context 1.050.000, max. 128.000 output, knowledge cutoff 30.04.2026; reasoning effort API: low, medium, high, xhigh, max (fără none); Codex: Light (low)→Ultra.
- **Plan necesar:** Plus, Pro, Business, Enterprise/Edu (Enterprise cere eligibilitate de rollout și activare de administrator). Free și Go: nu (primesc doar GPT-6 Luna).
- **Platformă:** ChatGPT desktop app, ChatGPT Work web, Codex CLI, IDE extension, ChatGPT Credits, OpenAI API.
- **Rollout:** Disponibil din săptămâna 31.08–04.09.2026; Ultrafast disponibil din 29.09.2026 (Pro 500 / Enterprise eligibil / API).
- **Eligibilitate cont:** Neverificată în V2; probabil disponibil pe un plan Pro (V1: prolite). model/list nu dovedește dreptul de acces: catalogul local listează Astra și pentru free/go, deși documentația îl exclude. Confirmarea se face doar printr-un turn aprobat.
- **Autentificare:** ChatGPT sign-in în Codex.
- **Allowance:** Plus / Standard Business: aprox. 5–45 mesaje locale per 5 ore (estimare); Pro: fără limită de 5 ore în prezent. Credite: 250 / 25 / 1.250 per 1M tokeni (de 5x mai scump decât GPT-6.1 Sol).
- **Utilizare partajată:** Alocare comună Codex + ChatGPT Work (+ Excel/Word/PowerPoint, Workspace Agents).
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Consumă alocarea mult mai repede decât Sol/Luna; după epuizare trece automat pe credite dacă există sold. Fast: 2,5x din alocarea inclusă / 2x pe credite. Ultrafast: 8x din alocare / 6x pe credite (Pro 500 și Enterprise/Edu eligibile). API: 10 $ / 1 $ / 50 $ per 1M, cache writes 12,5 $. Peste 272K tokeni de intrare, întreaga cerere costă 2x la input și cache și 1,5x la output (nu dublu pe tot).
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Codex app-server: thread/start sau turn/start cu model: gpt-6-astra, effort low…ultra; model/list expune serviceTiers pentru Fast/Ultrafast (ID-urile de tier trebuie citite, nu presupuse). CLI: codex exec -m gpt-6-astra.
- **Suprafață nativă:** Presetări Power din ChatGPT desktop (Astra Light, Astra Medium, Astra Extra High pe unele planuri), /model în CLI.
- **Cerințe locale:** Codex autentificat cu ChatGPT.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Nivelul de escaladare pentru arhitectură, securitate, depanare profundă și livrabile cu cerințe stricte; folosit doar cu aprobare explicită din cauza consumului.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** Claude Fable 5.1 / Claude Opus 5.5 (effort max) prin Claude Code.
- **Ce face unic / mai bine:** Cea mai mare capacitate OpenAI pe fluxuri lungi cu mai multe unelte, pune întrebări focalizate când răspunsul schimbă rezultatul, singurul model cu Ultrafast la lansare.
- **Securitate:** Sensibilitate crescută la instrucțiunile din skills/AGENTS.md; monitorizare asincronă de misalignment pe partea OpenAI; tendință de a cere clarificări și aprobări (poate bloca rulări autonome).
- **Cale de implementare:** Router Hub: Astra doar pentru clasa de risc/complexitate ridicată, cu grant de aprobare și buget de alocare; implicit effort low/medium, xhigh doar pentru analize exigente; fără Fast/Ultrafast.
- **Test necesar:** model/list pentru confirmare; turn live doar după aprobare separată, cu verificarea consumului în account/rateLimits/read înainte și după.
- **Status:** DOCUMENTED
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Postarea https://openai.com/index/gpt-6-astra/ (3.09.2026) a fost citită în această verificare (ediția ro-RO, browser integrat). Ea confirmă: rollout treptat, apoi toți utilizatorii Plus, Pro, Business și Enterprise, plus API, Azure și Bedrock. Utilizarea este inclusă în limitele abonamentelor existente, cu credite pentru utilizare suplimentară. Pro, Business și Enterprise primesc și GPT-6 Astra Pro. În Enterprise accesul este dezactivat implicit până îl activează un admin.
- **Surse citite:** https://developers.openai.com/api/docs/models/gpt-6-astra.md · https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra.md · https://learn.chatgpt.com/docs/models.md · https://learn.chatgpt.com/docs/pricing.md · https://learn.chatgpt.com/docs/whats-new.md (August 31–September 4, 2026)
- **Verificare adversarială:** CORRECTED (corectat: extraBillingRisk (https://developers.openai.com/api/docs/models/gpt-6-astra.md ; https://learn.chatgpt.com/docs/pricing.md ; https://learn.chatgpt.com/docs/agent-configuration/speed.md), accountEligibility (grep read-only pe binarul local codex.exe (available_in_plans) ; https://learn.chatgpt.com/docs/pricing.md), notes (https://openai.com/index/gpt-6-astra/ (ediția ro-RO, citită în browserul integrat))) — Model API: effort low–max, 1,05M context, 128K output, cutoff 30.04.2026. În Codex, Light corespunde lui low, iar catalogul local are efortul implicit low și eforturile low…ultra. Alocarea pe Plus: 5–45 pe 5 ore; credite 250/25/1.250. Status, WRAP și subscriptionIncluded sunt corecte.

### GPT-6 Sol (gpt-6-sol) (`oa-model-gpt-6-sol`)

- **Sursă oficială:** https://openai.com/index/introducing-gpt-6-sol-and-luna/
- **Documentație tehnică:** https://developers.openai.com/api/docs/models/gpt-6-sol
- **Ce face:** Model GPT-6 de nivel mediu pentru coding complex și fluxuri agentice, lansat 22.09.2026 cu prețuri API reduse cu 50% față de prețurile promoționale GPT-5.6 Sol. Suportă reasoning none…max (implicit medium); context 1,05M; knowledge cutoff 20.04.2026. Înlocuitorul oficial al GPT-5.5 pe Plus/Pro/Business/Enterprise/Edu.
- **Plan necesar:** Plus, Pro, Business, Enterprise, Edu (ChatGPT Work și Codex); în Enterprise administratorii trebuie să activeze modelele noi. Free și Go nu primesc Sol (doar GPT-6 Luna în aplicația desktop).
- **Platformă:** Codex, ChatGPT Work; OpenAI API; Amazon Bedrock (openai.gpt-6-sol). Nu în Chat.
- **Rollout:** Disponibil din 22.09.2026, lansat treptat; depășit ca recomandare de GPT-6.1 Sol din 29.09.2026.
- **Eligibilitate cont:** Neverificată în V2; probabil disponibil (plan Pro raportat în V1).
- **Autentificare:** ChatGPT sign-in în Codex.
- **Allowance:** Plus / Standard Business: aprox. 15–150 mesaje locale per 5 ore; credite 50 / 5 / 250 per 1M tokeni.
- **Utilizare partajată:** Alocare comună Codex + ChatGPT Work.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Spill în credite după epuizarea alocării dacă există sold. API: 2 $ / 0,20 $ / 10 $ per 1M (neaplicabil rutei de abonament).
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Codex app-server: thread/start\|turn/start cu model gpt-6-sol. Efortul implicit din catalogul local este medium, iar Codex recomandă pornirea cu Sol Medium. Effort none este documentat doar pentru API; în Codex se folosește numai dacă apare în supportedReasoningEfforts din model/list. CLI: codex exec -m gpt-6-sol.
- **Suprafață nativă:** Presetări Power GPT-6 Sol Light/Medium în ChatGPT desktop; /model în CLI.
- **Cerințe locale:** Codex autentificat cu ChatGPT.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Fallback automat al routerului când gpt-6.1-sol lipsește din model/list; înlocuitor pentru orice configurare veche gpt-5.5.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** Claude Sonnet 5.5.
- **Ce face unic / mai bine:** Suport effort none, disponibil și pe Bedrock; costuri mici. Vendor raportează pe AutomationBench 33,2% (xhigh) la 0,27 $/sarcină.
- **Securitate:** Aceleași ca familia GPT-6 (sensibilitate la instrucțiuni din fișiere).
- **Cale de implementare:** Listă de preferințe în router: gpt-6.1-sol → gpt-6-sol → gpt-6-luna, filtrată prin model/list.
- **Test necesar:** model/list read-only.
- **Status:** DOCUMENTED
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Comparațiile cu modele Claude din postare sunt raportate de OpenAI și folosesc rapoarte publice ale concurenței.
- **Surse citite:** https://openai.com/ro-RO/index/introducing-gpt-6-sol-and-luna/ (citit în browserul integrat) · https://developers.openai.com/api/docs/models/gpt-6-sol.md · https://learn.chatgpt.com/docs/models.md · https://learn.chatgpt.com/docs/whats-new.md (September 21–25, 2026)
- **Verificare adversarială:** CORRECTED (corectat: planRequired (https://learn.chatgpt.com/docs/changelog (intrarea din 2026-09-22) ; https://openai.com/index/introducing-gpt-6-sol-and-luna/), programmaticDetail (https://developers.openai.com/api/docs/models/gpt-6-sol.md ; https://learn.chatgpt.com/docs/whats-new.md (September 21–25) ; catalog inclus în binarul local)) — Postarea din 22.09.2026 (ro-RO) a fost citită: API-ul costă cu 50% mai puțin decât prețurile promoționale GPT-5.6 (Sol 4→2 $ / 20→10 $). Modelul e disponibil în Work și Codex pentru Plus, Pro, Business, Enterprise și Edu, dar nu în Chat. API: none…max, cutoff 20.04.2026, 2/0,20/10 $. Pe Bedrock Mantle: openai.gpt-6-sol (us-east-1). AutomationBench 33,2% la 0,27 $ confirmat.

### GPT-6 Luna (gpt-6-luna) (`oa-model-gpt-6-luna`)

- **Sursă oficială:** https://openai.com/index/introducing-gpt-6-sol-and-luna/
- **Documentație tehnică:** https://developers.openai.com/api/docs/models/gpt-6-luna ; https://learn.chatgpt.com/docs/models
- **Ce face:** Cel mai eficient model GPT-6 pentru sarcini focalizate și de volum mare: extragere, clasificare, transformare, rezumate structurate, coding focalizat. Reasoning none…max (fără Ultra în Codex); context 1,05M; knowledge cutoff 18.05.2026.
- **Plan necesar:** Toate planurile: Free și Go (doar în desktop app, Standard speed, sub rezervă de rollout), Plus, Pro, Business, Enterprise/Edu (Enterprise/Edu: admin trebuie să-l activeze).
- **Platformă:** ChatGPT desktop (Work/Codex), ChatGPT Work web, Codex CLI, IDE extension, API, Bedrock.
- **Rollout:** Disponibil din 22.09.2026.
- **Eligibilitate cont:** Probabil disponibil (inclus chiar și pe Free); neverificat în V2.
- **Autentificare:** ChatGPT sign-in în Codex.
- **Allowance:** Plus / Standard Business: aprox. 350–3.000 mesaje locale per 5 ore; credite 2,5 / 0,25 / 12,5 per 1M tokeni (de 20x mai ieftin decât Sol).
- **Utilizare partajată:** Alocare comună Codex + ChatGPT Work.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Minim; spill în credite doar după epuizarea alocării și doar dacă există sold. API: 0,10 $ / 0,01 $ / 0,50 $ per 1M.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Codex app-server cu model gpt-6-luna, effort low…max (Codex recomandă start la High); CLI: codex exec -m gpt-6-luna.
- **Suprafață nativă:** Presetarea Luna High în ChatGPT desktop; /model în CLI.
- **Cerințe locale:** Codex autentificat cu ChatGPT.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Triaj, rutare, clasificare de sarcini, rezumate de loguri, extragere de date și verificări rapide; rolul echivalent „haiku” din politica de modele.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** Claude Haiku 4.5.
- **Ce face unic / mai bine:** Cost foarte mic per sarcină; vendor raportează 66,6% pe DeepSWE 1.1 la effort max; poate înlocui Decisions API (API plătit) pentru clasificare în Hub.
- **Securitate:** Model mai mic: validare strictă a outputului structurat înainte de acțiuni cu efect.
- **Cale de implementare:** Router Hub: Luna low pentru edituri fine/extragere simplă, Luna xhigh pentru prioritizare cu constrângeri clare; output cu JSON schema validat local.
- **Test necesar:** model/list; turn live aprobat pe o sarcină de clasificare read-only.
- **Status:** DOCUMENTED
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Codex protocol conține și un parametru experimental supportsLunaReserve (fallback automat la Luna după blocarea uzajului obișnuit) — vezi oa-luna-reserve-fallback.
- **Surse citite:** https://openai.com/ro-RO/index/introducing-gpt-6-sol-and-luna/ · https://developers.openai.com/api/docs/models/gpt-6-luna.md · https://learn.chatgpt.com/docs/models.md · https://learn.chatgpt.com/docs/pricing.md
- **Verificare adversarială:** CONFIRMED — Confirmat din: postarea din 22.09 (Free/Go doar în desktop), pricing.md (Standard speed pe Free/Go; 350–3.000 pe 5 ore; credite 2,5/0,25/12,5), models.md (fără Ultra; start la High; Enterprise/Edu cer activare de admin), pagina API (none…max, cutoff 18.05.2026, 0,10/0,01/0,50 $) și DeepSWE 66,6% la max. Catalogul local are efortul implicit medium, deci Hub-ul trebuie să trimită explicit efortul dorit.

### GPT-5.6 Sol / Terra / Luna (modele disponibile în perioada de tranziție) (`oa-model-gpt-5-6-legacy`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/models
- **Documentație tehnică:** https://learn.chatgpt.com/docs/pricing#token-rates
- **Ce face:** Generația anterioară, încă disponibilă în Codex pe durata rollout-ului GPT-6. GPT-5.6 Luna este modelul implicit în ChatGPT (Chat) pe Free și Go. GPT-5.6 Sol este selectat implicit în ChatGPT for Word pe Plus și Pro.
- **Plan necesar:** Conform planului (Sol/Terra pe planuri plătite; Luna larg disponibil).
- **Platformă:** Codex, ChatGPT Chat, ChatGPT for Word/Excel/PowerPoint, API, Bedrock.
- **Rollout:** Rămân disponibile „în timpul rollout-ului”; prețul promoțional GPT-5.6 Sol valabil cel puțin până la 21.11.2026.
- **Eligibilitate cont:** Probabil disponibile; neverificat.
- **Autentificare:** ChatGPT sign-in.
- **Allowance:** Credite per 1M tokeni: 5.6 Sol 100/10/500, 5.6 Terra 50/5/300, 5.6 Luna 5/0,5/30 (mai scumpe decât echivalentele GPT-6).
- **Utilizare partajată:** Alocare comună Codex + ChatGPT Work + Word/Excel/PowerPoint.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Aceleași reguli de spill în credite; costă mai mult per token decât GPT-6.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** model/list + thread/start; nu trebuie folosite ca implicit.
- **Suprafață nativă:** Selectorul de modele ChatGPT/Codex.
- **Cerințe locale:** Codex autentificat.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Doar compatibilitate; routerul le evită în favoarea GPT-6.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** Generațiile Claude anterioare (de verificat în felia Anthropic).
- **Ce face unic / mai bine:** Site tools (WebMCP) documentate inițial pentru GPT-5.6 Sol/Terra.
- **Securitate:** Niciuna specifică.
- **Cale de implementare:** Router: prioritate scăzută; avertizare în UI dacă o misiune folosește GPT-5.6.
- **Test necesar:** Niciunul dedicat.
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Documentația API Ultrafast menționează încă acces preview Ultrafast pentru GPT-5.6 Sol (posibil text neactualizat).
- **Surse citite:** https://learn.chatgpt.com/docs/models.md · https://learn.chatgpt.com/docs/pricing.md · https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-personal-plans · https://chatgpt.com/ro-RO/pricing/ (text parțial)
- **Verificare adversarială:** CORRECTED (corectat: whatItDoes (https://learn.chatgpt.com/docs/whats-new.md (August 3–7, 2026) ; https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-personal-plans)) — Ratele de credite 5.6 Sol/Terra/Luna și promoția Sol valabilă cel puțin până la 21.11.2026 sunt confirmate. Ghidul API Ultrafast afirmă explicit preview pentru GPT-5.6 Sol, cu link către un anunț dedicat, deci nu pare text rămas neactualizat. Catalogul local conține gpt-5.6-sol/terra/luna.

### Retragerea GPT-5.5 (14.10.2026) și a modelelor Codex vechi (`oa-model-retirements`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/models#gpt-55-retirement
- **Documentație tehnică:** https://learn.chatgpt.com/docs/models#deprecated-codex-models
- **Ce face:** GPT-5.5 se retrage din ChatGPT, ChatGPT Work și Codex pe toate planurile la 14.10.2026 (API neafectat). Înlocuitori: gpt-6-sol (Plus+) sau gpt-6-luna (Free/Go). Deja retrase: gpt-5.4 și gpt-5.4-mini (31.08.2026), gpt-5.3-codex-spark (14.09.2026); gpt-5.2 și gpt-5.3-codex deprecate cu ChatGPT sign-in.
- **Plan necesar:** Toate planurile.
- **Platformă:** ChatGPT, ChatGPT Work, Codex.
- **Rollout:** Data fixă 14.10.2026.
- **Eligibilitate cont:** Se aplică și acestui cont.
- **Autentificare:** ChatGPT sign-in (API key neafectat).
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** model/list returnează upgrade, upgradeInfo {model, upgradeCopy, migrationMarkdown, retirementAt}; Hub-ul poate detecta programatic retragerile.
- **Suprafață nativă:** Avertizări în selectorul de modele.
- **Cerințe locale:** Niciuna.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Regulă de igienă în router și în configurațiile agenților/programărilor Hub.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** Politica de retragere a modelelor Claude (felia Anthropic).
- **Ce face unic / mai bine:** Metadate de migrare disponibile programatic.
- **Securitate:** Taskuri programate cu model retras pot eșua silențios.
- **Cale de implementare:** Denylist pentru gpt-5.5, gpt-5.4*, gpt-5.3-codex*, gpt-5.2; citirea upgradeInfo.retirementAt și avertizare cu 14 zile înainte.
- **Test necesar:** Test unitar al routerului cu un model/list simulat care conține retirementAt.
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Articolul Help Center încă recomanda (pentru 31.08) înlocuirea gpt-5.4 cu GPT-5.6 Terra, iar documentația Codex recomandă acum gpt-6-sol; se urmează documentația Codex mai nouă.
- **Surse citite:** https://learn.chatgpt.com/docs/models.md · https://learn.chatgpt.com/docs/whats-new.md · https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan · https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/model.rs
- **Verificare adversarială:** CONFIRMED — models.md și whats-new confirmă datele (5.5 la 14.10.2026; 5.4/5.4-mini la 31.08; Spark la 14.09) și înlocuitorii. Help 11369540 indică încă GPT-5.6 Terra pentru gpt-5.4. upgradeInfo include și modelLink. Catalogul local 0.158 încă listează gpt-5.4 (ascuns) și gpt-5.5, deci denylist-ul Hub este necesar.

### Daybreak Blue / Daybreak Red / GPT-5.6 Cyber și rerutarea cyber (`oa-model-daybreak-cyber`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/cyber-safety
- **Documentație tehnică:** https://learn.chatgpt.com/docs/pricing#token-rates ; https://developers.openai.com/api/docs/models
- **Ce face:** Aliasuri de modele pentru securitate defensivă (Daybreak Blue) și cercetare de vulnerabilități autorizată (Daybreak Red, GPT-5.6 Cyber). Accesul cere aprobare Trusted Access for Cyber; Codex Security Cloud oferă acces la Daybreak Blue fără aplicație separată. Backend-ul poate reruta turnuri cu activitate cyber de risc spre alt model.
- **Plan necesar:** Aprobare Trusted Access for Cyber; Daybreak Red cere aprobare și provizionare separate.
- **Platformă:** Codex, Codex Security, API.
- **Rollout:** Disponibil pentru organizații aprobate.
- **Eligibilitate cont:** Necunoscută; nicio aprobare cunoscută pentru acest cont.
- **Autentificare:** ChatGPT sign-in + program de acces.
- **Allowance:** Credite per 1M: Daybreak Blue 100/10/500 (rate GPT-5.6 Sol), Daybreak Red 312,5/31,25/1.875.
- **Utilizare partajată:** Alocare Codex comună.
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** Rate mari de credite pentru Red.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** model/list: availableAccessPrograms.cyber; notificări model/rerouted {fromModel, toModel, reason: HighRiskCyberActivity} și model/verification {TrustedAccessForCyber}.
- **Suprafață nativă:** Codex Security plugin/workbench.
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Doar audit: Hub-ul înregistrează orice rerutare cyber în jurnalul de misiune.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** Politicile Anthropic de utilizare cyber (felia Anthropic).
- **Ce face unic / mai bine:** Semnal explicit de rerutare expus în protocol.
- **Securitate:** Rerutarea schimbă modelul fără acțiunea Hub-ului; trebuie reflectată în audit.
- **Cale de implementare:** Handler pentru model/rerouted și model/verification în adaptorul app-server.
- **Test necesar:** Test simulat de protocol pentru model/rerouted.
- **Status:** ELIGIBILITY_UNKNOWN
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Detaliile Codex Security aparțin feliei de securitate.
- **Surse citite:** https://learn.chatgpt.com/docs/pricing.md · https://developers.openai.com/api/docs/models.md · https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/model.rs · scratchpad/sources-openai-devday.md (Codex Security Cloud)
- **Verificare adversarială:** CONFIRMED — Surse verificate: pricing.md (Blue 100/10/500, Red 312,5/31,25/1875; Red cere aprobare separată), cyber-safety.md (Trusted Access; safeguard-urile pot bloca, reruta sau limita), pagina API models (GPT-5.6 Cyber listat) și protocolul v2 (HighRiskCyberActivity, TrustedAccessForCyber, availableAccessPrograms.cyber). Catalogul local conține gpt-daybreak-blue-latest și gpt-daybreak-red-latest ca modele ascunse.

### Fast mode în Codex / ChatGPT Work (`oa-speed-fast-mode`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/agent-configuration/speed
- **Documentație tehnică:** https://learn.chatgpt.com/docs/config-file/config-reference (service_tier, features.fast_mode) ; https://developers.openai.com/api/docs/guides/fast-mode
- **Ce face:** Accelerează GPT-6.1 Sol, GPT-6 Astra, GPT-6 Sol și GPT-6 Luna (1,5x pentru GPT-5.6/5.5) în schimbul unui consum mai mare. Pe abonament consumă alocarea inclusă de 2,5x; pe credite cumpărate costă de 2x. În API, Fast mode este fostul priority processing.
- **Plan necesar:** Plus, Pro, Business, Enterprise (și API key) cu ChatGPT sign-in în desktop app, CLI, IDE.
- **Platformă:** ChatGPT desktop, Codex CLI, IDE extension. Indisponibil cu Amazon Bedrock și cu EU data residency (API).
- **Rollout:** GA.
- **Eligibilitate cont:** Codex local 0.158 raportează feature-ul fast_mode activ (codex features list); planul permite Fast.
- **Autentificare:** ChatGPT sign-in.
- **Allowance:** Multiplicator 2,5x pe alocarea inclusă; 2x pe credite / Enterprise pay-as-you-go.
- **Utilizare partajată:** Alocare comună Codex + ChatGPT Work.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Epuizează alocarea de 2,5x mai repede, ceea ce grăbește trecerea pe credite dacă există sold. În workspace-urile Business/Enterprise Fast este activ implicit.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** config.toml: service_tier = "fast" plus [features].fast_mode = true („fast” se mapează la valoarea de request „priority”). CLI: /fast și /statusline. requirements.toml: features.fast_mode fixează funcția pe on/off pentru utilizatori gestionați. App-server: thread/start.serviceTier, thread/settings/update.serviceTier (experimental; null șterge tier-ul), turn/start.serviceTierForTurn („default” înseamnă viteză standard); model/list expune serviceTiers și defaultServiceTier. În catalogul inclus în binarul local, tier-ul Fast are id „priority” (nume „Fast”). Șirurile serviceTierForTurn și serviceTiers există în binarul 0.158.0-alpha.2.1. Hub-ul trebuie să trateze atât „fast”, cât și „priority” ca non-standard.
- **Suprafață nativă:** Comutatorul de viteză din ChatGPT desktop (Advanced), /fast în CLI.
- **Cerințe locale:** Codex desktop/CLI; CODEX_HOME controlat de Hub.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Implicit OPRIT în Hub; opt-in per sarcină doar cu aprobare, pentru sarcini interactive urgente.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** Fast mode din Claude Code (de verificat în felia Anthropic).
- **Ce face unic / mai bine:** Viteză mai mare fără costuri API directe pe abonament.
- **Securitate:** Un defaultServiceTier din catalog sau o setare moștenită poate activa Fast fără intenția Hub-ului.
- **Cale de implementare:** Adaptorul Hub trimite explicit serviceTier: null la thread/start și serviceTierForTurn: default la turn/start, citește serviceTier din răspunsul thread/start și refuză turnul dacă nu este standard; în CODEX_HOME-ul Hub se setează features.fast_mode = false.
- **Test necesar:** Test simulat: răspuns thread/start cu serviceTier fast → Hub oprește turnul; verificare pe binarul local că parametrii există în schema 0.158.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** medium
- **Note:** Câmpurile serviceTierForTurn/serviceTiers au fost citite în sursa openai/codex main; prezența lor în 0.158.0-alpha.2.1 trebuie confirmată.
- **Surse citite:** https://learn.chatgpt.com/docs/agent-configuration/speed.md · https://learn.chatgpt.com/docs/pricing.md · https://learn.chatgpt.com/docs/llms-full.txt (config reference) · https://developers.openai.com/api/docs/guides/fast-mode.md · https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan · scratchpad/sources-openai-devday.md (codex features list: fast_mode=true)
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://learn.chatgpt.com/llms-full.txt (config reference: service_tier, features.fast_mode) ; https://learn.chatgpt.com/docs/agent-configuration/speed.md ; codex-rs/app-server-protocol v2 turn.rs și thread.rs ; grep read-only pe binarul local), confidence (https://learn.chatgpt.com/llms-full.txt (features.fast_mode este activ implicit, deci `codex features list` nu dovedește eligibilitatea contului))) — Multiplicatorii (2,5x alocare inclusă, 2x credite; 1,5x viteză pentru GPT-5.6/5.5), indisponibilitatea cu Bedrock și cu EU data residency (API) și redenumirea priority processing→Fast mode (30.07.2026) sunt confirmate. Help 11369540 confirmă că în workspace-uri Fast Mode este activat implicit ca setare de disponibilitate. Statusul AVAILABLE rămâne acceptabil (CLI local + plan Pro raportat în V1), dar planul nu este verificat în V2.

### GPT-6 Astra Ultrafast în Codex și ChatGPT Work (`oa-speed-ultrafast-codex`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/agent-configuration/speed#ultrafast-mode
- **Documentație tehnică:** https://learn.chatgpt.com/docs/pricing ; https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers
- **Ce face:** Nivel premium de viteză: GPT-6 Astra generează tokeni de până la 8x mai repede decât Astra Standard în Codex (aprox. 300 tok/s conform recapitulării). Doar GPT-6 Astra la lansare; suportul pentru GPT-6.1 Sol vine ulterior.
- **Plan necesar:** Pro 500 (500 $/lună) și planuri Enterprise/Edu eligibile (Enterprise: dezactivat implicit, activat de owner). Pro 100 și Pro 200 nu au acces nici cu credite cumpărate.
- **Platformă:** Codex și ChatGPT Work (model picker). Indisponibil pentru workspace-uri care cer inference residency în afara SUA.
- **Rollout:** Disponibil din 29.09.2026.
- **Eligibilitate cont:** Neeligibil dacă planul este prolite (probabil Pro 100); abonamentul Pro 500 nu este presupus.
- **Autentificare:** ChatGPT sign-in.
- **Allowance:** Consumă alocarea inclusă de 8x față de Standard; pe credite/Enterprise pay-as-you-go de 6x.
- **Utilizare partajată:** Alocare comună Codex + ChatGPT Work.
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Pe Pro 500 folosește întâi alocarea inclusă, apoi trage automat din soldul de credite. Accesul cere upgrade de plan (automatic_plan_upgrade: deny).
- **Risc de facturare API:** high
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Probabil expus ca service tier pentru gpt-6-astra în model/list.serviceTiers și selectabil prin thread/start.serviceTier; ID-ul tier-ului în Codex nu a fost verificat (în API este ultrafast) — nu se codează fix.
- **Suprafață nativă:** Model picker în ChatGPT Work / Codex desktop.
- **Cerințe locale:** Plan Pro 500.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Niciun rol implicit; Hub-ul blochează orice service tier Ultrafast.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** Niciun echivalent Anthropic verificat în această felie.
- **Ce face unic / mai bine:** Cea mai mare viteză de generare disponibilă pe abonament.
- **Securitate:** Risc de epuizare rapidă a alocării și de spill automat în credite.
- **Cale de implementare:** BillingPolicy: deny pentru orice serviceTier altul decât standard; afișare informativă dacă model/list îl anunță.
- **Test necesar:** Test de politică: turn cu serviceTier ultrafast → refuzat.
- **Status:** PLAN_RESTRICTED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Se reevaluează doar dacă proprietarul are deja Pro 500 și aprobă explicit consumul de 8x.
- **Surse citite:** https://learn.chatgpt.com/docs/agent-configuration/speed.md · https://learn.chatgpt.com/docs/pricing.md · https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers · https://learn.chatgpt.com/docs/whats-new/devday-2026.md · https://learn.chatgpt.com/docs/enterprise/usage-limits.md
- **Verificare adversarială:** CORRECTED (corectat: subscriptionIncluded (https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers ; https://learn.chatgpt.com/docs/agent-configuration/speed.md), apiBillingRisk (https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers (creditele pe Pro 100/200 nu deblochează Ultrafast; e nevoie de Pro 500))) — Au fost confirmate: 8x din alocare și 6x pe credite; accesul pe Pro 500 și pe Enterprise/Edu eligibile; lipsa accesului pe alte planuri self-serve chiar și cu credite; indisponibilitatea cu rezidență de inferență în afara SUA; Enterprise oprit implicit. Pentru contul probabil prolite, accesul cere un plan plătit nou, deci no/high este coerent cu PLAN_RESTRICTED și cu oa-plan-pro-500. Binarul local nu conține șirul „ultrafast”, deci tier-ul ar putea apărea doar din catalogul servit de backend.

### Ultrafast mode în OpenAI API (service_tier: ultrafast) (`oa-speed-ultrafast-api`)

- **Sursă oficială:** https://developers.openai.com/api/docs/guides/ultrafast-mode
- **Documentație tehnică:** https://developers.openai.com/api/docs/guides/ultrafast-mode ; https://developers.openai.com/api/docs/guides/websocket-mode
- **Ce face:** Cel mai rapid service tier din API: model gpt-6-astra + service_tier ultrafast în fiecare response.create; WebSocket recomandat pentru agenți cu multe apeluri de unelte; HTTP suportat.
- **Plan necesar:** Cont OpenAI API cu facturare (toți utilizatorii API, limite mici; limite mai mari prin account team).
- **Platformă:** Responses API (WebSocket/HTTP); doar US data residency și procesare globală.
- **Rollout:** GA pentru GPT-6 Astra cu rate limits mici; preview pentru GPT-5.6 Sol conform documentației.
- **Eligibilitate cont:** Neaplicabil: Hub-ul nu folosește API key.
- **Autentificare:** OPENAI_API_KEY.
- **Allowance:** TPM implicit: Tiers 1–3: 500.000; Tier 4: 1.000.000; Tier 5: 5.000.000.
- **Utilizare partajată:** Nu se partajează cu abonamentul ChatGPT.
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Facturare API cu preț premium (tabel Ultrafast separat).
- **Risc de facturare API:** high
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** POST /v1/responses sau ResponsesWS: {model: gpt-6-astra, service_tier: ultrafast, previous_response_id}.
- **Suprafață nativă:** Niciuna (API).
- **Cerințe locale:** API key — interzis de politica Hub.
- **Relevanță pentru Hub:** NONE
- **Rol propus:** Niciunul.
- **Suprafață de execuție:** openai.responses_api
- **Echivalent la celălalt ecosistem:** Anthropic Console API (de asemenea interzis).
- **Ce face unic / mai bine:** Latență minimă în API.
- **Securitate:** Necesită secret API.
- **Cale de implementare:** BillingPolicy paid_api_inference: deny.
- **Test necesar:** Testul existent de BillingPolicy care respinge rutele API.
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Documentația API menționează preview pentru GPT-5.6 Sol, în timp ce DevDay anunță GPT-6.1 Sol Ultrafast ca „în curând”.
- **Surse citite:** https://developers.openai.com/api/docs/guides/ultrafast-mode.md · https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra.md
- **Verificare adversarială:** CONFIRMED — Ghidul API confirmă: disponibil larg pentru gpt-6-astra (limite mici), preview pentru GPT-5.6 Sol, TPM 500K/1M/5M, doar rezidență SUA și procesare globală, WebSocket recomandat, service_tier ultrafast în response.create. BLOCKED/REJECT este coerent cu paid_api_inference: deny.

### Reasoning effort în Codex: Light→Extra High, Max și Ultra (subagenți) (`oa-reasoning-effort-max-ultra`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/models#pick-a-reasoning-effort
- **Documentație tehnică:** https://learn.chatgpt.com/docs/agent-configuration/subagents
- **Ce face:** Nivelurile de effort controlează profunzimea raționamentului: Light (low în CLI) pentru sarcini scurte, Medium pentru planificare moderată, High/Extra High pentru muncă dificilă, Max pentru o singură problemă foarte grea, Ultra folosește subagenți în paralel. Documentația spune că majoritatea sarcinilor nu au nevoie de Max sau Ultra.
- **Plan necesar:** Conform modelului și planului; Max/Ultra pot depinde de setări; Luna nu suportă Ultra.
- **Platformă:** ChatGPT desktop (setare „Ultra in model picker slider”), Codex CLI (/model → More reasoning…), app-server.
- **Rollout:** GA.
- **Eligibilitate cont:** Neverificată; supportedReasoningEfforts din model/list este sursa de adevăr.
- **Autentificare:** ChatGPT sign-in.
- **Allowance:** Efortul mai mare consumă mai mulți tokeni; Ultra multiplică munca prin subagenți.
- **Utilizare partajată:** Alocare comună.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Max/Ultra pot epuiza rapid alocarea și declanșa spill în credite.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Enum ReasoningEffort în protocol: none, minimal, low, medium, high, xhigh, max, ultra, persistent; turn/start.effort; multiAgentMode este deprecat — Ultra se cere prin effort: ultra.
- **Suprafață nativă:** Power slider Smarter/Faster; /model în CLI.
- **Cerințe locale:** Codex actualizat.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Parametru de router: low/medium implicit, high/xhigh pentru review și sarcini dificile, max/ultra doar cu aprobare și buget.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** claude --effort low\|medium\|high\|xhigh\|max; subagenți Claude Code.
- **Ce face unic / mai bine:** Ultra oferă paralelizare nativă cu subagenți fără orchestrare proprie.
- **Securitate:** Ultra creează subagenți; Hub-ul trebuie să păstreze aprobările și sandbox-ul pe toți.
- **Cale de implementare:** Tabel de mapare rol→effort în router; validare contra supportedReasoningEfforts.
- **Test necesar:** Test simulat: effort nesuportat → coborât la cel mai apropiat suportat.
- **Status:** DOCUMENTED
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Nivelurile de effort nu corespund exact între generații de modele.
- **Surse citite:** https://learn.chatgpt.com/docs/models.md · https://github.com/openai/codex/blob/main/codex-rs/protocol/src/openai_models.rs · https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/turn.rs
- **Verificare adversarială:** CONFIRMED — models.md confirmă Light/Medium/High/Extra High, Max, Ultra cu subagenți, lipsa Ultra la Luna, setarea „Ultra in model picker slider” și /model → More reasoning…. Protocolul confirmă ReasoningEffort (plus o variantă Custom) și faptul că multiAgentMode este ignorat în favoarea effort: ultra. Catalogul local declară pentru gpt-6-astra efortul implicit low și multi_agent_reasoning_effort xhigh.

### Ghid oficial de alegere model/effort (pentru routerul Hub) (`oa-model-selection-guidance`)

- **Sursă oficială:** https://developers.openai.com/api/docs/guides/model-selection
- **Documentație tehnică:** https://learn.chatgpt.com/docs/models#choosing-a-model
- **Ce face:** Scara oficială în 7 trepte: Luna·Low (edituri fine, extragere simplă); Luna·Extra high (context din mai multe aplicații, prioritizare cu constrângeri clare); GPT-6.1 Sol·Medium (muncă tehnică complexă care va fi revizuită); GPT-6.1 Sol·Extra high (livrabile finisate, decizii din dovezi contradictorii); Astra·Low (scriere concisă care păstrează faptele); Astra·Medium (proiecte ambițioase cu context larg); Astra·Extra high (analiză exigentă). Dacă costul/latența nu contează, Astra poate fi implicit; altfel se păstrează cea mai ușoară setare care atinge pragul de calitate.
- **Plan necesar:** n/a
- **Platformă:** Ghid general (API și Codex).
- **Rollout:** Pagina nu afișează o dată de publicare. Include GPT-6.1 Sol, deci a fost actualizată cel mai devreme la 29.09.2026.
- **Eligibilitate cont:** n/a
- **Autentificare:** n/a
- **Allowance:** Criterii: frecvența fluxului, urgența, utilizarea outputului, importanța calității.
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul.
- **Risc de facturare API:** none
- **Integrare programatică:** NONE
- **Detaliu integrare:** Ghid textual; Hub-ul îl codifică în politica routerului.
- **Suprafață nativă:** Documentație.
- **Cerințe locale:** Niciuna.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Bază pentru tabelul routerului Hub: triaj/loguri → gpt-6-luna low; cercetare/prioritizare → gpt-6-luna xhigh; Builder → gpt-6.1-sol medium; Reviewer/livrabil final → gpt-6.1-sol xhigh; arhitectură/securitate/depanare profundă → gpt-6-astra medium–xhigh cu aprobare; sarcini divizibile mari → ultra cu aprobare.
- **Suprafață de execuție:** hub.local
- **Echivalent la celălalt ecosistem:** Politica locală de modele Claude: haiku (triaj), sonnet (coding/review), opus (securitate/arhitectură), fable (investigații foarte grele).
- **Ce face unic / mai bine:** Ghid oficial cu perechi model+effort, nu doar model.
- **Securitate:** Niciuna.
- **Cale de implementare:** Politică de router versionată în Hub, cu teste pe exemple și cu raport de consum din account/rateLimits/read.
- **Test necesar:** Teste unitare ale routerului (fără modele).
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Codex recomandă start la High pentru Luna, Light pentru Astra și effort-ul implicit al clientului pentru GPT-6.1 Sol.
- **Surse citite:** https://developers.openai.com/api/docs/guides/model-selection.md · https://learn.chatgpt.com/docs/models.md · https://developers.openai.com/api/docs/models.md · https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra.md
- **Verificare adversarială:** CORRECTED (corectat: rollout (https://developers.openai.com/api/docs/guides/model-selection.md)) — Scara în 7 trepte, regula „Astra implicit dacă costul și latența nu contează” și criteriile de experiment sunt confirmate. Recomandările de start (High pentru Luna, Light pentru Astra, implicitul clientului pentru 6.1 Sol) sunt confirmate în models.md.

### Luna Reserve fallback (semnal experimental în protocolul Codex) (`oa-luna-reserve-fallback`)

- **Sursă oficială:** https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/account.rs
- **Documentație tehnică:** https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/account.rs
- **Ce face:** GetAccountRateLimitsParams.supportsLunaReserve anunță că clientul suportă un fallback automat Luna Reserve; pentru utilizatori ChatGPT CLI eligibili backend-ul poate înregistra expunerea la experiment după ce uzajul obișnuit este blocat. Probabil permite continuarea pe GPT-6 Luna când limitele modelului principal sunt atinse.
- **Plan necesar:** Necunoscut (experiment).
- **Platformă:** Codex CLI / app-server.
- **Rollout:** Experiment; nedocumentat pe learn.chatgpt.com.
- **Eligibilitate cont:** Necunoscută.
- **Autentificare:** ChatGPT.
- **Allowance:** Necunoscut.
- **Utilizare partajată:** Necunoscut.
- **Inclus în abonament?:** unknown
- **Risc de facturare suplimentară (credite/extra usage):** Necunoscut; schimbare silențioasă de model.
- **Risc de facturare API:** unknown
- **Integrare programatică:** UNKNOWN
- **Detaliu integrare:** Parametru opțional în account/rateLimits/read; Hub-ul nu îl setează.
- **Suprafață nativă:** Necunoscută.
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul până la documentare oficială; routerul Hub face fallback explicit, auditat.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** fallbackModel din Claude Code (în V2 --fallback-model este interzis).
- **Ce face unic / mai bine:** n/a
- **Securitate:** Schimbarea automată de model ar invalida auditul modelului folosit.
- **Cale de implementare:** Nu se trimite supportsLunaReserve; se compară modelul din răspunsuri cu cel cerut.
- **Test necesar:** Test de adaptor: parametrul nu este trimis niciodată.
- **Status:** ELIGIBILITY_UNKNOWN
- **Decizie Hub:** REJECT
- **Încredere:** low
- **Note:** Sursă: doar comentariu în codul open-source.
- **Surse citite:** https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server-protocol/src/protocol/v2/account.rs · https://learn.chatgpt.com/docs/llms-full.txt (căutare fără rezultate pentru reserve)
- **Verificare adversarială:** CONFIRMED — Comentariul din v2/account.rs este confirmat. Dovadă locală (grep read-only): binarul 0.158 conține headerul x-openai-codex-luna-reserve, promptul TUI „Continue with Luna Reserve” după mesajul că alocarea inclusă s-a epuizat și un eveniment UpdateLunaReserveReasoning. Pare o opțiune confirmată de utilizator după blocarea uzajului obișnuit; facturarea rămâne nedocumentată, deci REJECT este corect.

### Decisions API (Luna pentru decizii cu răspunsuri predefinite) (`oa-decisions-api`)

- **Sursă oficială:** https://openai.com/index/devday-2026-recap/#new-tools-for-developers-in-codex-api
- **Documentație tehnică:** Nicio documentație publică găsită în indexul developers.openai.com
- **Ce face:** Decizii în timp real: modelul Luna răspunde la întrebări definite de utilizator cu un set finit de răspunsuri (clasificare, rutare, alegerea următoarei acțiuni a unui agent), cu context text sau imagine.
- **Plan necesar:** Acces limitat în preview; rollout larg planificat.
- **Platformă:** OpenAI API.
- **Rollout:** Preview cu acces limitat de la 29.09.2026.
- **Eligibilitate cont:** Neaplicabil.
- **Autentificare:** API key.
- **Allowance:** Facturare API.
- **Utilizare partajată:** Separat de abonament.
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Facturare API.
- **Risc de facturare API:** high
- **Integrare programatică:** UNKNOWN
- **Detaliu integrare:** Nedocumentat public.
- **Suprafață nativă:** n/a
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul; routerul Hub folosește reguli locale sau GPT-6 Luna prin Codex pe abonament.
- **Suprafață de execuție:** openai.decisions_api
- **Echivalent la celălalt ecosistem:** Clasificare cu Claude Haiku prin Claude Code.
- **Ce face unic / mai bine:** Decizii constrânse la răspunsuri finite.
- **Securitate:** n/a
- **Cale de implementare:** REIMPLEMENT local: clasificator de rutare deterministic + Luna cu JSON schema.
- **Test necesar:** Niciunul.
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** medium
- **Surse citite:** scratchpad/sources-openai-devday.md (recap) · https://developers.openai.com/api/docs/llms.txt · https://developers.openai.com/api/llms-full.txt (căutare fără rezultat)
- **Verificare adversarială:** CONFIRMED — Recapitularea citită direct confirmă: preview cu acces limitat din 29.09 și rollout larg planificat în zilele următoare. Linkul „Află mai multe” din ediția ro-RO nu are destinație, iar llms-full.txt nu conține nimic despre Decisions API.

### Integritatea identității modelului în Codex: allowProviderModelFallback (experimental), modele ascunse (codex-auto-review) și verificarea modelului efectiv (`oa-gap-codex-model-integrity`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/app-server (model/list includeHidden; thread/start)
- **Documentație tehnică:** local: codex app-server generate-json-schema (0.159) ThreadStartResponse, ModelReroutedNotification, ModelVerificationNotification; codex debug models --bundled
- **Ce face:** thread/start.allowProviderModelFallback este un câmp experimental (listat printre câmpurile gated de experimentalApi) prezent în binarul 0.159.0, dar absent din documentație și din schema stabilă; semantica probabilă este înlocuirea unui model indisponibil cu modelul implicit al providerului, neconfirmată oficial. model/list întoarce implicit doar modelele vizibile; includeHidden:true arată și modele ascunse. Catalogul bundled conține codex-auto-review (visibility hide, model de revizuire automată a aprobărilor, supported_in_api true, tier priority cu consum crescut) și aliasurile ascunse gpt-daybreak-blue-latest și gpt-daybreak-red-latest. ThreadStartResponse întoarce model, modelProvider, serviceTier, reasoningEffort și approvalsReviewer efective. Schema 0.159 include notificările model/rerouted (motiv highRiskCyberActivity) și model/verification (trustedAccessForCyber). Codex folosește și modele interne configurabile: review_model, agents.default_subagent_model, memories.extract_model, memories.consolidation_model.
- **Plan necesar:** n/a (comportament de protocol)
- **Platformă:** Codex app-server local
- **Rollout:** allowProviderModelFallback: experimental, nedocumentat; codex-auto-review: ascuns, fără documentație de consum.
- **Eligibilitate cont:** Necunoscut; nu se testează fără LIVE_VALIDATION.
- **Autentificare:** ChatGPT OAuth
- **Allowance:** Modelul auto-review și modelele interne (memorii, subagenți, review) pot consuma din alocarea inclusă; impactul nu este documentat.
- **Utilizare partajată:** Alocarea comună Codex/Work.
- **Inclus în abonament?:** unknown
- **Risc de facturare suplimentară (credite/extra usage):** Consum ascuns prin modele auxiliare (auto-review, memorii, subagenți) care nu apar ca model principal al turei.
- **Risc de facturare API:** unknown
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Hub-ul nu trimite allowProviderModelFallback și nu activează capabilities.experimentalApi fără nevoie; trimite approvalsReviewer: "user" în thread/start; compară ThreadStartResponse.model și modelProvider cu cererea și oprește dacă diferă; înregistrează model/rerouted și model/verification; apelează model/list cu includeHidden:true doar pentru inventar și refuză rutarea către modele ascunse.
- **Suprafață nativă:** Selectorul de modele din desktop/CLI; /status.
- **Cerințe locale:** Schema protocolului generată pentru versiunea instalată (0.159.0 azi).
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Audit al routerului: modelul cerut trebuie să fie modelul efectiv; orice substituție sau rerutare devine eveniment de audit și oprește misiunile cu model obligatoriu.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** an-fallback-model-chain (--fallback-model, refuzat în V2) și an-classifier-fallback
- **Ce face unic / mai bine:** Răspunsul thread/start și notificările de rerutare permit verificarea explicită a modelului efectiv.
- **Securitate:** Substituția silențioasă ar invalida auditul și bugetarea; modelele ascunse pot avea politici și consum diferite; câmpurile experimentale se pot schimba între versiuni.
- **Cale de implementare:** 1) Validare strictă în adaptor: model efectiv = model cerut. 2) approvalsReviewer fixat pe user. 3) Denylist pentru modele cu visibility hide. 4) Test la fiecare actualizare a binarului (schema regenerată).
- **Test necesar:** Teste unitare pe răspunsuri simulate (model diferit, rerouted); LIVE_VALIDATION aprobat pentru confirmarea câmpurilor reale.
- **Status:** ELIGIBILITY_UNKNOWN
- **Decizie Hub:** REJECT
- **Încredere:** medium
- **Note:** oa-luna-reserve-fallback tratează alt semnal; oa-model-daybreak-cyber acoperă rerutarea cyber. Decizia REJECT privește allowProviderModelFallback și modelele ascunse; auditul modelului efectiv este implementat de Hub.
- **Surse citite:** https://learn.chatgpt.com/docs/app-server · https://learn.chatgpt.com/docs/sandboxing/auto-review.md · https://learn.chatgpt.com/docs/config-file/config-reference.md · local: șiruri din codex.exe 0.159.0 · local: codex debug models --bundled (offline) · local: scratchpad/codex-schema-0159
- **Verificare adversarială:** CONFIRMED — allowProviderModelFallback nu apare în documentație și nici în schema stabilă generată local, dar există ca șir în codex.exe 0.159.0; catalogul are codex-auto-review și aliasurile gpt-daybreak-blue-latest și gpt-daybreak-red-latest. model/list cu includeHidden și filtrul hidden este documentat. model/rerouted {threadId, turnId, fromModel, toModel, reason} și model/verification sunt documentate și pe pagina oficială app-server, nu doar în schema locală. ThreadStartResponse local conține model, modelProvider, serviceTier, reasoningEffort și approvalsReviewer (enum user \| auto_review \| guardian_subagent, implicit user). Cheile review_model, agents.default_subagent_model, memories.extract_model și memories.consolidation_model sunt în config reference. Decizia REJECT (pentru fallback și modelele ascunse) și statusul ELIGIBILITY_UNKNOWN rămân rezonabile.

### Furnizori locali open source în Codex (codex --oss, --local-provider lmstudio \| ollama, oss_provider) (`oa-gap-codex-oss-local-providers`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/developer-commands?surface=cli (--oss, --local-provider)
- **Documentație tehnică:** https://learn.chatgpt.com/docs/config-file/config-advanced (OSS mode) ; https://learn.chatgpt.com/docs/config-file/config-reference.md (oss_provider, model_provider)
- **Ce face:** Rulează harness-ul Codex cu un model local open source prin LM Studio sau Ollama: --oss folosește --local-provider, oss_provider din config sau cere alegerea interactiv; codex exec --oss iese cu eroare dacă niciunul nu este setat. ID-urile de provider openai, ollama și lmstudio sunt rezervate. Sandbox-ul și aprobările Codex rămân aceleași; căutarea web standalone pentru provideri custom este încă under development.
- **Plan necesar:** Niciun plan OpenAI necesar pentru inferența locală.
- **Platformă:** Windows, macOS, Linux; cere Ollama sau LM Studio și hardware suficient.
- **Rollout:** Documentat, GA în CLI.
- **Eligibilitate cont:** Ollama este instalat local (binar prezent); LM Studio nu a fost găsit; modelele locale nu au fost inventariate.
- **Autentificare:** Nu necesită abonament sau API key pentru modelul local. account/read raportează requiresOpenaiAuth în funcție de providerul activ; când valoarea este false, Codex poate rula fără acreditări OpenAI (documentat pe pagina app-server, netestat local cu Ollama).
- **Allowance:** Nu consumă alocarea ChatGPT.
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Doar resurse locale (CPU, GPU, RAM, energie). De verificat dacă Ollama expune și modele găzduite în cloud; Hub-ul trebuie să accepte doar modele locale.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** CLI: codex exec --oss --local-provider ollama -m <model>. App-server: thread/start cu modelProvider: "ollama" (câmp în schema 0.159; netestat) sau lansare cu -c model_provider="ollama" -c oss_provider="ollama".
- **Suprafață nativă:** Codex CLI interactiv cu --oss
- **Cerințe locale:** Ollama pornit local, modele descărcate, verificarea resurselor.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Rută opțională fără abonament și fără API plătit pentru sarcini simple (triaj, rezumate, clasificări), după LIVE_VALIDATION; sprijină principiul fără lock-in.
- **Suprafață de execuție:** openai.codex_cli
- **Echivalent la celălalt ecosistem:** an-third-party-providers (LLM gateway) — fără echivalent local direct în inventarul Anthropic.
- **Ce face unic / mai bine:** Același harness, sandbox și protocol app-server, cu model local.
- **Securitate:** Modelele locale pot fi mai vulnerabile la prompt injection și mai slabe la tool calling; descărcarea de modele este o instalare care cere aprobare; un model marcat cloud ar trimite date în afara mașinii.
- **Cale de implementare:** 1) Inventar read-only al modelelor locale (după aprobare). 2) Profil de rutare local cu allowlist de modele. 3) Evaluare de calitate pe sarcini Hub fără date sensibile. 4) Aceleași garduri de sandbox.
- **Test necesar:** LIVE_VALIDATION local aprobat (inferență locală) cu măsurarea resurselor și a calității.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** WRAP
- **Încredere:** medium
- **Note:** Inferența locală nu este interzisă de BillingPolicy, dar pornirea unui model rămâne blocată în BUILD_SAFE până la aprobarea proprietarului.
- **Surse citite:** https://learn.chatgpt.com/docs/llms-full.txt (--oss, OSS mode) · https://learn.chatgpt.com/docs/config-file/config-reference.md · https://learn.chatgpt.com/docs/web-search.md · local: codex --help (0.159.0) · local: %LOCALAPPDATA%\Programs\Ollama prezent
- **Verificare adversarială:** CORRECTED (corectat: authMethod (https://learn.chatgpt.com/docs/app-server.md (account/read field notes: requiresOpenaiAuth))) — Confirmat: --oss și --local-provider lmstudio \| ollama (documentate ca flaguri CLI), oss_provider în config reference, secțiunea OSS mode din config-advanced, ID-urile rezervate openai, ollama și lmstudio și ieșirea cu eroare a codex exec --oss când niciun provider nu e setat. Local există %LOCALAPPDATA%\Programs\Ollama; LM Studio nu a fost găsit în Program Files. Status NEEDS_SETUP și WRAP rămân valabile, iar pornirea inferenței locale rămâne blocată în BUILD_SAFE. Riscul modelelor Ollama găzduite în cloud rămâne de verificat.

### Modele Pro în Chat: GPT-6 Pro (pe GPT-6 Astra) și GPT-5.6 Sol Pro (`oa-gap-chatgpt-pro-models`)

- **Sursă oficială:** https://help.openai.com/en/articles/20001354-gpt-56-and-gpt-6-pro-in-chatgpt
- **Documentație tehnică:** https://chatgpt.com/pricing ; https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers
- **Ce face:** Opțiunea Pro din selectorul de gândire din Chat, pentru sarcini dificile și fluxuri lungi. GPT-6 Pro, bazat pe GPT-6 Astra, este disponibil pentru Pro $100, Pro $200, Business și Enterprise; GPT-5.6 Sol Pro este opțiunea Pro din familia GPT-5.6. Limite: GPT-6 Pro nu este nelimitat; pe Pro $100 ambele modele folosesc o singură alocare săptămânală; pe Pro $200, la atingerea limitei GPT-6 Pro, ChatGPT comută automat la GPT-5.6 Thinking Medium. Work și Codex au alocări separate, iar modelele Pro nu apar în catalogul Codex. Pagina de prețuri descrie planul Pro cu raționament Pro susținut de GPT-6 Astra.
- **Plan necesar:** GPT-6 Pro: Pro $100, Pro $200, Business, Enterprise. GPT-5.6 Sol Pro: Pro, Business, Enterprise (tabelul din help).
- **Platformă:** ChatGPT web, desktop, mobil (Chat)
- **Rollout:** GA pe planurile eligibile
- **Eligibilitate cont:** Depinde de nivelul real al planului (planType prolite neverificat în V2).
- **Autentificare:** Sesiunea ChatGPT
- **Allowance:** Alocări separate pentru modelele Pro; comutare automată la limită pe Pro $200.
- **Utilizare partajată:** Pe Pro $100, GPT-6 Pro și GPT-5.6 Sol Pro împart alocarea săptămânală; separat de Work și Codex.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Creditele nu oferă consum suplimentar pentru orice model; nu s-a documentat consum de credite pentru modelele Pro din Chat.
- **Risc de facturare API:** none
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Niciun API cu autentificare de abonament; modelele nu sunt disponibile prin app-server.
- **Suprafață nativă:** Selectorul Thinking din Chat (opțiunea Pro)
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Asistat: proprietarul folosește GPT-6 Pro pentru decizii de arhitectură sau securitate; Hub-ul pregătește pachetul de context și înregistrează manual răspunsul și modelul efectiv.
- **Suprafață de execuție:** openai.chatgpt_chat
- **Echivalent la celălalt ecosistem:** an-models-in-claude-apps (modele disponibile în aplicațiile Claude pe plan)
- **Ce face unic / mai bine:** Cel mai înalt nivel de raționament din Chat, inclus în abonament.
- **Securitate:** Comutarea automată pe Pro $200 schimbă modelul fără acțiune explicită; Hub-ul trebuie să înregistreze modelul raportat de UI.
- **Cale de implementare:** Șablon de export de context pentru Chat și formular de înregistrare a rezultatului în Hub.
- **Test necesar:** Niciunul pentru Hub.
- **Status:** ELIGIBILITY_UNKNOWN
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Contradicții: pagina de prețuri afișează GPT-5.6 Sol Pro și pentru Plus (Extins), iar help center spune că Plus nu include opțiunea Pro. Help center nu menționează explicit Pro 500 pentru GPT-6 Pro. openai.com/index/gpt-6-astra nu a fost citit (403).
- **Surse citite:** https://help.openai.com/en/articles/20001354-gpt-56-and-gpt-6-pro-in-chatgpt · https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers · https://chatgpt.com/pricing (ro-RO) · local: codex debug models --bundled (niciun model Pro în catalogul Codex)
- **Verificare adversarială:** CONFIRMED — Help 20001354, citit azi, confirmă: GPT-6 Pro (pe GPT-6 Astra) pentru Pro $100, Pro $200, Business și Enterprise; opțiunea Pro din GPT-5.6 inclusă pe Pro, Business și Enterprise, dar nu pe Plus. GPT-6 Pro nu e nelimitat; pe Pro $100 ambele modele folosesc o singură alocare săptămânală; pe Pro $200, la limita GPT-6 Pro, ChatGPT comută automat pe GPT-5.6 Thinking Medium. Work și Codex au alocări separate. Help 9793128 listează Pro 100, Pro 200 și Pro 500 și precizează că creditele nu adaugă consum pentru orice model. Pagina de prețuri (ro-RO) afișează raționament Pro susținut de GPT-6 Astra pe cardul Pro. Pro 500 nu apare explicit în articolul despre GPT-6 Pro.

### GPT-Rosalind (gpt-rosalind-research) — model pentru științele vieții, rezervat organizațiilor aprobate (`oa-gap-model-gpt-rosalind`)

- **Sursă oficială:** https://developers.openai.com/api/docs/models
- **Documentație tehnică:** https://learn.chatgpt.com/docs/pricing (tabelul de credite) ; https://developers.openai.com/blog/rosalind-workbench
- **Ce face:** Model dedicat științelor vieții (chimie medicinală, genomică, asistență pentru laborator), listat în API ca raționament pentru organizații aprobate. Tabelul de credite Codex listează GPT-Rosalind-Research la 125 / 12,5 / 625 credite per 1M tokeni (input / cached / output). Accesul trece prin verificare organizațională sau programe de acces de încredere; suprafețe menționate: ChatGPT (research preview), Rosalind Workbench, Codex.
- **Plan necesar:** Organizații aprobate; nu este inclus automat în planurile personale.
- **Platformă:** API, ChatGPT, Rosalind Workbench, Codex (după aprobare)
- **Rollout:** Acces restricționat
- **Eligibilitate cont:** Ifrim Digital nu este o organizație de științele vieții aprobată.
- **Autentificare:** Cont aprobat
- **Allowance:** Credite conform tabelului, după aprobare.
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Prețuri și eligibilitate nepublicate în afara tabelului de credite.
- **Risc de facturare API:** unknown
- **Integrare programatică:** NONE
- **Detaliu integrare:** Dacă ar apărea în model/list, routerul Hub trebuie să-l refuze.
- **Suprafață nativă:** Rosalind Workbench
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Intrare pe denylist-ul routerului; nicio utilizare.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** an-model-mythos-5-1 (model specializat, dacă este cazul) — fără echivalent direct confirmat.
- **Ce face unic / mai bine:** Specializare pe științele vieții, fără relevanță pentru agenție.
- **Securitate:** Model cu acces de încredere; utilizarea în afara scopului aprobat încalcă condițiile.
- **Cale de implementare:** Denylist în catalogul de modele al routerului.
- **Test necesar:** Niciunul
- **Status:** PLAN_RESTRICTED
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** medium
- **Note:** Pagina de model din API pentru Rosalind nu a putut fi găsită în format .md (404); informațiile provin din catalog, pricing și blog.
- **Surse citite:** https://developers.openai.com/api/docs/models · https://learn.chatgpt.com/docs/pricing.md · https://developers.openai.com/blog/rosalind-workbench
- **Verificare adversarială:** CONFIRMED — Indexul developers.openai.com/api/docs/models listează GPT-Rosalind (gpt-rosalind-research) pentru organizații aprobate, cu link spre pricing#specialized-models, nu spre o pagină proprie. Tabelul de credite din pricing: 125 / 12,5 / 625. Blogul Rosalind Workbench confirmă research preview prin aplicația ChatGPT, modul Research pentru membrii organizațiilor verificate (acces individual anunțat ca urmând) și cereri de acces de încredere. PLAN_RESTRICTED, NOT_APPLICABLE și intrarea pe denylist sunt coerente.

## plans

### Planurile ChatGPT Free (0 $) și Go (8 $/lună) (`oa-plan-free-go`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/pricing
- **Documentație tehnică:** https://chatgpt.com/pricing
- **Ce face:** Free: Codex limitat, GPT-6 Luna la Standard speed în desktop app (sub rezervă de rollout), Chat nelimitat cu GPT-5.6 Luna sub protecții anti-abuz. Go: la fel pentru Codex, pentru sarcini de coding ușoare, plus mai multe mesaje/încărcări; poate include reclame. Fără Codex Cloud.
- **Plan necesar:** Free / Go.
- **Platformă:** ChatGPT (web, mobil, desktop).
- **Rollout:** GA; cumpărarea de credite doar pentru un grup limitat de utilizatori Free/Go.
- **Eligibilitate cont:** Neaplicabil: contul proprietarului este pe un plan Pro (V1: prolite).
- **Autentificare:** ChatGPT.
- **Allowance:** Limitată; fără estimări publicate pentru Codex.
- **Utilizare partajată:** Alocare comună Codex + Work.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Credite doar pentru grup limitat.
- **Risc de facturare API:** none
- **Integrare programatică:** NONE
- **Detaliu integrare:** planType free/go în account/read.
- **Suprafață nativă:** chatgpt.com/pricing.
- **Cerințe locale:** Niciuna.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Doar referință.
- **Suprafață de execuție:** openai.account_billing
- **Echivalent la celălalt ecosistem:** Claude Free.
- **Ce face unic / mai bine:** n/a
- **Securitate:** n/a
- **Cale de implementare:** Niciuna.
- **Test necesar:** Niciunul.
- **Status:** NOT_APPLICABLE
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** high
- **Note:** Prețul Go (8 $) provine din learn.chatgpt.com/docs/pricing; pagina chatgpt.com/pricing nu a afișat prețurile în textul citit.
- **Surse citite:** https://learn.chatgpt.com/docs/pricing.md · https://chatgpt.com/ro-RO/pricing/ (text, fără prețuri randate) · https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan · https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-personal-plans
- **Verificare adversarială:** CONFIRMED — chatgpt.com/ro-RO/pricing a fost citit. Free: 0 RON, conversații text nelimitate cu GPT-5.6 Luna sub protecții anti-abuz, Codex limitat. Go: 29,99 RON/lună, planul poate include reclame. learn pricing: Go costă 8 $, iar Luna rulează la Standard speed în desktop. Help 11369540: Codex Cloud nu este inclus pe Free/Go. Help 12642688: creditele se pot cumpăra doar de un grup limitat de utilizatori.

### ChatGPT Plus (20 $/lună) (`oa-plan-plus`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/pricing
- **Documentație tehnică:** https://learn.chatgpt.com/docs/pricing#what-are-the-usage-limits-for-my-plan
- **Ce face:** Codex pe web, CLI, IDE și iOS, integrări cloud (automatic code review, Slack), GPT-6 Sol/Luna (și Astra/6.1 Sol conform paginilor de modele), extensie cu credite; ChatGPT Work pe desktop, web, mobil.
- **Plan necesar:** Plus.
- **Platformă:** ChatGPT + Codex.
- **Rollout:** GA.
- **Eligibilitate cont:** Nu este planul proprietarului (V1: prolite).
- **Autentificare:** ChatGPT.
- **Allowance:** Mesaje locale per 5 ore: Astra 5–45, GPT-6.1 Sol 15–160, GPT-6 Sol 15–150, Luna 350–3.000; se pot aplica și limite săptămânale.
- **Utilizare partajată:** Codex + ChatGPT Work + Excel/Word/PowerPoint.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Credite cumpărabile după epuizare; automatic reload opțional.
- **Risc de facturare API:** low
- **Integrare programatică:** NONE
- **Detaliu integrare:** planType plus în account/read.
- **Suprafață nativă:** chatgpt.com/pricing, Settings → My Plan.
- **Cerințe locale:** Niciuna.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință pentru bugetarea alocării.
- **Suprafață de execuție:** openai.account_billing
- **Echivalent la celălalt ecosistem:** Claude Pro.
- **Ce face unic / mai bine:** n/a
- **Securitate:** n/a
- **Cale de implementare:** Niciuna.
- **Test necesar:** Niciunul.
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Estimările nu sunt limite fixe; sursa de adevăr este usage dashboard / account/rateLimits/read.
- **Surse citite:** https://learn.chatgpt.com/docs/pricing.md · https://chatgpt.com/ro-RO/pricing/
- **Verificare adversarială:** CONFIRMED — pricing.md confirmă: 20 $/lună, Codex pe web/CLI/IDE/iOS, integrări cloud, GPT-6 Sol și Luna, credite, estimări pe 5 ore și limite săptămânale posibile. Pe pagina ro-RO prețul este 99,99 RON/lună, iar tabelul arată acces limitat la GPT-6.1 Sol și Astra.

### ChatGPT Pro: Pro 100, Pro 200, Pro 500 (`oa-plan-pro-tiers`)

- **Sursă oficială:** https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers
- **Documentație tehnică:** https://learn.chatgpt.com/docs/pricing
- **Ce face:** Trei abonamente lunare: Pro 100 (100 $), Pro 200 (200 $), Pro 500 (500 $, singurul cu Astra Ultrafast și cea mai mare alocare). Includ modele Pro, Codex (inclusiv Codex Cloud pe toate nivelurile), deep research, ChatGPT Work, un dot (agent mereu activ). Pro 200 este din nou disponibil, dar abonamentele noi negrandfathered au alocare mai mică; abonații eligibili păstrează alocarea veche până la 29.10.2026.
- **Plan necesar:** Pro 100 / Pro 200 / Pro 500; facturare doar lunară.
- **Platformă:** ChatGPT web/desktop/mobil, Codex.
- **Rollout:** Pro 500 lansat la DevDay (29.09.2026). Dots pentru Pro: doar utilizatori peste 18 ani din afara SEE, Regatului Unit și Elveției.
- **Eligibilitate cont:** V1 a raportat planType prolite (vezi oa-codex-plan-type-prolite): cel mai probabil Pro 100. Neverificat în V2.
- **Autentificare:** ChatGPT.
- **Allowance:** Pro: în prezent fără limită de 5 ore în Codex; limite săptămânale posibile; Pro 200 > Pro 100; Pro 500 cea mai mare. Valori numerice nepublicate.
- **Utilizare partajată:** Codex, ChatGPT Work, Word, Excel, PowerPoint partajează alocarea agentică și creditele.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Credite cumpărate după alocare (inclusiv automatic reload, dacă e activat); schimbarea de plan din Settings → My Plan este interzisă Hub-ului.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** account/read → account.planType (prolite / pro / promax); account/rateLimits/read → rateLimits.planType pe bucket.
- **Suprafață nativă:** Settings → My Plan; Settings → Usage.
- **Cerințe locale:** Niciuna.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Hub-ul oglindește planul și limitele (read-only) pentru a bugeta misiunile; nu schimbă planul.
- **Suprafață de execuție:** openai.account_billing
- **Echivalent la celălalt ecosistem:** Claude Max (verificat local: subscriptionType max).
- **Ce face unic / mai bine:** Fără limită de 5 ore pentru Codex pe Pro.
- **Securitate:** Termenii Pro interzic partajarea credențialelor, revânzarea accesului și extragerea automată de date; Hub-ul nu trebuie să partajeze autentificarea Codex între utilizatori sau mașini.
- **Cale de implementare:** Mirror al planType la pornire și la account/updated; afișare nume uman corect (Pro 100/200/500) doar după confirmarea mapării.
- **Test necesar:** account/read read-only pe CODEX_HOME real.
- **Status:** DOCUMENTED
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** high
- **Note:** Dacă proprietarul se află în România (SEE), dots nu sunt disponibile pe Pro conform secțiunii Access din documentația dots.
- **Surse citite:** https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers (citit în browserul integrat) · https://learn.chatgpt.com/docs/pricing.md · https://chatgpt.com/ro-RO/pricing/ · https://learn.chatgpt.com/docs/llms-full.txt (secțiunea dots Access) · https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
- **Verificare adversarială:** CONFIRMED — Articolul 9793128 a fost citit. Confirmă: 100/200/500 $ lunar; Ultrafast doar pe Pro 500; Pro 200 reluat, cu alocare mai mică pentru abonările noi; alocarea veche păstrată până la 29.10.2026 pentru eligibili; facturare doar lunară; credite pentru Codex/Work/Word/Excel/PowerPoint; Support nu resetează limitele; sunt interzise partajarea credențialelor, revânzarea și extragerea automată. Codex Cloud e pe toate nivelurile Pro (help 11369540). Dots pe Pro doar pentru utilizatori peste 18 ani, în afara SEE/UK/CH (dots#access). Pe ro-RO, Pro pornește de la 520 RON/lună.

### Pro 500 (500 $/lună) — nivel nou cu Astra Ultrafast (`oa-plan-pro-500`)

- **Sursă oficială:** https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers
- **Documentație tehnică:** https://learn.chatgpt.com/docs/agent-configuration/speed#ultrafast-mode
- **Ce face:** Cel mai scump nivel Pro: cea mai mare alocare inclusă, acces exclusiv la Astra Ultrafast în ChatGPT Work și Codex; conform recapitulării, și computer use din Agents API în Codex/ChatGPT Work.
- **Plan necesar:** Pro 500.
- **Platformă:** ChatGPT, Codex.
- **Rollout:** Disponibil din 29.09.2026.
- **Eligibilitate cont:** Neeligibil dacă planul este prolite; abonarea ar însemna upgrade plătit.
- **Autentificare:** ChatGPT.
- **Allowance:** Cea mai mare dintre planurile Pro; valoare numerică nepublicată.
- **Utilizare partajată:** Alocare agentică comună.
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Cost suplimentar de abonament (upgrade) și Ultrafast care trece pe credite după alocare.
- **Risc de facturare API:** high
- **Integrare programatică:** NONE
- **Detaliu integrare:** Detectabil ca planType (probabil promax) în account/read.
- **Suprafață nativă:** Settings → My Plan.
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul; decizie exclusivă a proprietarului.
- **Suprafață de execuție:** openai.account_billing
- **Echivalent la celălalt ecosistem:** Nivelurile Claude Max superioare (felia Anthropic).
- **Ce face unic / mai bine:** Ultrafast.
- **Securitate:** n/a
- **Cale de implementare:** BillingPolicy automatic_plan_upgrade: deny; Hub-ul nu sugerează upgrade automat.
- **Test necesar:** Test de politică existent.
- **Status:** PLAN_RESTRICTED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** V2 billing.mjs nu include promax în allowlist: dacă proprietarul ar trece pe Pro 500, Hub-ul ar refuza contul până la actualizarea politicii.
- **Surse citite:** https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers · https://learn.chatgpt.com/docs/agent-configuration/speed.md · scratchpad/sources-openai-devday.md (recap: New Pro tier; Computer use in Agents API)
- **Verificare adversarială:** CONFIRMED — Recapitularea DevDay (Un nou nivel Pro; computer use în Agents API pentru abonații Pro de 500 $) și articolul Pro tiers confirmă. Observația e validă: billing.mjs nu include promax în SUBSCRIPTION_PLANS.codex, deci planul ar ieși „unverified” și ar bloca ruta.

### Semnificația Codex account planType „prolite” (`oa-codex-plan-type-prolite`)

- **Sursă oficială:** https://github.com/openai/codex/blob/main/codex-rs/protocol/src/account.rs
- **Documentație tehnică:** https://github.com/openai/codex/blob/main/codex-rs/protocol/src/auth.rs
- **Ce face:** Enum-ul PlanType din Codex conține: free, go, plus, pro, prolite, promax, team, self_serve_business_prolite, self_serve_business_usage_based, business, ent26, enterprise_cbp_automation, enterprise_cbp_usage_based, enterprise, edu, edu_plus, edu_pro, unknown. Commit-ul „Add Pro Max plan support and update Pro display names” (#47971, 25.09.2026) afișează prolite ca „Pro”, pro ca „Pro (More)” și promax ca „Pro (Max)”. Inferență (nedocumentată oficial): prolite ≈ Pro 100, pro ≈ Pro 200, promax ≈ Pro 500.
- **Plan necesar:** n/a
- **Platformă:** Codex CLI / app-server / TUI.
- **Rollout:** promax adăugat la 25.09.2026; Codex 0.158.0-alpha.2.1 local ar putea să nu îl cunoască (se mapează la unknown).
- **Eligibilitate cont:** V1 (28.09.2026, verificat de proprietar și reviewer) a raportat planType prolite; neverificat în V2.
- **Autentificare:** Derivat din claims-urile tokenului ChatGPT sau din backend.
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Tipurile *_usage_based și enterprise_cbp_* indică facturare după consum/credite.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** account/read → {type: chatgpt, email, planType}; account/updated {authMode, planType}; rateLimits.planType; tipul contului amazonBedrock sau apiKey pentru alte rute.
- **Suprafață nativă:** /status în CLI afișează numele planului.
- **Cerințe locale:** Codex autentificat.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Intrare pentru BillingPolicy: allowlist explicit de planuri de abonament; unknown → deny.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** claude auth status → subscriptionType (max).
- **Ce face unic / mai bine:** Plan citibil programatic fără inferență.
- **Securitate:** Nu se înregistrează email/account id în loguri.
- **Cale de implementare:** Actualizare billing.mjs: adaugă promax (abonament); păstrează excluse self_serve_business_usage_based și enterprise_cbp_usage_based; reevaluează enterprise_cbp_automation (credit-based) — acum este permis în allowlist; mapare nume uman doar ca etichetă „probabil”.
- **Test necesar:** Teste unitare BillingPolicy pentru fiecare valoare din enum; account/read read-only pe cont real.
- **Status:** DOCUMENTED
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** medium
- **Note:** Maparea prolite→Pro 100 este o inferență din numele afișate și din articolul Pro tiers; nu există pagină oficială care să lege ID-urile de prețuri.
- **Surse citite:** https://raw.githubusercontent.com/openai/codex/main/codex-rs/protocol/src/account.rs · https://raw.githubusercontent.com/openai/codex/main/codex-rs/protocol/src/auth.rs · https://api.github.com/repos/openai/codex/commits?path=codex-rs/protocol/src/account.rs (commit #47971, 25.09.2026) · https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers · v2/server/policy/billing.mjs (grep) · .ifrim/NEXT_SESSION.md (linia 166, grep)
- **Verificare adversarială:** CONFIRMED — account.rs și auth.rs (main) sunt confirmate, la fel commitul #47971 din 25.09.2026 (prolite→„Pro”, pro→„Pro (More)”, promax→„Pro (Max)”). Dovadă locală suplimentară: binarul 0.158.0-alpha.2.1 conține încă eticheta TUI „Pro Lite”, ceea ce susține că prolite este cel mai mic nivel Pro. Șirul „promax” apare în binar doar în listele available_in_plans din catalog, deci nu dovedește că enum-ul PlanType local îl recunoaște. Maparea prolite→Pro 100 rămâne inferență.

### ChatGPT Business (20 $/utilizator/lună anual, 25 $ lunar, minim 2 utilizatori) (`oa-plan-business`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/pricing
- **Documentație tehnică:** https://help.openai.com/en/articles/20001155-managing-credits-and-spend-controls-in-chatgpt-business
- **Ce face:** Workspace dedicat cu SAML SSO, MFA, VM-uri cloud mai mari, credite flexibile de workspace, fără antrenare pe date implicit; singurul nivel (alături de Enterprise) cu Codex access tokens pentru automatizare de încredere.
- **Plan necesar:** Business.
- **Platformă:** ChatGPT + Codex.
- **Rollout:** GA.
- **Eligibilitate cont:** Neaplicabil (cont individual).
- **Autentificare:** ChatGPT workspace; access tokens pentru automatizare.
- **Allowance:** Standard Business: aceleași estimări per 5 ore ca Plus.
- **Utilizare partajată:** Credite de workspace comune.
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** Credite de workspace cumpărate; controale de cheltuieli la nivel de workspace.
- **Risc de facturare API:** low
- **Integrare programatică:** NONE
- **Detaliu integrare:** Codex access tokens (Business/Enterprise) — indisponibile pe Plus/Pro.
- **Suprafață nativă:** Workspace settings.
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul acum; relevant doar dacă Ifrim Digital trece pe un workspace de echipă.
- **Suprafață de execuție:** openai.account_billing
- **Echivalent la celălalt ecosistem:** Claude Team.
- **Ce face unic / mai bine:** Access tokens pentru automatizare fără sesiune interactivă.
- **Securitate:** n/a
- **Cale de implementare:** Niciuna.
- **Test necesar:** Niciunul.
- **Status:** PLAN_RESTRICTED
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** high
- **Note:** Articolul Help 20001155 nu a fost citit.
- **Surse citite:** https://learn.chatgpt.com/docs/pricing.md · https://learn.chatgpt.com/docs/enterprise/usage-limits.md
- **Verificare adversarială:** CONFIRMED — pricing.md confirmă: 20 $/utilizator/lună cu plată anuală, 25 $ lunar, minim 2 utilizatori, VM-uri mai mari, SAML SSO/MFA, credite. Matricea de funcții confirmă că Codex access tokens există doar pe Business și Enterprise. Help 20001155 nu a fost citit.

### ChatGPT Business Premium (`oa-plan-business-premium`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/dots#access
- **Documentație tehnică:** https://openai.com/index/introducing-dots/
- **Ce face:** Nivel de business menționat ca eligibil pentru dots (primul dot inclus fără cost suplimentar); nu am găsit pagină cu preț sau conținut complet.
- **Plan necesar:** Business Premium.
- **Platformă:** ChatGPT.
- **Rollout:** Dots pe Business Premium: rollout mondial.
- **Eligibilitate cont:** Neaplicabil.
- **Autentificare:** ChatGPT workspace.
- **Allowance:** Necunoscută.
- **Utilizare partajată:** Necunoscută.
- **Inclus în abonament?:** unknown
- **Risc de facturare suplimentară (credite/extra usage):** Necunoscut.
- **Risc de facturare API:** unknown
- **Integrare programatică:** NONE
- **Detaliu integrare:** n/a
- **Suprafață nativă:** n/a
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** NONE
- **Rol propus:** Niciunul.
- **Suprafață de execuție:** openai.account_billing
- **Echivalent la celălalt ecosistem:** n/a
- **Ce face unic / mai bine:** n/a
- **Securitate:** n/a
- **Cale de implementare:** Niciuna.
- **Test necesar:** Niciunul.
- **Status:** DOCUMENTED
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** low
- **Note:** Nu se inventează preț; pagina de prețuri nu a expus nivelul în textul citit.
- **Surse citite:** https://learn.chatgpt.com/docs/llms-full.txt (dots Access) · scratchpad/sources-openai-devday.md (introducing-dots)
- **Verificare adversarială:** CONFIRMED — Existența nivelului e confirmată doar în dots#access (rollout mondial) și în postarea despre dots. Fila Business a paginii de prețuri nu a putut fi citită (panoul browserului nu a randat), deci prețul rămâne necunoscut; confidence low este justificat.

### ChatGPT Enterprise / Edu (preț personalizat) (`oa-plan-enterprise-edu`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/pricing
- **Documentație tehnică:** https://learn.chatgpt.com/docs/enterprise/usage-limits
- **Ce face:** Priority request processing, SCIM, EKM, RBAC, Compliance API, retenție și rezidență; prețuri flexibile pe credite sau acorduri token-based în USD; per-user spend controls; Ultrafast opțional (oprit implicit).
- **Plan necesar:** Enterprise / Edu.
- **Platformă:** ChatGPT + Codex.
- **Rollout:** GA.
- **Eligibilitate cont:** Neaplicabil.
- **Autentificare:** SSO workspace.
- **Allowance:** Fără limite fixe pe flexible pricing; fără flexible pricing, limite per loc similare cu Plus.
- **Utilizare partajată:** Workspace.
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** Facturare după consum în USD sau credite.
- **Risc de facturare API:** high
- **Integrare programatică:** NONE
- **Detaliu integrare:** Analytics API, Compliance API (în afara scopului).
- **Suprafață nativă:** Admin console.
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** NONE
- **Rol propus:** Niciunul.
- **Suprafață de execuție:** openai.account_billing
- **Echivalent la celălalt ecosistem:** Claude Enterprise.
- **Ce face unic / mai bine:** n/a
- **Securitate:** n/a
- **Cale de implementare:** Niciuna.
- **Test necesar:** Niciunul.
- **Status:** PLAN_RESTRICTED
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** high
- **Surse citite:** https://learn.chatgpt.com/docs/pricing.md · https://learn.chatgpt.com/docs/enterprise/usage-limits.md · https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
- **Verificare adversarială:** CONFIRMED — pricing.md confirmă: priority request processing, SCIM, EKM, RBAC, Compliance API, retenție și rezidență; cu flexible pricing nu există limite fixe; fără flexible pricing, limitele per loc sunt ca la Plus; există rate card-uri pe credite și în USD. speed.md: Ultrafast e oprit implicit și se aplică per-user spend controls.

### Limitele de utilizare Codex / ChatGPT Work (alocare comună, ferestre de 5 ore și săptămânale) (`oa-codex-work-usage-limits`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/pricing#what-are-the-usage-limits-for-my-plan
- **Documentație tehnică:** https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
- **Ce face:** Codex și ChatGPT Work folosesc aceeași tarifare, aceleași credite și aceleași limite; mesajele locale și chat-urile cloud împart alocarea; sarcinile cloud consumă mai mult. Dacă limita e atinsă în timpul unui turn activ, agentul poate termina turnul, sub rezerva fair use. Generarea de imagini consumă de 3–5x mai repede; Voice în desktop costă 0,05 $/minut din bugetul Codex; code review prin GitHub are contorizare proprie. Conversațiile cu un dot nu se contorizează, dar sarcinile pornite de dot în Work/Codex da.
- **Plan necesar:** Toate planurile ChatGPT (valori diferite).
- **Platformă:** Codex (desktop, CLI, IDE, cloud), ChatGPT Work, ChatGPT for Excel/Word/PowerPoint, Workspace Agents.
- **Rollout:** GA.
- **Eligibilitate cont:** Se aplică contului; valorile curente se văd în usage dashboard sau prin app-server.
- **Autentificare:** ChatGPT.
- **Allowance:** Plus/Standard Business per 5 ore: Astra 5–45, 6.1 Sol 15–160, 6 Sol 15–150, Luna 350–3.000; Pro: fără limită de 5 ore; limite săptămânale posibile.
- **Utilizare partajată:** Pool agentic comun: Codex, Work, Excel, Word, PowerPoint, Workspace Agents, Voice-task.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** După epuizare: credite (automat, dacă există sold), reset disponibil, upgrade sau așteptare. Nicio resetare de la Support.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** account/rateLimits/read, account/rateLimits/updated; /status în CLI; dashboard chatgpt.com/codex/settings/usage.
- **Suprafață nativă:** Settings → Usage (ChatGPT), Usage & Billing (Codex app), /status.
- **Cerințe locale:** Codex autentificat.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Buget de misiune: Hub-ul estimează și rezervă alocare înainte de a porni sarcini lungi.
- **Suprafață de execuție:** openai.account_billing
- **Echivalent la celălalt ecosistem:** Limitele de sesiune/săptămânale Claude Max (felia Anthropic).
- **Ce face unic / mai bine:** Telemetrie oficială per bucket, cu procent folosit și timp de resetare.
- **Securitate:** Utilizarea manuală a proprietarului în ChatGPT Work consumă din același pool ca Hub-ul.
- **Cale de implementare:** Gate pre-turn: refuză pornirea dacă usedPercent ≥ prag configurabil (ex. 85%) pe orice fereastră sau rateLimitReachedType ≠ null.
- **Test necesar:** Test simulat cu răspunsuri rateLimits la 50%, 90%, 100%.
- **Status:** DOCUMENTED
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** high
- **Note:** Estimările nu sunt limite fixe; OpenAI recomandă verificarea dashboardului la una-două săptămâni.
- **Surse citite:** https://learn.chatgpt.com/docs/pricing.md · https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan · https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-personal-plans · https://learn.chatgpt.com/docs/llms-full.txt (dots Access)
- **Verificare adversarială:** CONFIRMED — pricing.md și help 11369540 confirmă: pool comun (inclusiv Workspace Agents), estimările, continuarea turnului sub fair use, Voice la 0,05 $/minut, contorizare doar pentru code review prin GitHub, imaginile consumă de 3–5x mai repede, iar Support nu resetează limitele. dots#access confirmă regula pentru conversațiile cu dot-ul.

### Telemetrie de plan și consum prin Codex app-server (account/*) (`oa-usage-telemetry-app-server`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/app-server
- **Documentație tehnică:** https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/account.rs
- **Ce face:** account/rateLimits/read întoarce: ordinaryUsageAllowed, rateLimits (limitId, primary/secondary {usedPercent, windowDurationMins, resetsAt}, credits {hasCredits, unlimited, balance}, individualLimit, spendControlReached, planType, rateLimitReachedType), rateLimitsByLimitId, rateLimitResetCredits, rateLimitUpsell. account/usage/read întoarce sumar de tokeni, bucket-uri zilnice și, cu threadId, costul estimat al thread-ului (estimatedUsageCreditsMicros, pe model/effort/speed).
- **Plan necesar:** Autentificare ChatGPT (API key și Bedrock nu suportă account/usage/read).
- **Platformă:** Codex app-server (stdio JSON-RPC sau WebSocket local).
- **Rollout:** Metodele există în sursa main; comanda app-server este marcată experimental; unele câmpuri pot lipsi în 0.158.0-alpha.2.1.
- **Eligibilitate cont:** Adaptorul V2 are deja account/read și account/rateLimits/read în allowlist; handshake PASS_LOCAL cu CODEX_HOME gol.
- **Autentificare:** ChatGPT tokens din CODEX_HOME.
- **Allowance:** Citirile nu consumă alocare de inferență.
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Metode cu efect care trebuie blocate: account/rateLimitResetCredit/consume (consumă un reset), account/sendAddCreditsNudgeEmail (trimite e-mail), account/bedrock/setup, account/login/* fără aprobare.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Allowlist read-only: account/read, account/rateLimits/read (opțional excludeResetCreditDetails: true, fără supportsLunaReserve), account/usage/read, account/workspaceMessages/read; notificări account/updated, account/rateLimits/updated (update-uri parțiale, se combină cu ultimul snapshot).
- **Suprafață nativă:** Usage dashboard și /status.
- **Cerințe locale:** codex.exe din bundle-ul desktop; CODEX_HOME real pentru date reale.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Sursa de adevăr pentru BillingGuard: blochează turnuri când ordinaryUsageAllowed este false/null, când credits.hasCredits cu sold > 0 și ferestrele sunt aproape pline, sau când spendControlReached.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** claude auth status + limitele Claude (felia Anthropic; Claude nu expune programatic setarea extra usage conform notelor locale).
- **Ce face unic / mai bine:** Expune explicit soldul de credite și motivul limitei, ceea ce permite prevenirea spill-ului.
- **Securitate:** Răspunsurile conțin accountId/email; se redactează înainte de audit.
- **Cale de implementare:** Poller Hub (la pornire, înainte de fiecare turn și după turn) cu stocare MIRROR_STATE în SQLite; UI arată procente și reset.
- **Test necesar:** Un apel read-only real account/read + account/rateLimits/read (fără turn) cu aprobarea proprietarului; teste simulate pentru toate câmpurile nullable.
- **Status:** AVAILABLE
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** medium
- **Note:** Documentația spune că null pentru ordinaryUsageAllowed înseamnă indisponibil; clientul nu trebuie să deducă recuperarea din procente.
- **Surse citite:** https://learn.chatgpt.com/docs/llms-full.txt (App Server: Rate limits, Token usage, Earned resets, Nudge email) · https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server-protocol/src/protocol/v2/account.rs · https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server-protocol/src/protocol/common.rs · https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server-protocol/src/protocol/v2/thread_usage.rs · scratchpad/sources-openai-devday.md (adaptor V2 allowlist)
- **Verificare adversarială:** CONFIRMED — app-server.md și sursa v2 confirmă metodele, câmpurile și faptul că account/usage/read nu merge cu API key sau Bedrock. Șirurile account/usage/read, account/rateLimits/read, ordinaryUsageAllowed, estimatedUsageCreditsMicros și spendControlReached există în binarul local, ceea ce susține AVAILABLE pentru această mașină. Atenție: documentația spune că autentificarea app-server rămâne permisă pentru aplicații locale sau open-source, niciodată pentru servicii comerciale sau găzduite, și recomandă migrarea la Sign in with ChatGPT. Comanda app-server este experimentală și nesuportată în producție. account/read cu refreshToken: true forțează reîmprospătarea tokenului și trebuie evitat.

### Credite ChatGPT (flexible usage) pentru Codex și ChatGPT Work pe planuri personale (`oa-credits-flexible-usage`)

- **Sursă oficială:** https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-personal-plans
- **Documentație tehnică:** https://learn.chatgpt.com/docs/pricing#credits-overview
- **Ce face:** Add-on pay-as-you-go: alocarea inclusă se consumă prima, apoi utilizarea trage AUTOMAT din soldul de credite, fără acțiune manuală. Creditele acoperă Codex, ChatGPT Work, Word, Excel, PowerPoint; se cumpără din Settings → Usage (ChatGPT) sau Usage & Billing (Codex app); sunt valabile 12 luni, nerambursabile, netransferabile, nu sunt credite API. Soldul poate deveni negativ dacă un task pornit cu sold pozitiv îl consumă concurent.
- **Plan necesar:** Plus și Pro (Free/Go doar grup limitat); Business/Enterprise prin flexible pricing.
- **Platformă:** ChatGPT, Codex.
- **Rollout:** GA pentru Plus/Pro unde este disponibil.
- **Eligibilitate cont:** Soldul și disponibilitatea achiziției pentru acest cont sunt necunoscute; se pot citi read-only din credits în account/rateLimits/read.
- **Autentificare:** ChatGPT.
- **Allowance:** Rate standard per 1M tokeni: Astra 250/25/1.250; 6.1 Sol 50/2,5/250; 6 Sol 50/5/250; Luna 2,5/0,25/12,5; Fast 2x, Ultrafast 6x; Voice desktop 1,25 credite/minut; fără taxă separată de cache-write.
- **Utilizare partajată:** Același sold pentru Codex, Work, Word, Excel, PowerPoint și, cu opt-in separat, aplicații SIWC.
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** După epuizarea alocării incluse, utilizarea trage automat din soldul de credite, fără pas manual. Soldul poate deveni negativ dacă un task pornit cu sold pozitiv îl consumă concurent. Documentația nu descrie un comutator care să împiedice Codex/Work să folosească un sold existent. Controlul practic, dedus din documentație, este sold zero plus automatic reload oprit. Nu este documentat dacă continuarea unui turn sub fair use, după atingerea limitei, trage din credite.
- **Risc de facturare API:** high
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Citire: account/rateLimits/read → rateLimits.credits {hasCredits, unlimited, balance}, rateLimitReachedType (workspace_owner_credits_depleted etc.). Nu există metodă de cumpărare în allowlist; cumpărarea este doar în UI.
- **Suprafață nativă:** Add credits la atingerea limitei; Settings → Usage; Usage & Billing în Codex.
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Hub-ul oglindește soldul și blochează turnurile care ar putea trece pe credite; proprietarul decide în UI.
- **Suprafață de execuție:** openai.account_billing
- **Echivalent la celălalt ecosistem:** Extra usage pe planurile Claude (setare pe claude.ai, necitibilă programatic conform notelor V2).
- **Ce face unic / mai bine:** Sold vizibil programatic.
- **Securitate:** Cont compromis poate consuma credite; incidentul se raportează la Support.
- **Cale de implementare:** BillingGuard: dacă credits.hasCredits && balance > 0 → turnurile noi cer confirmare explicită sau sunt oprite când orice fereastră depășește pragul; dacă ordinaryUsageAllowed=false → stop (nu se continuă pe credite). Înregistrare balance înainte/după fiecare turn pentru a detecta consum din credite.
- **Test necesar:** Teste simulate: sold 0 / sold pozitiv / unlimited; verificare manuală de către proprietar a soldului și a automatic reload în Settings → Usage.
- **Status:** BLOCKED
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** high
- **Note:** Un turn care atinge limita poate continua sub fair use; nu este documentat dacă această continuare trage din credite când soldul este pozitiv.
- **Surse citite:** https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-personal-plans (browser integrat) · https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers · https://learn.chatgpt.com/docs/pricing.md · https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
- **Verificare adversarială:** CORRECTED (corectat: status (BillingPolicy Hub (v2/server/policy/billing.mjs: purchased_credits_consumption: deny) ; https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-personal-plans), extraBillingRisk (https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-personal-plans ; https://learn.chatgpt.com/docs/pricing.md)) — Articolul 12642688 a fost citit integral. Creditele acoperă Codex, Work, Word, Excel și PowerPoint; sunt valabile 12 luni, nerambursabile, netransferabile și nu sunt credite API. Se cumpără din Settings → Usage sau Usage & Billing; pe Free/Go doar pentru un grup limitat. Statusul trece la BLOCKED pentru că politica Hub interzice consumul de credite cumpărate; MIRROR_STATE și ASSISTED rămân corecte.

### Automatic reload (auto top-up) pentru credite (`oa-credits-auto-reload`)

- **Sursă oficială:** https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-personal-plans
- **Documentație tehnică:** https://help.openai.com/articles/20001542
- **Ce face:** Dacă este disponibil și activat, când soldul scade sub minimul ales, OpenAI cumpără automat cât trebuie pentru a reveni la soldul țintă, folosind metoda de plată implicită, până la o cheltuială lunară maximă setată; poate cumpăra imediat dacă soldul e deja sub minim la activare. Nu alimentează wallet-ul.
- **Plan necesar:** Planuri personale cu credite (unde este disponibil).
- **Platformă:** Settings → Usage (ChatGPT) sau Usage & Billing (Codex app).
- **Rollout:** Disponibilitate per cont.
- **Eligibilitate cont:** Starea (activ/inactiv) pentru acest cont este necunoscută; trebuie confirmată de proprietar.
- **Autentificare:** ChatGPT + metodă de plată salvată.
- **Allowance:** Plafon: maximum monthly spend (doar pentru reîncărcări automate).
- **Utilizare partajată:** Același sold de credite.
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Taxări automate pe card fără notificare separată la atingerea limitei incluse (avertizare explicită în articolul despre aplicațiile partenere).
- **Risc de facturare API:** high
- **Integrare programatică:** NONE
- **Detaliu integrare:** Nicio metodă app-server pentru citirea sau modificarea setării în sursa citită.
- **Suprafață nativă:** Settings → Usage / Usage & Billing.
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Checklist de pregătire: proprietarul confirmă că automatic reload este OPRIT înainte de orice grant live.
- **Suprafață de execuție:** openai.account_billing
- **Echivalent la celălalt ecosistem:** Setările de extra usage / reîncărcare Claude (felia Anthropic).
- **Ce face unic / mai bine:** n/a
- **Securitate:** Cheltuieli neautorizate dacă Hub-ul rulează necontrolat cu reload activ.
- **Cale de implementare:** Câmp obligatoriu în grant-ul LIVE: autoReloadConfirmedOff (declarație a proprietarului, cu dată); fără el, execuția Codex rămâne suspendată.
- **Test necesar:** Verificare manuală de către proprietar în UI; test de politică pentru câmpul obligatoriu.
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Formularea documentației indică opt-in („poți să-l activezi”), dar nu există dovadă a stării pe acest cont.
- **Surse citite:** https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-personal-plans · https://help.openai.com/articles/20001542
- **Verificare adversarială:** CONFIRMED — Au fost confirmate: pragul minim, soldul țintă, metoda de plată implicită, plafonul lunar valabil doar pentru reîncărcările automate, cumpărarea imediată la activare și faptul că nu alimentează wallet-ul. Articolul 20001542 avertizează că pot apărea taxări automate fără o notificare separată. Binarul local nu conține șiruri pentru auto-reload, deci NONE este corect.

### Resetări de limită câștigate (banked resets) și resetări unice (`oa-rate-limit-reset-credits`)

- **Sursă oficială:** https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
- **Documentație tehnică:** https://learn.chatgpt.com/docs/app-server (Earned rate-limit resets)
- **Ce face:** Unele promoții/referral-uri Plus și Pro adaugă un reset de limită Codex; folosirea lui reîmprospătează ferestrele de 5 ore și săptămânale și mută data resetării săptămânale. OpenAI poate oferi ocazional resetări unice aplicate automat.
- **Plan necesar:** Plus/Pro eligibili (promoții).
- **Platformă:** Meniul de profil Codex; app-server.
- **Rollout:** Per ofertă.
- **Eligibilitate cont:** Necunoscută; rateLimitResetCredits.availableCount o arată.
- **Autentificare:** ChatGPT.
- **Allowance:** n/a
- **Utilizare partajată:** Afectează ferestrele comune Codex/Work.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul direct, dar consumul este ireversibil și schimbă data resetării.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Citire: account/rateLimits/read → rateLimitResetCredits {availableCount, credits[{id, resetType: codexRateLimits, status, grantedAt, expiresAt}]}. Consum: account/rateLimitResetCredit/consume {idempotencyKey, creditId?} → reset \| alreadyRedeemed \| nothingToReset \| noCredit.
- **Suprafață nativă:** Profil → sumarul de utilizare („1 reset available”).
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Hub-ul afișează numărul de resetări; consumul doar la cererea explicită a proprietarului.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** Niciunul cunoscut.
- **Ce face unic / mai bine:** Idempotență documentată.
- **Securitate:** Metoda de consum trebuie scoasă din allowlist-ul automat.
- **Cale de implementare:** Afișare read-only; acțiune ASSISTED cu aprobare per acțiune și idempotencyKey UUID.
- **Test necesar:** Test simulat pentru toate rezultatele consume.
- **Status:** ELIGIBILITY_UNKNOWN
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Support nu resetează limitele.
- **Surse citite:** https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan · https://learn.chatgpt.com/docs/llms-full.txt (App Server §8) · https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server-protocol/src/protocol/v2/account.rs
- **Verificare adversarială:** CONFIRMED — Help 11369540 confirmă resetările banked din promoții/referral Plus și Pro: reîmprospătează ferestrele de 5 ore și săptămânale și mută data resetării; resetările unice se aplică automat. app-server.md §8 confirmă idempotencyKey și rezultatele reset/alreadyRedeemed/nothingToReset/noCredit.

### Citire cont, plan și limite: account/read, account/rateLimits/read, account/usage/read (+ /status, /usage în TUI) (`oa-codex-account-usage-read`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/app-server
- **Documentație tehnică:** https://learn.chatgpt.com/docs/app-server (Auth, Rate limits, Token usage) ; https://raw.githubusercontent.com/openai/codex/main/codex-rs/protocol/src/account.rs
- **Ce face:** Returnează modul de autentificare și planType, ferestrele de limită (usedPercent, windowDurationMins, resetsAt, vedere multi-bucket rateLimitsByLimitId), resetările de limită câștigate și activitatea zilnică de tokeni; emite notificările account/updated și account/rateLimits/updated.
- **Plan necesar:** Cont ChatGPT; account/usage/read cere autentificare pe serviciile Codex.
- **Platformă:** Orice platformă cu codex app-server
- **Rollout:** Documentat; câmpul workspaceRouting din account/read este experimental.
- **Eligibilitate cont:** Metodele există în binarul 0.158 local; citirea reală pe contul proprietarului nu a fost încă făcută în V2.
- **Autentificare:** ChatGPT (sesiunea stocată de Codex)
- **Allowance:** Nu consumă inferență.
- **Utilizare partajată:** Raportează limitele comune tuturor suprafețelor Codex și ChatGPT Work.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul la citire. Metodele învecinate account/rateLimitResetCredit/consume și account/sendAddCreditsNudgeEmail au efecte și sunt tratate separat (respinse).
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** account/read {refreshToken:false} → account{type, email, planType}, requiresOpenaiAuth (+ câmpul experimental workspaceRouting); account/rateLimits/read → rateLimits{limitId, limitName, primary/secondary{usedPercent, windowDurationMins, resetsAt}, rateLimitReachedType, planType și credits (detaliile creditelor rămase ale workspace-ului) când serviciul le returnează}, rateLimitsByLimitId, rateLimitResetCredits{availableCount, credits[{id, resetType, status, grantedAt, expiresAt, title, description}]} pentru resetările câștigate; account/usage/read → summary{lifetimeTokens, peakDailyTokens, longestRunningTurnSec, currentStreakDays, longestStreakDays}, dailyUsageBuckets[{startDate, tokens}]; notificări account/updated{authMode, planType} (authMode: apikey, chatgpt, chatgptAuthTokens, agentIdentity, personalAccessToken, bedrockApiKey sau null) și account/rateLimits/updated. Enum PlanType open-source: free, go, plus, pro, prolite, promax, team, business, enterprise, edu și variante (self_serve_business_*, ent26, enterprise_cbp_*, edu_plus, edu_pro, unknown).
- **Suprafață nativă:** TUI: /status, /usage daily\|weekly\|cumulative, /statusline; tabloul de utilizare ChatGPT.
- **Cerințe locale:** codex app-server cu CODEX_HOME autentificat.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Sursa de adevăr pentru bugetul rutei OpenAI: Hub-ul oprește admiterea când fereastra e aproape plină și dovedește că ruta rulează pe abonament (authMode chatgpt).
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** anthropic: claude auth status --json (subscriptionType max); în dovezile locale nu există citire programatică a ferestrelor de limită Claude.
- **Ce face unic / mai bine:** Procent folosit și moment de resetare per fereastră și per bucket, fără consum.
- **Securitate:** refreshToken=true ar reîmprospăta tokenuri: Hub-ul folosește false. Răspunsul poate conține e-mail: nu se stochează.
- **Cale de implementare:** Adaugă account/usage/read în allowlist-ul V2 lângă account/read și account/rateLimits/read; persistă doar authMode, planType și procentele; prag configurabil pentru pauza admiterii.
- **Test necesar:** Apel read-only pe CODEX_HOME implicit; verifică authMode=chatgpt și valoarea planType.
- **Status:** AVAILABLE
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** high
- **Note:** Valoarea istorică V1 prolite este o valoare reală a enum-ului PlanType; în sursa open-source prolite nu intră în grupurile de workspace (echipă, business, edu, enterprise), deci corespunde unui plan personal. Pricing listează Pro la 100, 200 sau 500 USD, dar corespondența prolite ↔ nivel de preț nu este documentată (help.openai.com nu a putut fi citit). Câmpul credits din rateLimits descrie creditele rămase, nu resetările câștigate.
- **Surse citite:** https://learn.chatgpt.com/docs/app-server · https://raw.githubusercontent.com/openai/codex/main/codex-rs/protocol/src/account.rs · https://learn.chatgpt.com/docs/developer-commands?surface=cli · https://learn.chatgpt.com/docs/pricing
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://learn.chatgpt.com/docs/app-server ; https://raw.githubusercontent.com/openai/codex/main/codex-rs/protocol/src/account.rs ; https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server/README.md), notes (https://raw.githubusercontent.com/openai/codex/main/codex-rs/protocol/src/account.rs ; https://learn.chatgpt.com/docs/pricing)) — Metodele, cerința de autentificare pe serviciile Codex pentru account/usage/read și câmpul experimental workspaceRouting sunt confirmate. Corectat: resetările câștigate sunt în rateLimitResetCredits, iar credits se referă la creditele rămase ale workspace-ului.

### Fast mode și Astra Ultrafast (niveluri de viteză) (`oa-codex-fast-mode`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/pricing
- **Documentație tehnică:** https://learn.chatgpt.com/docs/developer-commands?surface=cli (/fast)
- **Ce face:** /fast activează nivelul Fast al modelului când catalogul îl expune; Ultrafast accelerează GPT-6 Astra.
- **Plan necesar:** Fast: toate planurile din tabel; Astra Ultrafast: Pro 500 USD și Enterprise/Edu eligibile.
- **Platformă:** CLI, desktop, app-server
- **Rollout:** Disponibil
- **Eligibilitate cont:** Flag local fast_mode=true; Ultrafast nepresupus.
- **Autentificare:** ChatGPT
- **Allowance:** Fast consumă 2,5x din alocarea inclusă (2x la credite); Astra Ultrafast 8x (6x la credite).
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Epuizare accelerată; upgrade la Pro 500 interzis de politică.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** /fast în TUI (persistă selecția); persistență în config.toml prin service_tier = "fast" (trimis ca valoarea priority) plus [features].fast_mode = true; pentru un proces anume se poate folosi -c features.fast_mode=false sau --disable fast_mode. Fast mode este disponibil în desktop, CLI și IDE doar cu autentificare ChatGPT.
- **Suprafață nativă:** /fast, selectorul de viteză în desktop
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Interzis în firele Hub; alegere exclusivă a proprietarului.
- **Suprafață de execuție:** openai.codex_cli
- **Echivalent la celălalt ecosistem:** Nicio echivalență verificată în dovezile locale Claude.
- **Ce face unic / mai bine:** Latență mai mică.
- **Securitate:** n/a
- **Cale de implementare:** Adapterul V2 nu setează nivelul Fast; pentru firele Hub pornește app-server cu override-ul --disable fast_mode (sau fără service_tier fast), ca o selecție persistată de proprietar să nu se aplice, și verifică efectul prin config/read.
- **Test necesar:** config/read pentru a detecta o selecție Fast persistată.
- **Status:** AVAILABLE
- **Decizie Hub:** REJECT
- **Încredere:** medium
- **Note:** Multiplicatorii nu descriu creșterea de viteză.
- **Surse citite:** https://learn.chatgpt.com/docs/pricing · https://learn.chatgpt.com/docs/developer-commands?surface=cli · local: sources-openai-devday.md
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://learn.chatgpt.com/docs/agent-configuration/speed ; https://learn.chatgpt.com/docs/config-file/config-reference ; https://learn.chatgpt.com/docs/cli/reference), implementationPath (https://learn.chatgpt.com/docs/agent-configuration/speed ; https://learn.chatgpt.com/docs/app-server)) — Multiplicatorii (Fast 2,5x inclus/2x credite, Astra Ultrafast 8x/6x) și eligibilitatea Ultrafast (Pro 500 USD, Enterprise/Edu eligibile) sunt confirmate; înlocuită formularea vagă cu cheile documentate service_tier și features.fast_mode.

## coding

### Codex cu API key (facturare API) (`oa-codex-api-key-billing`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/pricing
- **Documentație tehnică:** https://learn.chatgpt.com/docs/auth
- **Ce face:** Codex CLI/SDK/IDE pot rula cu un API key, plătit la tarifele API, fără funcții cloud; documentația de prețuri spune că orice utilizator poate rula chat-uri locale suplimentare cu API key după atingerea limitelor.
- **Plan necesar:** Cont OpenAI API cu facturare.
- **Platformă:** Codex CLI, SDK, IDE.
- **Rollout:** GA.
- **Eligibilitate cont:** Neaplicabil: Hub-ul refuză conturile API key (account/read type apiKey).
- **Autentificare:** OPENAI_API_KEY.
- **Allowance:** Plată per token.
- **Utilizare partajată:** Separat de abonament.
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Facturare API directă.
- **Risc de facturare API:** high
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** printenv OPENAI_API_KEY \| codex login --with-api-key; variabila CODEX_API_KEY pentru exec, review, TypeScript SDK și exec-server remote; în app-server, account/login/start cu type apiKey. Toate sunt interzise în Hub.
- **Suprafață nativă:** n/a
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Rută interzisă explicit; mediul copilului Codex se curăță de OPENAI_API_KEY.
- **Suprafață de execuție:** openai.codex_cli
- **Echivalent la celălalt ecosistem:** claude --bare / ANTHROPIC_API_KEY (tot interzis).
- **Ce face unic / mai bine:** n/a
- **Securitate:** Scurgere de chei; costuri neplanificate.
- **Cale de implementare:** BillingPolicy existentă: refuz la account/read type apiKey; mediul copil este allowlist-only, iar OPENAI_API_KEY și CODEX_API_KEY sunt în BILLING_RISK_ENV și nu trec. Gardă nativă suplimentară, cu aprobarea proprietarului: forced_login_method = "chatgpt" în config.toml din CODEX_HOME-ul Hub sau allowed_login_methods = ["chatgpt"] în requirements.toml locale (valoarea „api” include și Amazon Bedrock). Dacă credențialele nu corespund, Codex deloghează și iese.
- **Test necesar:** Testul existent de politică.
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Surse citite:** https://learn.chatgpt.com/docs/pricing.md · https://learn.chatgpt.com/docs/agent-configuration/speed.md
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://learn.chatgpt.com/docs/auth.md ; https://learn.chatgpt.com/llms-full.txt (tabelul Authentication and network) ; https://learn.chatgpt.com/docs/app-server.md), implementationPath (https://learn.chatgpt.com/llms-full.txt (Enforce a login method; Manage authentication locally) ; v2/server/policy/billing.mjs)) — auth.md confirmă că API key-ul se facturează la tarif API, fără funcții cloud. Formularea anterioară „env allowlist fără OPENAI_*” omitea CODEX_API_KEY; codul actual îl acoperă.

### Codex app-server: protocol JSON-RPC 2.0 (thread/turn/item, aprobări, evenimente) (`oa-codex-app-server`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/app-server
- **Documentație tehnică:** https://learn.chatgpt.com/docs/app-server ; https://learn.chatgpt.com/docs/cli/reference (secțiunea codex app-server) ; schema exactă: codex app-server generate-json-schema \| generate-ts
- **Ce face:** Interfață JSON-RPC 2.0 prin care un produs propriu integrează agentul Codex: autentificare, istoric de conversații, aprobări și evenimente în flux. Transport implicit stdio (JSONL); WebSocket și Unix socket sunt experimentale.
- **Plan necesar:** Orice plan ChatGPT care include Codex (tabel pricing: Plus, Pro, Business, Enterprise/Edu; Free/Go doar GPT-6 Luna în desktop). Autentificarea cu API key există, dar este refuzată de BillingPolicy.
- **Platformă:** Windows 11 local (codex-cli 0.158.0-alpha.2.1 din pachetul desktop); macOS; Linux
- **Rollout:** Comanda codex app-server este marcată Experimental (în primul rând pentru dezvoltare și depanare, se poate schimba fără preaviz); transportul WebSocket este experimental și nesuportat pentru producție; unele metode și câmpuri cer capabilities.experimentalApi. Ultima versiune stabilă publicată: 0.159.2 (29.09.2026, după 0.159.1 din aceeași zi).
- **Eligibilitate cont:** codex login status → Logged in using ChatGPT; handshake V2 PASS_LOCAL cu CODEX_HOME gol; planType încă necitit prin account/read în V2.
- **Autentificare:** ChatGPT OAuth gestionat de Codex (Hub-ul nu citește credențialele); account/login/start acceptă apiKey, chatgpt, chatgptDeviceCode și chatgptAuthTokens (experimental).
- **Allowance:** Fiecare turn/start consumă din limitele planului (mesaje locale; estimări per 5 ore pentru Plus; Pro fără limită de 5 ore, pot exista limite săptămânale). Metodele de citire nu consumă.
- **Utilizare partajată:** Aceeași alocare ca desktop, CLI, IDE și cloud (pricing: mesajele locale și chaturile cloud împart alocarea planului).
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** După atingerea limitei, creditele ChatGPT existente pot fi consumate; authMode apikey ar trece pe facturare API (de respins); Fast consumă 2,5x din alocarea inclusă.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** codex app-server --listen stdio:// ; initialize(capabilities) → initialized → thread/start \| thread/resume \| thread/fork → turn/start (model, effort, cwd, sandboxPolicy, approvalPolicy never\|onRequest\|unlessTrusted, outputSchema per turn) → notificări turn/started, item/started, item/agentMessage/delta, item/commandExecution/outputDelta, turn/diff/updated, turn/plan/updated, thread/tokenUsage/updated, model/rerouted, turn/completed (completed\|interrupted\|failed). Control: turn/steer, turn/interrupt. Cereri server→client: item/commandExecution/requestApproval și item/fileChange/requestApproval (accept, acceptForSession, decline, cancel), item/permissions/requestApproval, tool/requestUserInput. dynamicTools pe thread/start (experimental) pentru unelte proprii. model/list pentru catalog. WebSocket supraîncărcat: eroare -32001, retry cu backoff.
- **Suprafață nativă:** Folosit intern de ChatGPT desktop app, extensia IDE, TUI (prin daemon) și remote control.
- **Cerințe locale:** codex.exe (bundle desktop %LOCALAPPDATA%\OpenAI\Codex\bin\... sau npm @openai/codex), CODEX_HOME cu login ChatGPT, adapterul Node 24 din v2/, mediu curățat de CODEX_API_KEY, OPENAI_API_KEY, CODEX_ACCESS_TOKEN și de variabilele de workload identity (OPENAI_FEDERATION_RULE_ID, OPENAI_IDENTITY_TOKEN_FILE), care pot schimba identitatea de autentificare sau facturarea.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Ruta principală de execuție OpenAI: worker Codex pentru taskurile Hub, cu aprobările Codex mapate pe aprobările Hub și toate evenimentele în audit.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** anthropic.claude_code_headless: claude -p --output-format stream-json (--input-format stream-json), --session-id / --resume.
- **Ce face unic / mai bine:** Aprobări granulare per comandă și per fișier, steer în timpul turnului, fork și compactare, review/start, goals, introspecție skills/plugins/MCP/hooks și citirea limitelor planului pe același canal.
- **Securitate:** Protocol experimental, se poate schimba fără preaviz. Unele metode ies din sandbox sau au efecte externe (thread/shellCommand, process/spawn, fs/writeFile, config/*, feedback/upload) și trebuie blocate prin allowlist. WebSocket pe adrese non-loopback fără --ws-auth este interzis.
- **Cale de implementare:** Păstrează adapterul V2 cu allowlist implicit-refuz; fixează versiunea binarului și regenerează schema (generate-json-schema --experimental) la fiecare actualizare; pornește procesul cu override-ul nativ forced_login_method = "chatgpt" (verificat prin config/read) și respinge orice authMode diferit de chatgpt; sandbox readOnly/workspaceWrite; approvalPolicy onRequest cu approvals_reviewer = user, iar cererile requestApproval devin aprobări Hub.
- **Test necesar:** account/read pe CODEX_HOME implicit (fără inferență), apoi un singur turn live read-only aprobat explicit (grant LIVE_VALIDATION) plus test turn/interrupt.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Documentația oficială spune că app-server-ul și transportul WebSocket sunt experimentale și nesuportate pentru producție. Secțiunea Auth precizează că autentificarea prin app-server nu a fost niciodată permisă pentru servicii comerciale sau găzduite și recomandă Sign in with ChatGPT; aplicațiile locale existente o pot folosi în continuare, deci Hub-ul trebuie să rămână local și privat, fără expunere ca serviciu. Pentru joburi automate și CI documentația recomandă Codex SDK. README-ul din repo (codex-rs/app-server) conține doar note de schimbări, nu specificația completă.
- **Surse citite:** https://learn.chatgpt.com/docs/app-server · https://learn.chatgpt.com/docs/cli/reference · https://learn.chatgpt.com/docs/changelog · https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server/README.md · https://raw.githubusercontent.com/openai/codex/main/codex-rs/cli/src/main.rs · local: sources-openai-devday.md secțiunea E · v2/config/capabilities.json (C-app-server)
- **Verificare adversarială:** CORRECTED (corectat: rollout (https://learn.chatgpt.com/docs/cli/reference ; https://learn.chatgpt.com/docs/changelog ; https://api.github.com/repos/openai/codex/releases), localRequirements (https://learn.chatgpt.com/docs/config-file/environment-variables ; https://learn.chatgpt.com/docs/auth), implementationPath (https://learn.chatgpt.com/docs/config-file/config-reference ; https://learn.chatgpt.com/docs/app-server), notes (https://learn.chatgpt.com/docs/app-server)) — Protocolul JSON-RPC, ciclul thread/turn/item, aprobările (inclusiv acceptWithExecpolicyAmendment), evenimentele, eroarea -32001 și modurile de autentificare sunt confirmate în app-server.md. Corectat: ultima versiune stabilă este 0.159.2; adăugate restricția de politică pentru servicii comerciale/găzduite, variabilele de mediu care schimbă autentificarea și garda nativă forced_login_method.

### Reluare, fork, arhivare, ștergere de sesiuni (resume/fork/archive/unarchive/delete) (`oa-codex-session-lifecycle`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/cli/reference
- **Documentație tehnică:** https://learn.chatgpt.com/docs/app-server (thread/resume, thread/fork, thread/archive, thread/delete)
- **Ce face:** Continuă o sesiune salvată, o ramifică într-un chat nou păstrând transcrierea, o ascunde din liste sau o șterge definitiv; compactare și redenumire.
- **Plan necesar:** Toate planurile cu Codex
- **Platformă:** Windows, macOS, Linux
- **Rollout:** Stable în CLI; metodele app-server documentate (thread/rollback depreciat).
- **Eligibilitate cont:** Comenzile există local.
- **Autentificare:** ChatGPT
- **Allowance:** Operațiile de gestiune nu consumă; turnurile ulterioare consumă.
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** CLI: codex resume [--last\|--all\|SESSION], codex fork [--last], codex archive\|unarchive <SESSION>, codex delete <UUID> --force, toate cu --remote; codex exec resume. App-server: thread/resume, thread/fork{lastTurnId, ephemeral}, thread/archive, thread/unarchive, thread/delete, thread/name/set, thread/metadata/update, thread/compact/start.
- **Suprafață nativă:** TUI (/resume, /fork, /archive, /delete, /rename, /compact), desktop.
- **Cerințe locale:** CODEX_HOME cu sesiuni salvate.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Continuitatea taskurilor Hub: fiecare task are un thread id Codex; fork pentru încercări alternative.
- **Suprafață de execuție:** openai.codex_cli
- **Echivalent la celălalt ecosistem:** claude -r/--resume, -c/--continue, --fork-session, --session-id.
- **Ce face unic / mai bine:** Fork până la un anumit turn și fork efemer în memorie.
- **Securitate:** thread/delete și codex delete sunt ireversibile și sunt interzise fără aprobare.
- **Cale de implementare:** Allowlist: thread/resume, thread/fork, thread/archive, thread/name/set, thread/compact/start; thread/delete exclus.
- **Test necesar:** Test simulat de resume/fork; live doar în cadrul grantului unui turn.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** --remote permite aceleași operații pe un app-server remote.
- **Surse citite:** https://learn.chatgpt.com/docs/cli/reference · https://learn.chatgpt.com/docs/app-server · https://learn.chatgpt.com/docs/changelog
- **Verificare adversarială:** CONFIRMED — Comenzile CLI (resume, fork, archive, unarchive, delete --force doar cu UUID, --remote) și metodele app-server (thread/fork cu lastTurnId și ephemeral, thread/delete ireversibil inclusiv pentru descendenți, thread/rollback depreciat) sunt confirmate.

### Worktree-uri Git integrate (Codex-managed worktrees, handoff) (`oa-codex-worktrees`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/environments/git-worktrees
- **Documentație tehnică:** https://learn.chatgpt.com/docs/changelog (0.156.0: worktree implicit în CLI) ; https://learn.chatgpt.com/docs/environments/local-environment
- **Ce face:** Codex creează worktree-uri în $CODEX_HOME/worktrees (detached HEAD), permite handoff Local↔Worktree, păstrează implicit până la 15 worktree-uri gestionate cu snapshot înainte de curățare; în CLI sunt active implicit din 0.156.0 și se pot crea din command center; taskurile programate pot rula pe worktree dedicat.
- **Plan necesar:** Toate planurile (tabel pricing: Worktrees and built-in Git tools)
- **Platformă:** Windows, macOS, Linux
- **Rollout:** GA în desktop; activ implicit în CLI din 22.09.2026.
- **Eligibilitate cont:** Flag local worktrees=true.
- **Autentificare:** ChatGPT
- **Allowance:** Crearea nu consumă; munca din worktree consumă ca orice turn.
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Nicio metodă app-server documentată pentru crearea unui worktree gestionat; thread/start acceptă cwd, iar thread/metadata/update persistă gitInfo. Hub-ul poate crea worktree-ul cu git worktree add și îl transmite ca cwd.
- **Suprafață nativă:** Composerul desktop (Worktree), Hand off, command center în CLI, setări Worktrees.
- **Cerințe locale:** Repo Git; spațiu pe disc în CODEX_HOME.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Izolarea taskurilor Hub care scriu cod, sub lease-ul de workspace al Hub-ului.
- **Suprafață de execuție:** openai.codex_desktop
- **Echivalent la celălalt ecosistem:** claude -w/--worktree (Claude Code).
- **Ce face unic / mai bine:** Snapshot automat înainte de curățare și handoff între local și worktree.
- **Securitate:** Un branch nu poate fi activ în două worktree-uri; scripturile de setup din local environments rulează automat la creare; fișierul .worktreeinclude poate copia fișiere ignorate de Git (de exemplu .env sau fișiere cu secrete) în worktree-urile gestionate de desktop, deci Hub-ul trebuie să-l verifice sau să-l interzică în repo.
- **Cale de implementare:** Hub-ul creează și curăță singur worktree-ul cu git nativ (nu un mecanism propriu) și îl declară ca cwd; worktree-urile gestionate de Codex rămân pentru uzul interactiv al proprietarului.
- **Test necesar:** Test local fără model: creare/ștergere worktree de către Hub într-un repo de test.
- **Status:** AVAILABLE
- **Decizie Hub:** REIMPLEMENT
- **Încredere:** medium
- **Note:** REIMPLEMENT înseamnă doar orchestrarea git nativă din Hub, deoarece varianta Codex nu are API documentat.
- **Surse citite:** https://learn.chatgpt.com/docs/environments/git-worktrees · https://learn.chatgpt.com/docs/changelog · https://learn.chatgpt.com/docs/environments/local-environment · local: sources-openai-devday.md
- **Verificare adversarială:** CORRECTED (corectat: securityConcerns (https://learn.chatgpt.com/docs/environments/git-worktrees)) — Confirmate: $CODEX_HOME/worktrees (configurabil în Settings > Worktrees), HEAD detașat, limita implicită de 15 worktree-uri, snapshot înainte de ștergere, handoff și activarea implicită în CLI din 0.156.0; nu există metode app-server pentru worktree-uri gestionate. Adăugat riscul .worktreeinclude.

### Hooks pe ciclul de viață Codex (`oa-codex-hooks`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/hooks
- **Documentație tehnică:** https://learn.chatgpt.com/docs/hooks ; https://learn.chatgpt.com/docs/app-server (hooks/list, hook/started, hook/completed)
- **Ce face:** Rulează handleri command sau mcp_tool (unelte pe un server MCP deja conectat; handlerii prompt și agent sunt citiți, dar ignorați) la evenimentele SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, Stop, Interrupt, PreCompact, PostCompact, SubagentStart, SubagentStop; pot adăuga context, refuza sau rescrie apeluri de unelte și pot bloca oprirea.
- **Plan necesar:** Toate planurile cu Codex
- **Platformă:** CLI, desktop
- **Rollout:** Activ implicit; se dezactivează cu [features].hooks=false.
- **Eligibilitate cont:** Flag local hooks=true.
- **Autentificare:** n/a
- **Allowance:** Hooks nu consumă inferență (additionalContext mare mărește contextul).
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Config: ~/.codex/hooks.json sau [hooks] în config.toml, <repo>/.codex/hooks.json, hooks/hooks.json în pluginuri, requirements.toml (gestionat, allow_managed_hooks_only). Ieșiri: permissionDecision allow\|deny, updatedInput, decision block, additionalContext, exit code 2. Trust per hash prin /hooks; hooks async (max. 8). App-server: hooks/list; notificări hook/started și hook/completed. codex exec --dangerously-bypass-hook-trust există (interzis în Hub).
- **Suprafață nativă:** /hooks în TUI pentru inspecție, trust și dezactivare.
- **Cerințe locale:** Scripturi locale pentru hooks.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Faza 1: inventar și alertă pentru hooks neaprobate; faza 2 (cu aprobare): hook comun de audit spre Hub pe loopback.
- **Suprafață de execuție:** openai.codex_cli
- **Echivalent la celălalt ecosistem:** Claude Code hooks (settings.json) și --include-hook-events în stream-json.
- **Ce face unic / mai bine:** Format foarte apropiat de Claude Code (matchere Bash, Edit\|Write, mcp__*, exit 2); Codex setează CLAUDE_PLUGIN_ROOT și CLAUDE_PLUGIN_DATA pentru compatibilitate cu hook-urile de plugin existente.
- **Securitate:** Hooks execută cod local cu drepturile utilizatorului; hooks din repo cer trust; bypass-ul de trust este interzis; managed hooks nu pot fi dezactivate individual. Documentația le tratează ca protecție utilă, nu ca graniță completă: uneltele găzduite (WebSearch) și unele căi specializate nu trec prin hooks, hook-urile asincrone nu pot bloca, iar erorile sau timeout-urile unui hook nu blochează unealta; auditul Hub nu se poate baza doar pe ele.
- **Cale de implementare:** Citire hooks/list în observator; propunerea unui hook de audit identic pentru Codex și Claude, instalat doar după aprobare.
- **Test necesar:** hooks/list pe cwd-ul proiectului (fără inferență).
- **Status:** AVAILABLE
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** high
- **Note:** WebSearch și alte unelte găzduite nu declanșează hooks.
- **Surse citite:** https://learn.chatgpt.com/docs/hooks · https://learn.chatgpt.com/docs/app-server · https://learn.chatgpt.com/docs/cli/reference
- **Verificare adversarială:** CORRECTED (corectat: whatItDoes (https://learn.chatgpt.com/docs/hooks), securityConcerns (https://learn.chatgpt.com/docs/hooks)) — Evenimentele, locațiile de configurare, trust-ul pe hash, limita de opt hooks asincrone, CLAUDE_PLUGIN_ROOT/CLAUDE_PLUGIN_DATA, câmpurile permissionDecision/updatedInput/decision block și exit 2 sunt confirmate. Corectat: handlerii mcp_tool nu sunt doar gestionați și limitele de acoperire pentru audit.

### codex exec: rulare non-interactivă (JSONL, --output-schema) (`oa-codex-exec`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/non-interactive-mode
- **Documentație tehnică:** https://learn.chatgpt.com/docs/cli/reference (codex exec)
- **Ce face:** Rulează un task până la final fără interacțiune, cu ieșire formatată sau flux JSONL (thread.started, turn.started, turn.completed, turn.failed, item.*, error) și răspuns final validat de o schemă JSON.
- **Plan necesar:** Tabel pricing: Codex SDK, codex exec și fluxuri scriptabile pe Plus, Pro, Business, Enterprise (și API key).
- **Platformă:** Windows, macOS, Linux
- **Rollout:** Stable
- **Eligibilitate cont:** Comanda există local; login ChatGPT activ.
- **Autentificare:** Reutilizează autentificarea salvată (ChatGPT). Variabila documentată CODEX_API_KEY trece rularea pe cheie API (facturare API), iar CODEX_ACCESS_TOKEN pe identitatea unui access token; OPENAI_API_KEY nu apare ca variabilă de autentificare pentru codex exec în paginile citite, dar Hub-ul o elimină oricum din mediu.
- **Allowance:** Consumă din plan ca orice turn.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** O cheie API în mediu ar muta facturarea pe API — Hub-ul curăță mediul.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** codex exec --json -C <dir> -s read-only\|workspace-write -m <model> --output-schema <file> -o <file> --ephemeral --ignore-user-config -c key=value - ; codex exec resume [--last\|ID]. Flaguri interzise: --dangerously-bypass-approvals-and-sandbox/--yolo, --dangerously-bypass-hook-trust, --full-auto (depreciat).
- **Suprafață nativă:** Terminal/CI.
- **Cerințe locale:** codex.exe, mediu fără chei API.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Rută de rezervă read-only când app-server-ul nu este disponibil.
- **Suprafață de execuție:** openai.codex_cli
- **Echivalent la celălalt ecosistem:** claude -p --output-format json\|stream-json --json-schema.
- **Ce face unic / mai bine:** Ieșire structurată validată de schemă și rulare efemeră fără fișiere de sesiune.
- **Securitate:** Aprobările nu pot fi mediate interactiv de Hub; se folosește doar sandbox read-only.
- **Cale de implementare:** Adapter secundar cu aceleași reguli de mediu ca app-server-ul, sandbox implicit read-only, --ignore-user-config pentru reproductibilitate și override forced_login_method = "chatgpt"; flaguri interzise: --dangerously-bypass-approvals-and-sandbox/--yolo, --dangerously-bypass-hook-trust, --full-auto, --ignore-rules și -s danger-full-access.
- **Test necesar:** Test simulat al parserului JSONL; un run live doar sub grant.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** app-server rămâne ruta principală deoarece suportă aprobări.
- **Surse citite:** https://learn.chatgpt.com/docs/non-interactive-mode · https://learn.chatgpt.com/docs/cli/reference · https://learn.chatgpt.com/docs/pricing
- **Verificare adversarială:** CORRECTED (corectat: authMethod (https://learn.chatgpt.com/docs/non-interactive-mode ; https://learn.chatgpt.com/docs/config-file/environment-variables), implementationPath (https://learn.chatgpt.com/docs/cli/reference ; https://learn.chatgpt.com/docs/config-file/config-reference)) — Evenimentele JSONL, --output-schema, -o, --ephemeral, sandbox-ul implicit read-only și statutul Stable sunt confirmate. Corectată descrierea variabilelor care schimbă autentificarea și completată lista de flaguri interzise.

### Codex SDK (TypeScript @openai/codex-sdk, Python openai-codex) (`oa-codex-sdk`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/codex-sdk
- **Documentație tehnică:** https://learn.chatgpt.com/docs/codex-sdk
- **Ce face:** Biblioteci pentru a porni, continua și relua fire Codex locale din cod: TypeScript (Node 18+) și Python (3.10+, controlează app-server-ul local prin JSON-RPC, cu runtime CLI fixat în pachet).
- **Plan necesar:** Aceleași planuri ca codex exec
- **Platformă:** Node 18+ / Python 3.10+
- **Rollout:** Python SDK stable; TypeScript documentat.
- **Eligibilitate cont:** Neinstalat local.
- **Autentificare:** Credențialele CLI-ului local (ChatGPT sau API key)
- **Allowance:** Consumă din plan ca orice turn.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Aceleași riscuri de chei API în mediu.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** TS: new Codex().startThread().run(prompt), resumeThread(id). Python: with Codex() as codex: codex.thread_start(model, sandbox).run(...); AsyncCodex.
- **Suprafață nativă:** n/a
- **Cerințe locale:** npm install @openai/codex-sdk sau pip install openai-codex (instalările nu sunt permise acum).
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință de implementare pentru adapterul propriu al Hub-ului.
- **Suprafață de execuție:** openai.codex_sdk
- **Echivalent la celălalt ecosistem:** Nicio echivalență verificată în această sarcină.
- **Ce face unic / mai bine:** Mod oficial de a încapsula app-server-ul.
- **Securitate:** SDK-ul Python aduce un al doilea binar Codex fixat (derivă de versiune față de desktop).
- **Cale de implementare:** Nu se adoptă; adapterul Node V2 rămâne.
- **Test necesar:** Niciunul.
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Documentația recomandă app-server pentru clienți custom cu aprobări și SDK pentru CI.
- **Surse citite:** https://learn.chatgpt.com/docs/codex-sdk · https://learn.chatgpt.com/docs/pricing
- **Verificare adversarială:** CONFIRMED — Pagina Codex SDK confirmă @openai/codex-sdk (Node 18+, startThread/run/resumeThread) și openai-codex (Python 3.10+, controlează app-server-ul local prin JSON-RPC, runtime CLI fixat, versiune stabilă), precum și recomandarea: SDK pentru automatizare/CI, app-server pentru clienți cu aprobări.

### Codex GitHub Action (openai/codex-action@v1) (`oa-codex-github-action`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/github-action
- **Documentație tehnică:** https://learn.chatgpt.com/docs/github-action ; https://learn.chatgpt.com/docs/non-interactive-mode
- **Ce face:** Instalează Codex CLI în GitHub Actions, pornește un proxy Responses API cu cheia API furnizată și rulează codex exec pentru patch-uri sau review-uri în CI.
- **Plan necesar:** Cheie OpenAI API (openai-api-key).
- **Platformă:** GitHub Actions
- **Rollout:** Disponibil
- **Eligibilitate cont:** n/a
- **Autentificare:** API key
- **Allowance:** Facturare API.
- **Utilizare partajată:** Nu folosește abonamentul.
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Facturare API la tarife standard — interzisă de BillingPolicy.
- **Risc de facturare API:** high
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** uses: openai/codex-action@v1 cu openai-api-key din secrets.
- **Suprafață nativă:** GitHub
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul.
- **Suprafață de execuție:** openai.codex_github
- **Echivalent la celălalt ecosistem:** Nicio echivalență verificată în această sarcină.
- **Ce face unic / mai bine:** CI gestionat.
- **Securitate:** Expunerea cheii API pe runneri.
- **Cale de implementare:** Nu se implementează.
- **Test necesar:** Niciunul.
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Coloana API Key din pricing nu include funcțiile cloud.
- **Surse citite:** https://learn.chatgpt.com/docs/github-action · https://learn.chatgpt.com/docs/non-interactive-mode
- **Verificare adversarială:** CONFIRMED — Pagina GitHub Action confirmă cheia OpenAI stocată ca secret, proxy-ul Responses API pornit doar când se furnizează openai-api-key și rularea codex exec; facturarea este API, deci BLOCKED/REJECT este corect.

### Gazde SSH, handoff între gazde și TUI remote (codex --remote) (`oa-codex-ssh-remote-hosts`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/remote-connections
- **Documentație tehnică:** https://learn.chatgpt.com/docs/app-server (Remote terminal UI) ; https://learn.chatgpt.com/docs/cli/reference (--remote)
- **Ce face:** Desktop app pornește app-server-ul Codex pe o gazdă SSH (din ~/.ssh/config) și rulează chaturi pe fișierele și shell-ul ei; handoff mută un chat și starea Git între gazde prin worktree; TUI-ul se poate conecta la un app-server remote.
- **Plan necesar:** Toate planurile (tabel: SSH remote connections)
- **Platformă:** Desktop macOS/Windows; gazde Linux/macOS/Windows
- **Rollout:** Disponibil
- **Eligibilitate cont:** Neconfigurat.
- **Autentificare:** SSH + ChatGPT pe gazda remote
- **Allowance:** Consum normal pe plan.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** codex --remote ws://host:port\|wss://\|unix://PATH --remote-auth-token-env ENV (pentru codex, resume, fork, archive, delete, unarchive); codex app-server --listen ws://IP:PORT --ws-auth capability-token\|signed-bearer-token; codex app-server daemon bootstrap --remote-control.
- **Suprafață nativă:** Settings > Connections > SSH (desktop).
- **Cerințe locale:** Config SSH, codex instalat pe gazda remote.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Neutilizat (Hub pe o singură mașină Windows).
- **Suprafață de execuție:** openai.codex_desktop
- **Echivalent la celălalt ecosistem:** Nicio echivalență verificată în dovezile locale.
- **Ce face unic / mai bine:** Handoff cu starea Git între gazde.
- **Securitate:** Nu se expune app-server-ul pe rețele publice; tokenurile se trimit doar pe wss:// sau ws:// local; handoff-ul întrerupe răspunsul în curs.
- **Cale de implementare:** Nicio integrare.
- **Test necesar:** Niciunul.
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Handoff către un mediu Codex cloud nu este suportat.
- **Surse citite:** https://learn.chatgpt.com/docs/remote-connections · https://learn.chatgpt.com/docs/app-server · https://learn.chatgpt.com/docs/cli/reference · https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server-daemon/README.md
- **Verificare adversarială:** CONFIRMED — Pagina Remote connections confirmă pornirea app-server prin SSH din ~/.ssh/config (doar aliasuri concrete), handoff-ul cu starea Git prin worktree (fără handoff către Codex cloud) și recomandarea de a nu expune app-server-ul public; flagurile --remote și --ws-auth sunt în referința CLI și app-server.md.

### Codex în ChatGPT desktop app (Windows) (`oa-codex-desktop-app`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/app
- **Documentație tehnică:** https://learn.chatgpt.com/docs/windows/windows-app ; https://learn.chatgpt.com/docs/cli/reference (codex app)
- **Ce face:** Aplicația desktop găzduiește Codex cu proiecte, chaturi paralele, worktrees, terminal integrat, review, previzualizare de fișiere, browser integrat, Computer Use, pluginuri, skills, taskuri programate și voce; pe Windows agentul rulează în PowerShell cu sandbox nativ sau în WSL2.
- **Plan necesar:** Chaturi locale: Plus, Pro, Business, Enterprise, API key; Free/Go doar GPT-6 Luna, în funcție de rollout.
- **Platformă:** Windows 11 (instalat local), macOS (Apple Silicon și Intel), Linux în preview (Ubuntu, Debian, Fedora, Arch)
- **Rollout:** GA
- **Eligibilitate cont:** Instalat local (bundle codex 0.158.0-alpha.2.1).
- **Autentificare:** ChatGPT
- **Allowance:** Consum normal pe plan.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Credite existente după limită.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** codex app [PATH] deschide aplicația (pe Windows tipărește calea); pe Windows aplicația folosește același CODEX_HOME ca Codex nativ (%USERPROFILE%\.codex), deci firele ar trebui vizibile prin thread/list (de verificat, inclusiv sourceKinds); /app din TUI continuă sesiunea curentă în aplicație; instalare winget --id 9PLM9XGG6VKS -s msstore.
- **Suprafață nativă:** Aplicația ChatGPT desktop (Codex / Work).
- **Cerințe locale:** Aplicația instalată și autentificată.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Interfața de lucru a proprietarului; Hub-ul pregătește inputuri și oglindește starea.
- **Suprafață de execuție:** openai.codex_desktop
- **Echivalent la celălalt ecosistem:** anthropic.claude_code_interactive (sesiuni Code în Claude desktop).
- **Ce face unic / mai bine:** Toate funcțiile native (browser, Computer Use, pluginuri de documente) într-un singur loc.
- **Securitate:** Funcțiile desktop pot acționa în afara workspace-ului (Computer Use, browser).
- **Cale de implementare:** ASSISTED + MIRROR_STATE prin app-server read-only.
- **Test necesar:** thread/list pentru a confirma vizibilitatea firelor desktop.
- **Status:** AVAILABLE
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Pe Windows, sandbox-ul se aplică doar cu Ask for approval selectat sub composer.
- **Surse citite:** https://learn.chatgpt.com/docs/app · https://learn.chatgpt.com/docs/windows/windows-app · https://learn.chatgpt.com/docs/pricing · local: sources-openai-devday.md secțiunea E
- **Verificare adversarială:** CORRECTED (corectat: platform (https://learn.chatgpt.com/docs/changelog (26.415, 11.08.2026) ; https://learn.chatgpt.com/llms.txt), programmaticDetail (https://learn.chatgpt.com/docs/windows/windows-app ; https://learn.chatgpt.com/docs/developer-commands?surface=cli)) — Funcțiile, planurile pentru chaturi locale și cerința Ask for approval pentru sandbox pe Windows sunt confirmate; corectate platformele și adăugată locația CODEX_HOME comună.

### Local environments (scripturi de setup și acțiuni pentru worktree-uri) (`oa-codex-local-environments`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/environments/local-environment
- **Documentație tehnică:** https://learn.chatgpt.com/docs/environments/local-environment
- **Ce face:** Configurare în folderul .codex din rădăcina proiectului pentru scripturi de setup (rulate automat la crearea worktree-urilor, per OS) și acțiuni rapide (build, test, server) în terminalul integrat.
- **Plan necesar:** Toate planurile (tabel: Local environments and repeatable actions)
- **Platformă:** Doar desktop
- **Rollout:** Disponibil
- **Eligibilitate cont:** Neconfigurat pentru acest proiect.
- **Autentificare:** n/a
- **Allowance:** Nu consumă inferență.
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul.
- **Risc de facturare API:** none
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Configurat din setările desktop; fișierul generat poate fi versionat în Git.
- **Suprafață nativă:** Setările proiectului în desktop; bara de acțiuni.
- **Cerințe locale:** Desktop app.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Opțional: acțiuni standard (npm run test:v2) pentru proprietar.
- **Suprafață de execuție:** openai.codex_desktop
- **Echivalent la celălalt ecosistem:** Nicio echivalență verificată.
- **Ce face unic / mai bine:** Setup reproductibil pentru worktree-uri.
- **Securitate:** Scripturile rulează automat (ex. npm install); orice modificare trece prin review Hub.
- **Cale de implementare:** Nicio acțiune până la cererea proprietarului.
- **Test necesar:** Niciunul.
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Instalarea de pachete prin setup scripts este interzisă în BUILD_SAFE.
- **Surse citite:** https://learn.chatgpt.com/docs/environments/local-environment
- **Verificare adversarială:** CONFIRMED — Pagina Local environments confirmă disponibilitatea doar în Codex din desktop, stocarea în folderul .codex, scripturile de setup rulate automat la crearea worktree-urilor (per OS) și acțiunile din terminalul integrat.

### Codex CLI interactiv, forma nouă (TUI reproiectat) (`oa-codex-cli-interactive`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/cli
- **Documentație tehnică:** https://learn.chatgpt.com/docs/developer-commands?surface=cli ; https://learn.chatgpt.com/docs/changelog
- **Ce face:** TUI reproiectat: ecran de bun venit compact, transcriere fullscreen (implicit din 0.157.0), /tui, teme, Mermaid și ecuații, /side, /plan, /goal, /usage, /statusline, /title, /keymap, /experimental, coadă de comenzi slash cu Tab, instant_interrupt opțional (0.159.0), editarea prompturilor anterioare.
- **Plan necesar:** Toate planurile (recap DevDay); tabel: Plus, Pro, Business, Enterprise, API key.
- **Platformă:** Windows, macOS, Linux
- **Rollout:** Stable; ultima versiune stabilă este 0.159.2, publicată pe 29.09.2026 (după 0.159.0 și 0.159.1 din aceeași zi).
- **Eligibilitate cont:** Instalat local (0.158.0-alpha.2.1), login ChatGPT.
- **Autentificare:** ChatGPT
- **Allowance:** Consum normal pe plan.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Credite existente după limită.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** codex [PROMPT] cu flaguri globale (-m, -s, -C, -c, --profile, --remote); pentru automatizare se folosesc app-server sau exec.
- **Suprafață nativă:** Terminal
- **Cerințe locale:** Terminal Windows.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Suprafața de lucru directă a proprietarului; Hub-ul nu automatizează TUI-ul.
- **Suprafață de execuție:** openai.codex_cli
- **Echivalent la celălalt ecosistem:** anthropic.claude_code_interactive.
- **Ce face unic / mai bine:** Voce, command center pentru agenți și worktree-uri în terminal.
- **Securitate:** Sesiunile interactive se pot atașa la daemonul partajat (mediu moștenit).
- **Cale de implementare:** ASSISTED: Hub-ul pregătește prompturi și AGENTS.md; sesiunile apar în oglinda thread/list.
- **Test necesar:** Niciunul.
- **Status:** AVAILABLE
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Sugestiile automate de prompt au fost eliminate în 0.159.0.
- **Surse citite:** https://learn.chatgpt.com/docs/cli · https://learn.chatgpt.com/docs/developer-commands?surface=cli · https://learn.chatgpt.com/docs/changelog · https://github.com/openai/codex/releases · local: sources-openai-devday.md
- **Verificare adversarială:** CORRECTED (corectat: rollout (https://learn.chatgpt.com/docs/changelog ; https://api.github.com/repos/openai/codex/releases)) — Funcțiile TUI (transcriere fullscreen implicită din 0.157.0, /tui, teme, Mermaid, /side, /plan, /goal, /usage, /statusline, /title, /keymap, coada cu Tab, instant_interrupt, eliminarea sugestiilor de prompt în 0.159.0) sunt confirmate; corectată doar versiunea.

### codex debug: app-server send-message-v2, models, prompt-input (`oa-gap-codex-debug-commands`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/developer-commands?surface=cli
- **Documentație tehnică:** local: codex debug --help, codex debug app-server send-message-v2 --help, codex debug models --help (0.159.0)
- **Ce face:** send-message-v2 trimite un mesaj prin fluxul V2 thread/turn al app-server folosind clientul de test intern: inițializează cu experimentalApi true, pornește un thread și o tură reală, deci consumă alocarea. debug models tipărește catalogul brut de modele; fără --bundled îl reîmprospătează de la endpointul remote (rețea, fără inferență conform documentației), iar cu --bundled citește doar catalogul inclus în binar. debug prompt-input redă lista exactă de input vizibilă modelului (instrucțiuni, context de sesiune) ca JSON; documentația nu precizează dacă pornește servere MCP sau face apeluri de rețea. Toate sunt marcate experimental.
- **Plan necesar:** send-message-v2 consumă planul; celelalte nu folosesc modelul.
- **Platformă:** Codex CLI
- **Rollout:** Experimental
- **Eligibilitate cont:** Prezente în CLI-ul local 0.159.0.
- **Autentificare:** ChatGPT OAuth pentru send-message-v2 și refresh-ul catalogului.
- **Allowance:** send-message-v2: consum real.
- **Utilizare partajată:** Alocarea comună Codex/Work.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** send-message-v2 poate consuma credite după limite.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Interzis în Hub: codex debug app-server send-message-v2 <MSG>, codex debug prompt-input. Permis doar ca citire offline: codex debug models --bundled (catalog din binar, 10 intrări în 0.159.0). Pentru catalogul live se folosește model/list din app-server, deja în allowlist.
- **Suprafață nativă:** Terminal
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Intrări pe lista de comenzi interzise a adaptorului; excepție read-only pentru catalogul bundled.
- **Suprafață de execuție:** openai.codex_cli
- **Echivalent la celălalt ecosistem:** Nu există echivalent direct în inventarul Anthropic.
- **Ce face unic / mai bine:** Catalogul bundled poate fi inspectat offline, fără cont și fără rețea.
- **Securitate:** send-message-v2 ocolește BUILD_SAFE și activează API-ul experimental; prompt-input poate expune AGENTS.md, instrucțiuni și catalogul de skills, care sunt context local sensibil.
- **Cale de implementare:** Adaugă codex debug (în afară de models --bundled) pe denylist-ul de comenzi al adaptorului și în testele V2.
- **Test necesar:** Test unitar al denylist-ului; eventual test offline pentru models --bundled.
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** În această cercetare s-a rulat doar codex debug models --bundled (offline, fără inferență); ieșirea a fost scrisă temporar într-un fișier din scratchpad, apoi fișierul a fost șters imediat.
- **Surse citite:** https://learn.chatgpt.com/docs/llms-full.txt (secțiunile codex debug) · local: codex debug * --help · local: codex debug models --bundled (offline)
- **Verificare adversarială:** CONFIRMED — developer-commands (llms-full) confirmă: send-message-v2 inițializează cu experimentalApi true, pornește un thread și o tură; debug models tipărește catalogul brut, iar --bundled omite reîmprospătarea din endpointul remote; prompt-input redă lista de input vizibilă modelului, cu PROMPT și --image opționale. Toate sunt marcate experimental. Documentația nu spune dacă prompt-input pornește MCP sau face apeluri de rețea, cum notează și recordul. Atenție: pagina de sandboxing spune că sandbox este disponibil și ca codex debug, deci denylist-ul trebuie să țintească subcomenzile, nu prefixul. Status BLOCKED și REJECT rămân corecte.

### codex doctor [--json]: raport de diagnostic redactat (instalare, config, auth, runtime, Git, app-server, inventar de fire) (`oa-gap-codex-doctor`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/developer-commands?surface=cli#cli-codex-doctor
- **Documentație tehnică:** https://github.com/openai/codex/pull/22336 ; local: codex doctor --help (0.159.0)
- **Ce face:** Generează un raport de diagnostic pentru instalare, configurație, autentificare, runtime, Git, terminal, app-server și inventarul de fire; --json emite un raport redactat, --summary doar rândurile grupate, --all extinde listele. Conform descrierii PR-ului care a introdus comanda: nu pornește daemonul app-server (îi raportează doar starea), nu lansează servere MCP stdio (doar rezolvă comanda și verifică permisiunile), face verificări de conectivitate către endpointurile providerului activ (calea ChatGPT pentru login ChatGPT) și, opțional, către servere MCP; nu face inferență; citește auth.json, dar redactează acreditările.
- **Plan necesar:** Toate planurile
- **Platformă:** Codex CLI (stabil)
- **Rollout:** Stabil în documentație; prezent local în 0.159.0.
- **Eligibilitate cont:** Disponibil local; nu a fost rulat în această cercetare (citește auth.json).
- **Autentificare:** Citește starea de autentificare existentă (redactată).
- **Allowance:** Nu consumă.
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** codex doctor --json [--summary], rulat cu același CODEX_HOME și același mediu curățat ca adaptorul; ieșirea JSON se stochează doar în auditul local.
- **Suprafață nativă:** Terminal
- **Cerințe locale:** Rețea pentru verificările de conectivitate.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Verificare de sănătate fără inferență înainte de LIVE_VALIDATION și la schimbarea versiunii binarului.
- **Suprafață de execuție:** openai.codex_cli
- **Echivalent la celălalt ecosistem:** an-cc-doctor (claude doctor, care pornește serverele stdio din .mcp.json)
- **Ce face unic / mai bine:** Raport JSON redactat, cu stare daemon, integritate SQLite și statistici de rollout.
- **Securitate:** Raportul poate conține căi, config și indicii despre autentificare; nu se trimite extern. Comportamentul descris vine dintr-un PR și poate diferi în 0.159.
- **Cale de implementare:** Wrapper read-only cu timeout, rulat doar la cererea proprietarului sau la schimbarea versiunii; parsare defensivă a JSON-ului.
- **Test necesar:** Prima rulare cu aprobarea proprietarului, cu monitorizarea proceselor copil (confirmare: fără app-server, fără MCP) și a conexiunilor de rețea.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** medium
- **Note:** Nu a fost rulat în BUILD_SAFE deoarece citește auth.json; comportamentul este preluat din documentație și din PR #22336.
- **Surse citite:** https://learn.chatgpt.com/docs/llms-full.txt (codex doctor) · https://github.com/openai/codex/pull/22336 · local: codex doctor --help
- **Verificare adversarială:** CONFIRMED — codex doctor este documentat ca stabil, cu --json (raport redactat), --summary, --all, --no-color și --ascii; help 11369540 îl menționează pentru Windows. PR #22336 (merged 2026-05-13) confirmă: fără pornirea daemonului, fără lansarea serverelor MCP stdio, fără inferență, conectivitate adaptată providerului (calea ChatGPT sau WebSocket pentru login ChatGPT) și reachability opțională prin HEAD/GET către serverele MCP HTTP. Raportul include modul de stocare a acreditărilor, calea auth.json și numele variabilelor de mediu cu chei, redactate, și semnalează autentificarea mixtă. Status AVAILABLE, WRAP și confidence medium rămân rezonabile.

### Extensia Codex pentru IDE (VS Code, Cursor, Windsurf; integrări Xcode și JetBrains) (`oa-gap-codex-ide-extension`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/codex/ide
- **Documentație tehnică:** https://learn.chatgpt.com/docs/app-server (clientInfo codex_vscode; thread/list sourceKinds) ; https://learn.chatgpt.com/docs/developer-settings?surface=ide
- **Ce face:** Extensia openai.chatgpt aduce Codex lângă editor: context din fișierele deschise și selecții, review de modificări în loc, delegare către Codex Cloud. Xcode și JetBrains IDE-uri au integrări proprii. Extensia este construită pe app-server (clientInfo codex_vscode), împarte loginul cu CLI-ul, iar thread/list include implicit sursele interactive cli și vscode, deci sesiunile IDE apar în istoricul aceluiași CODEX_HOME. Pe Windows, setarea chatgpt.runCodexInWindowsSubsystemForLinux rulează agentul în WSL2.
- **Plan necesar:** Toate planurile cu Codex
- **Platformă:** VS Code, Cursor, Windsurf (Windows/macOS/Linux); Xcode; JetBrains
- **Rollout:** GA
- **Eligibilitate cont:** Extensia nu este instalată în VS Code local (nicio intrare openai în ~/.vscode/extensions).
- **Autentificare:** ChatGPT OAuth sau API key (loginul se partajează cu CLI).
- **Allowance:** Limitele Codex
- **Utilizare partajată:** Alocarea comună Codex/Work.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Credite după limite; API key dacă proprietarul se loghează astfel în IDE.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Hub-ul nu pilotează extensia; poate citi sesiunile ei prin app-server thread/list {sourceKinds:["vscode"]} și thread/read, dacă folosește același CODEX_HOME.
- **Suprafață nativă:** Panoul Codex din editor
- **Cerințe locale:** Instalarea extensiei (acțiune a proprietarului).
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Oglindire read-only a sesiunilor IDE în istoricul Hub, fără control.
- **Suprafață de execuție:** openai.codex_ide
- **Echivalent la celălalt ecosistem:** an-cc-vscode și an-cc-jetbrains
- **Ce face unic / mai bine:** Context de editor și review în loc; aceleași fire ca CLI.
- **Securitate:** Loginul partajat: un logout sau login cu API key din IDE schimbă și ruta Hub-ului dacă CODEX_HOME este comun.
- **Cale de implementare:** Adaugă filtrul sourceKinds în oglindirea existentă (oa-codex-thread-history-mirror).
- **Test necesar:** Fără model: thread/list cu sourceKinds ["vscode"] după ce proprietarul folosește extensia.
- **Status:** DOCUMENTED
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** medium
- **Note:** executionSurface nou propus: openai.codex_ide. Oglindirea funcționează doar dacă Hub-ul și IDE-ul folosesc același CODEX_HOME.
- **Surse citite:** https://learn.chatgpt.com/docs/codex/ide.md · https://learn.chatgpt.com/docs/app-server · https://learn.chatgpt.com/docs/auth.md (login caching) · local: schema 0.159 ThreadListParams (sourceKinds) · local: ~/.vscode/extensions (extensia nu a fost găsită)
- **Verificare adversarială:** CONFIRMED — codex/ide.md confirmă extensia openai.chatgpt pentru VS Code, Cursor, Windsurf și VS Code Insiders, integrările proprii Xcode și JetBrains, contextul din editor, review-ul în loc și delegarea în cloud. App-server: thread/list cu sourceKinds are implicit cli și vscode; clientInfo codex_vscode apare în exemple. auth.md confirmă că CLI-ul și extensia împart loginul, iar un logout din oricare cere o nouă autentificare. Setarea chatgpt.runCodexInWindowsSubsystemForLinux (implicit false) este documentată. Extensia nu apare local în ~/.vscode/extensions. NATIVE_INTERACTIVE, MIRROR_STATE și DOCUMENTED sunt corecte; executionSurface openai.codex_ide este o propunere nouă.

## identity

### Sign in with ChatGPT: folosirea planului și a creditelor în aplicații terțe (`oa-siwc-plan-usage-sharing`)

- **Sursă oficială:** https://help.openai.com/articles/20001542
- **Documentație tehnică:** https://developers.openai.com/siwc/token-sharing-open-source
- **Ce face:** Plus și Pro pot permite unei aplicații participante să consume alocarea ChatGPT Work/Codex; se poate seta o limită săptămânală per aplicație; folosirea creditelor de către aplicații după epuizarea planului este OPRITĂ implicit și cere opt-in separat (plus limită de 100% pentru aplicația respectivă).
- **Plan necesar:** Plus/Pro pentru plan sharing; autentificarea simplă pentru toți.
- **Platformă:** Aplicații/site-uri partenere; Settings → Usage → App limits.
- **Rollout:** Comercial: trial limitat; plan usage pentru parteneri open-source și clienți privați selectați.
- **Eligibilitate cont:** Necunoscută. Documentația pentru plan usage acoperă aplicații open-source și găzduite local, iar cele plătite sau găzduite remote cer formular. În rollout, plan usage este pentru parteneri open-source și clienți privați selectați. Hub-ul este local, dar privat și neînregistrat. client_id-ul s-ar obține prin înregistrare dinamică, nu prin împrumut de la alt produs.
- **Autentificare:** OAuth Sign in with ChatGPT.
- **Allowance:** Limită săptămânală per aplicație ca procent din alocarea totală.
- **Utilizare partajată:** Aceeași alocare Work/Codex.
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** Dacă proprietarul activează „allow apps to use credits” și are automatic reload, pot apărea taxări automate.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Sign in with ChatGPT cu OAuth și înregistrare dinamică: client_id emis per utilizator și workspace, ext_agent_host_id persistent (URN JWK thumbprint sau urn:uuid), PKCE și callback loopback. Apoi Responses API cu Bearer access token (store: false, stream: true) sau Codex app-server cu provider personalizat (model_provider openai_chatgpt_plan, env_key ACCESS_TOKEN, requires_openai_auth=false, supports_websockets=false). Limite de preview: fără image generation, file search, Code Interpreter, computer use nativ, MCP găzduit și tool_search. model/list întoarce un catalog, nu o verificare de drept. Aplicația reîmprospătează singură tokenul.
- **Suprafață nativă:** Settings → Usage; Settings → Security and login → Login connections.
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Recomandare pentru proprietar: păstrează opțiunea de credite pentru aplicații oprită.
- **Suprafață de execuție:** openai.siwc
- **Echivalent la celălalt ecosistem:** Niciun echivalent Anthropic verificat.
- **Ce face unic / mai bine:** Control per aplicație al consumului.
- **Securitate:** Aplicațiile terțe primesc nume, e-mail, poză; deconectarea nu anulează consumul înregistrat.
- **Cale de implementare:** Niciuna în Hub; element în checklist-ul de facturare.
- **Test necesar:** Niciunul.
- **Status:** ELIGIBILITY_UNKNOWN
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Detaliile SIWC pot fi acoperite și de felia de identitate.
- **Surse citite:** https://help.openai.com/articles/20001542 (browser integrat) · https://learn.chatgpt.com/docs/whats-new/devday-2026.md · https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-personal-plans · v2/config/capabilities.json (A-siwc)
- **Verificare adversarială:** CORRECTED (corectat: status (https://developers.openai.com/siwc/token-sharing-open-source.md ; https://learn.chatgpt.com/docs/whats-new.md (DevDay: plan usage pentru parteneri open-source și clienți privați selectați)), hubDecision (https://learn.chatgpt.com/docs/app-server.md (Auth endpoints: OpenAI recomandă migrarea aplicațiilor locale de la autentificarea app-server la SIWC)), programmaticIntegration (https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server.md), programmaticDetail (https://developers.openai.com/siwc/token-sharing-open-source.md ; …/codex-app-server.md ; …/preview-limitations.md), accountEligibility (https://developers.openai.com/siwc/token-sharing-open-source.md ; https://help.openai.com/articles/20001542)) — Ruta folosește alocarea inclusă. Creditele pentru aplicații sunt oprite implicit și cer opt-in, plus limita aplicației la 100%. Limita săptămânală per aplicație ar fi chiar o gardă nativă utilă. Deci REJECT nu decurge din politica de facturare, iar REFERENCE e potrivit până se clarifică eligibilitatea și pierderea de telemetrie. Disponibilitatea account/rateLimits cu provider personalizat nu a fost verificată.

### Codex access tokens pentru automatizare de încredere (`oa-codex-access-tokens`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/enterprise/access-tokens
- **Documentație tehnică:** https://learn.chatgpt.com/docs/enterprise/access-tokens ; https://learn.chatgpt.com/docs/pricing (tabel)
- **Ce face:** Credențiale de workspace ChatGPT limitate la permisiuni Codex pentru rulări locale non-interactive (codex exec, automatizare app-server) fără login în browser; tokenul reprezintă utilizatorul care l-a creat.
- **Plan necesar:** Doar Business și Enterprise (tabel pricing: nu Plus, nu Pro).
- **Platformă:** CLI, app-server
- **Rollout:** Disponibil pe Business/Enterprise
- **Eligibilitate cont:** Neeligibil dacă planul este personal (istoric V1: prolite, neverificat).
- **Autentificare:** Token de workspace
- **Allowance:** Utilizarea workspace-ului.
- **Utilizare partajată:** Limitele workspace-ului.
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** Credite de workspace.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Creare în consola admin ChatGPT; folosit de codex exec și clienți app-server.
- **Suprafață nativă:** Consola admin ChatGPT
- **Cerințe locale:** Manager de secrete.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Nu este necesar: Hub-ul rulează pe aceeași mașină cu loginul interactiv.
- **Suprafață de execuție:** openai.codex_cli
- **Echivalent la celălalt ecosistem:** claude setup-token (token de lungă durată, necesită abonament).
- **Ce face unic / mai bine:** Identitate de workspace pentru CI.
- **Securitate:** Un token scurs permite rulări în numele creatorului.
- **Cale de implementare:** Nu se implementează.
- **Test necesar:** Niciunul.
- **Status:** PLAN_RESTRICTED
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** medium
- **Note:** Status condiționat de confirmarea planului prin account/read.
- **Surse citite:** https://learn.chatgpt.com/docs/enterprise/access-tokens · https://learn.chatgpt.com/docs/pricing · https://learn.chatgpt.com/docs/auth
- **Verificare adversarială:** CONFIRMED — Pagina Access tokens și tabelul pricing confirmă suportul doar pentru workspace-uri Business și Enterprise; în sursa open-source prolite nu este plan de workspace, deci restricția se aplică dacă planul real rămâne prolite (de confirmat prin account/read).

### Sign in with ChatGPT (doar identitate) (`oa-siwc-identity`)

- **Sursă oficială:** https://help.openai.com/en/articles/20001410-sign-in-with-chatgpt
- **Documentație tehnică:** https://developers.openai.com/siwc/quickstart
- **Ce face:** Furnizor de identitate: aplicația parteneră primește doar numele, e-mailul și poza de profil; nu primește conversații, memorie, fișiere sau date de facturare; alte accese se cer separat.
- **Plan necesar:** Global pentru utilizatorii autentificați; pentru integratori: parteneri comerciali selectați (trial limitat) sau formular de interes
- **Platformă:** OAuth/OIDC cu PKCE
- **Rollout:** Global pentru utilizatori; integrare doar pentru parteneri selectați
- **Eligibilitate cont:** Hub-ul nu este partener și nu are nevoie de federare de identitate
- **Autentificare:** OAuth 2.0/OpenID Connect (openid profile email) cu PKCE
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul
- **Risc de facturare API:** none
- **Integrare programatică:** NONE
- **Detaliu integrare:** Pentru site-urile comerciale, client_id se obține doar prin programul de parteneri (formular de interes, trial limitat). Aplicațiile open-source și cele găzduite local pot folosi înregistrarea dinamică (client_id=dynamic_agent_client, fără secret de client sau cheie de partener), care include scope-urile de identitate openid profile email. Un Hub local cu un singur proprietar nu are nevoie de federare de identitate.
- **Suprafață nativă:** Butonul Sign in/Continue with ChatGPT la parteneri (Airtable, GitLab, HubSpot, Notion, Supabase, Vercel)
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** NONE
- **Rol propus:** Niciunul
- **Suprafață de execuție:** openai.siwc
- **Echivalent la celălalt ecosistem:** Anthropic: neverificat
- **Ce face unic / mai bine:** Identitate ChatGPT reutilizabilă
- **Securitate:** n/a
- **Cale de implementare:** Niciuna
- **Test necesar:** n/a
- **Status:** NOT_APPLICABLE
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** high
- **Note:** Organizațiile controlează accesul din OpenAI Admin Console > External access.
- **Surse citite:** https://help.openai.com/en/articles/20001410-sign-in-with-chatgpt · https://developers.openai.com/siwc · https://developers.openai.com/siwc/quickstart · https://developers.openai.com/siwc/request-client-id · https://developers.openai.com/siwc/chatgpt-plugin
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://developers.openai.com/siwc/request-client-id; https://developers.openai.com/siwc/token-sharing-open-source/sign-in.md)) — Sunt confirmate: disponibilitatea globală, datele partajate (nume, e-mail, poză), partenerii inițiali și controlul prin External access. NOT_APPLICABLE rămâne corect.

### Utilizarea planului ChatGPT în alte aplicații (Sign in with ChatGPT – token sharing) (`oa-siwc-plan-usage`)

- **Sursă oficială:** https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites
- **Documentație tehnică:** https://developers.openai.com/siwc/token-sharing-open-source
- **Ce face:** După autentificare, o aplicație eligibilă poate cere permisiunea ca cererile AI să consume utilizarea Work+Codex inclusă în plan, fără cheie API; utilizatorul setează un plafon săptămânal per aplicație (procent din plan) și poate deconecta aplicația.
- **Plan necesar:** Utilizarea planului: doar Plus și Pro (conectarea la instrumente open-source suportate este permisă tuturor utilizatorilor). Integratori: documentația acoperă aplicațiile open-source și pe cele găzduite local; aplicațiile plătite sau găzduite remote completează formularul de interes. Autentificarea comercială este în trial cu parteneri selectați.
- **Platformă:** OAuth pe auth.openai.com + Responses API sau Codex app-server
- **Rollout:** Lansat cu un set limitat de parteneri (12 aplicații cu plan usage, plus integrări open-source OpenClaw, OpenCode, Pi, T3)
- **Eligibilitate cont:** Neclară, dar nu exclusă. Ghidul pentru dezvoltatori spune că documentația acoperă aplicațiile open-source și pe cele găzduite local, prin înregistrare dinamică fără secret sau cheie de partener; Hub-ul este găzduit local, dar închis. Notele de lansare limitează însă utilizarea planului la parteneri open-source și clienți privați selectați. Fără confirmare scrisă de la OpenAI, Hub-ul nu se înregistrează.
- **Autentificare:** OAuth public client cu PKCE S256; înregistrare dinamică cu client_id=dynamic_agent_client care emite un client_id oaiapp_...; redirect loopback http://127.0.0.1:<port>/auth/callback; scopes openid profile email offline_access resource.invoke chatgpt.tokens.use.direct; resource=https://api.openai.com/v1
- **Allowance:** Consumă utilizarea Work+Codex a planului; plafon săptămânal per aplicație (nu este rezervă separată)
- **Utilizare partajată:** Partajată cu ChatGPT Work, Codex și toate aplicațiile conectate
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** După epuizarea planului, aplicațiile pot folosi credite doar dacă proprietarul a permis explicit (oprit implicit) și plafonul aplicației este 100%; cu cumpărare automată activă pot apărea taxe fără notificare separată.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** GET /v1/models (visibility=list) și POST /v1/responses cu store=false și stream=true; alternativ Codex app-server cu token injectat prin variabila ACCESS_TOKEN și provider Responses. Nesuportat: computer use, file search, code interpreter, hosted MCP, background mode. Erori: subscription_sharing_user_not_eligible (403), subscription_sharing_usage_limit_exceeded (429), subscription_sharing_unsupported_capability (400) etc.; ghidul cere să nu se schimbe silențios calea de facturare.
- **Suprafață nativă:** ChatGPT Settings > Usage (limite per aplicație, opțiunea de credite); Settings > Security and login > Sign in with ChatGPT (Disconnect)
- **Cerințe locale:** Stocare protejată a tokenurilor (acces 1 oră, refresh 30 zile); host ID stabil și opac
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Nu se folosește: V2 conduce deja clientul oficial Codex app-server autentificat cu ChatGPT, care consumă același plan fără înregistrarea unui client nou.
- **Suprafață de execuție:** openai.siwc
- **Echivalent la celălalt ecosistem:** Anthropic: nicio schemă echivalentă verificată; local există `claude setup-token` (token de lungă durată pentru Claude Code, cere abonament), cu alt scop.
- **Ce face unic / mai bine:** Utilizare de abonament în aplicații terțe fără cheie API, cu plafoane per aplicație vizibile în ChatGPT.
- **Securitate:** Tokenurile de refresh dau acces la plan; nu se scriu în loguri sau git; o aplicație neeligibilă nu trebuie să reutilizeze identitatea de client a altui produs.
- **Cale de implementare:** Neimplementat. Reevaluare doar cu eligibilitate scrisă de la OpenAI pentru o aplicație privată locală.
- **Test necesar:** Niciunul
- **Status:** ELIGIBILITY_UNKNOWN
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Help-ul confirmă că deconectarea nu anulează utilizarea deja înregistrată și că reautentificarea nu restabilește limitele. OpenClaw (ruta V1 retrasă) apare ca integrare open-source eligibilă.
- **Surse citite:** https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites · https://learn.chatgpt.com/docs/sign-in-with-chatgpt.md · https://developers.openai.com/siwc/token-sharing-open-source · https://developers.openai.com/siwc/token-sharing-open-source/sign-in · https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference · https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery · https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server · https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions · https://developers.openai.com/siwc/token-sharing-open-source/token-reference · https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms · https://developers.openai.com/siwc/quickstart · https://developers.openai.com/siwc/request-client-id
- **Verificare adversarială:** CORRECTED (corectat: status (https://developers.openai.com/siwc/token-sharing-open-source; https://learn.chatgpt.com/docs/whats-new/september-28-october-2-2026.md), hubDecision (https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites), accountEligibility (https://developers.openai.com/siwc/token-sharing-open-source; https://developers.openai.com/siwc/token-sharing-open-source/sign-in.md; https://learn.chatgpt.com/docs/whats-new/september-28-october-2-2026.md), planRequired (https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites; https://developers.openai.com/siwc/token-sharing-open-source)) — Consumul se face din utilizarea Work+Codex a planului, iar creditele sunt oprite implicit, deci INCLUDED_SUBSCRIPTION_ONLY nu blochează ruta; statusul BLOCKED nu era justificat. Ruta rămâne nerecomandată, pentru că Codex app-server folosește deja planul prin clientul oficial. Sunt confirmate lista de parteneri (12 aplicații cu utilizarea planului, inclusiv Lovable „coming soon”; OpenClaw, OpenCode, Pi și T3 open-source), scope-urile, redirectul loopback /auth/callback, tokenurile de 1 oră și 30 de zile și erorile subscription_sharing_*.

### Access tokens ChatGPT (Codex, Workspace Agents) și conturi de serviciu (`oa-chatgpt-access-tokens`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/enterprise/access-tokens.md
- **Documentație tehnică:** https://learn.chatgpt.com/docs/enterprise/service-accounts.md
- **Ce face:** Tokeni personali cu expirare obligatorie (minimum o zi) pentru automatizarea Codex CLI/app-server sau pentru Workspace Agents API; conturile de serviciu rulează fluxuri Codex headless cu identitate proprie (CODEX_ACCESS_TOKEN, CLI ≥ 0.142.0).
- **Plan necesar:** Tokeni Codex: Business și Enterprise; conturi de serviciu: doar planuri pay-as-you-go
- **Platformă:** chatgpt.com/admin
- **Rollout:** Disponibil
- **Eligibilitate cont:** Neeligibil pe un plan individual
- **Autentificare:** Token de acces ChatGPT scoped
- **Allowance:** Workspace
- **Utilizare partajată:** Workspace
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** Conturile de serviciu cer plan pay-as-you-go
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** CODEX_ACCESS_TOKEN pentru Codex CLI; scope Workspace Agents pentru api.chatgpt.com.
- **Suprafață nativă:** Admin > Access tokens; Admin > Service accounts
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință; V2 folosește login-ul interactiv ChatGPT al Codex.
- **Suprafață de execuție:** openai.chatgpt_admin
- **Echivalent la celălalt ecosistem:** Anthropic: `claude setup-token` (token de lungă durată, cere abonament)
- **Ce face unic / mai bine:** Automatizare headless cu identitate de workspace și audit
- **Securitate:** Tokenurile nu pot fi recuperate după generare; stocare în manager de secrete.
- **Cale de implementare:** Niciuna
- **Test necesar:** n/a
- **Status:** PLAN_RESTRICTED
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Cheile API și conturile de serviciu ale platformei API au facturare separată.
- **Surse citite:** https://learn.chatgpt.com/docs/enterprise/access-tokens.md · https://learn.chatgpt.com/docs/enterprise/service-accounts.md · https://developers.openai.com/workspace-agents/authentication.md
- **Verificare adversarială:** CONFIRMED — Learn access-tokens și service-accounts confirmă: tokeni doar pentru Business și Enterprise, fereastra minimă de o zi, tokenul se afișează o singură dată, conturi de serviciu doar pe planuri pay-as-you-go, CODEX_ACCESS_TOKEN cu CLI ≥ 0.142.0. Pagina de prețuri arată tokenii de automatizare ca indisponibili pe Plus/Pro.

### Politica OpenAI pentru autentificarea Codex app-server în aplicații proprii (local/open source tolerat, comercial/găzduit interzis) (`oa-gap-app-server-auth-policy`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/app-server (secțiunea Auth endpoints)
- **Documentație tehnică:** https://learn.chatgpt.com/docs/app-server.md ; https://learn.chatgpt.com/docs/sign-in-with-chatgpt.md ; https://learn.chatgpt.com/docs/auth.md
- **Ce face:** Pagina app-server precizează că aplicațiile locale sau open source care folosesc autentificarea Codex app-server pot fi folosite în continuare, dar OpenAI recomandă migrarea la Sign in with ChatGPT, care oferă utilizatorului control și vizibilitate asupra consumului. Autentificarea app-server nu a fost niciodată permisă pentru servicii comerciale sau găzduite. Moduri de autentificare documentate: chatgpt (Codex deține fluxul OAuth și reîmprospătează tokenurile), chatgptDeviceCode, apiKey, chatgptAuthTokens (experimental, pentru aplicații-gazdă care dețin ciclul de viață al tokenurilor) și Amazon Bedrock; account/updated.authMode poate raporta și agentIdentity, personalAccessToken sau bedrockApiKey. initialize.clientInfo.name identifică integrarea în OpenAI Compliance Logs.
- **Plan necesar:** Orice plan ChatGPT care include Codex. Conform help center, Codex este inclus în toate planurile, inclusiv Free și Go. Politica de autentificare nu depinde de plan.
- **Platformă:** Windows, macOS, Linux (app-server local, stdio sau WebSocket)
- **Rollout:** Politică publicată pe pagina tehnică, citită la 2026-09-30; SIWC pentru integratori are listă de așteptare pentru parteneri.
- **Eligibilitate cont:** Contul proprietarului este autentificat cu ChatGPT (codex login status: Logged in using ChatGPT); nivelul exact al planului nu este verificat în V2.
- **Autentificare:** ChatGPT managed OAuth deținut de Codex; Hub-ul nu apelează account/login/* și nu furnizează tokenuri (chatgptAuthTokens blocat).
- **Allowance:** Firele Hub consumă limitele Codex/ChatGPT Work ale planului (ferestre de 5 ore și săptămânale).
- **Utilizare partajată:** Comun cu Codex desktop, CLI, extensia IDE, ChatGPT Work și add-in-urile Office.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** După epuizarea limitelor se pot consuma credite ChatGPT dacă proprietarul are sold; V2 blochează ruta la sold pozitiv sau nelimitat raportat de account/rateLimits/read.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** codex app-server --listen stdio:// (transport implicit; --stdio este alias) ; initialize {clientInfo:{name,title,version}} ; account/read → account.type = chatgpt ; account/updated.authMode = chatgpt. Rămân în afara allowlist-ului Hub: account/login/start, account/login/cancel, account/logout, account/chatgptAuthTokens/refresh, dar și account/sendAddCreditsNudgeEmail (cere ChatGPT să trimită un email proprietarului workspace-ului, deci este mesaj extern) și account/rateLimitResetCredit/consume (consumă o resetare câștigată a limitelor). account/rateLimits/read și account/usage/read sunt doar citiri.
- **Suprafață nativă:** Codex CLI, ChatGPT desktop (Codex), extensia IDE folosesc aceeași autentificare stocată.
- **Cerințe locale:** Codex CLI local (bundle desktop: codex-cli 0.159.0 la 2026-09-30) și un login ChatGPT existent.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Condiție de conformitate pentru adaptorul Codex (WRAP deja implementat): Hub-ul rămâne aplicație locală pe 127.0.0.1, pentru un singur proprietar și propriul său cont; nu este expus ca serviciu găzduit, nu este oferit clienților și nu partajează ruta Codex cu alți utilizatori.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** an-subscription-oauth-policy (politica Anthropic pentru OAuth de abonament și Agent SDK)
- **Ce face unic / mai bine:** Permite folosirea abonamentului prin harness-ul oficial open source, fără cheie API; SIWC adaugă o limită săptămânală per aplicație, exprimată ca procent din plan și setată de utilizator.
- **Securitate:** Risc de neconformitate dacă Hub-ul devine multi-utilizator, găzduit sau folosit pentru clienți. Formularea despre continuarea utilizării poate fi citită ca toleranță pentru aplicații existente, iar OpenAI o poate restrânge. clientInfo trebuie să identifice onest Hub-ul.
- **Cale de implementare:** 1) Păstrează bind-ul 127.0.0.1 și un singur cont ChatGPT. 2) Setează clientInfo.name stabil și onest (de exemplu ifrim_agent_hub). 3) Documentează politica în V2_SUBSCRIPTION_POLICY.md. 4) Reevaluează SIWC când devine accesibil integratorilor; până atunci V2 păstrează app-server.
- **Test necesar:** Verificare statică (fără model): bind local, clientInfo, refuzul metodelor de login și logout, refuzul conturilor apiKey.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** medium
- **Note:** Politica apare pe pagina tehnică app-server; Terms of Use și Services Agreement nu au fost citite. Rămâne de clarificat dacă uzul intern al unei firme (Ifrim Digital) intră sub noțiunea de serviciu comercial; textul vizează serviciile comerciale sau găzduite oferite altora.
- **Surse citite:** https://learn.chatgpt.com/docs/app-server · https://learn.chatgpt.com/docs/sign-in-with-chatgpt.md · https://learn.chatgpt.com/docs/auth.md · local: codex --help / codex login --help (0.159.0)
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://learn.chatgpt.com/docs/app-server.md (Auth endpoints → API overview)), planRequired (https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)) — Am confirmat textul politicii în secțiunea Auth endpoints: aplicațiile locale sau open source pot continua, se recomandă migrarea la SIWC, iar uzul comercial sau găzduit nu a fost permis niciodată. Am confirmat și modurile apikey, chatgpt, chatgptDeviceCode, chatgptAuthTokens (experimental) și Bedrock, valorile authMode (agentIdentity, personalAccessToken, bedrockApiKey) și rolul clientInfo.name în Compliance Logs. Pagina SIWC confirmă limita săptămânală per aplicație, exprimată ca procent din plan, și faptul că folosirea planului prin aplicații terțe este pentru Plus și Pro eligibili. Corecția adaugă două metode noi cu efect lateral, documentate acum, care trebuie excluse. Status, hubDecision și apiBillingRisk rămân valabile.

### Precedența autentificării Codex și variabilele de mediu care schimbă identitatea sau facturarea (CODEX_API_KEY, CODEX_ACCESS_TOKEN, workload identity) + forced_login_method per proces (`oa-gap-codex-auth-precedence-env`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/config-file/environment-variables
- **Documentație tehnică:** https://learn.chatgpt.com/docs/auth.md ; https://learn.chatgpt.com/docs/non-interactive-mode.md ; https://learn.chatgpt.com/docs/config-file/config-reference.md
- **Ce face:** Variabile documentate care schimbă identitatea sau facturarea: CODEX_API_KEY (exec, review, TypeScript SDK, exec-server --remote; poate folosi altă cheie API pentru o singură rulare), CODEX_ACCESS_TOKEN (CLI, app-server, automatizare de încredere; tokenuri de acces Enterprise), OPENAI_FEDERATION_RULE_ID și OPENAI_IDENTITY_TOKEN_FILE (workload identity: mediul procesului controlează autentificarea, iar codex login și codex logout sunt refuzate). OPENAI_WORKLOAD_IDENTITY_CONTEXT oferă doar identificatori JSON pentru atribuire în audit și, conform documentației, nu afectează autentificarea sau autorizarea. CODEX_HOME (config, auth, loguri, sesiuni, skills; directorul trebuie să existe), CODEX_SQLITE_HOME, CODEX_CA_CERTIFICATE și SSL_CERT_FILE schimbă locul stării sau lanțul TLS, nu identitatea. Se adaugă variabila numită de env_key la providerii custom, lanțul de acreditări AWS pentru Bedrock și OPENAI_API_KEY (exemplu pentru login --with-api-key; ghidul de imagini îl sugerează pentru loturi mari prin API). Documentația nu publică o ordine completă de precedență. Cheia forced_login_method = "chatgpt" \| "api" din config.toml restrânge metoda: dacă acreditările active nu corespund, Codex deloghează utilizatorul și se oprește.
- **Plan necesar:** n/a
- **Platformă:** Windows, macOS, Linux
- **Rollout:** GA (pagini citite la 2026-09-30); workload identity și access tokens sunt orientate spre Enterprise.
- **Eligibilitate cont:** Login ChatGPT activ pe mașină; nu s-au citit auth.json sau variabilele de mediu ale proprietarului.
- **Autentificare:** ChatGPT OAuth (țintă); API key, access token, workload identity, Bedrock sunt rute de refuzat.
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** O variabilă CODEX_API_KEY sau OPENAI_API_KEY moștenită mută facturarea pe API; CODEX_ACCESS_TOKEN sau workload identity schimbă identitatea (alt cont sau workspace).
- **Risc de facturare API:** high
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Per proces copil, fără schimbare globală: (a) mediu construit prin allowlist, fără CODEX_API_KEY, CODEX_ACCESS_TOKEN, OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_FEDERATION_RULE_ID, OPENAI_IDENTITY_TOKEN_FILE, OPENAI_WORKLOAD_IDENTITY_CONTEXT, AWS_*, AZURE_OPENAI_API_KEY și orice nume env_key; (b) codex app-server -c forced_login_method="chatgpt" (flagul -c este documentat generic pe app-server; onorarea acestei chei prin -c nu a fost testată); (c) după initialize: account/read → type chatgpt și account/updated.authMode = chatgpt, altfel oprire înainte de thread/start. forced_login_method funcționează cu OAuth ChatGPT, deoarece valoarea chatgpt este exact metoda dorită.
- **Suprafață nativă:** codex login status; profilul din desktop/IDE.
- **Cerințe locale:** Controlul mediului procesului copil în adaptorul V2; alegerea explicită a CODEX_HOME.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Politică explicită de curățare a mediului pentru adaptorul Codex, dublată de forced_login_method per proces și de verificarea authMode după handshake.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** an-auth-precedence (Claude Code: abonament vs chei API)
- **Ce face unic / mai bine:** Refuz nativ la nepotrivirea metodei de login; workload identity blochează login și logout când identitatea vine din mediu.
- **Securitate:** forced_login_method cu acreditări nepotrivite declanșează logout: într-un CODEX_HOME partajat cu desktop-ul poate șterge loginul proprietarului, deci se testează doar într-un CODEX_HOME izolat. Un CODEX_HOME gol nu izolează skill-urile din $HOME/.agents/skills. Cu feature-ul secret_auth_storage activ, locul real al acreditărilor (keyring sau fișier) trebuie confirmat.
- **Cale de implementare:** 1) Allowlist de variabile pentru copil (PATH, SystemRoot, TEMP, USERPROFILE, CODEX_HOME ales etc.). 2) Adăugare -c forced_login_method="chatgpt". 3) Verificare authMode și account.type după initialize. 4) Test unitar care injectează variabile interzise și confirmă că lipsesc din mediul copilului.
- **Test necesar:** Test unitar al constructorului de mediu (fără model); test de integrare fără inferență în CODEX_HOME izolat pentru comportamentul forced_login_method prin -c.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** medium
- **Note:** V2 a folosit un CODEX_HOME gol la handshake; trebuie clarificat dacă firele reale folosesc CODEX_HOME-ul proprietarului sau unul dedicat Hub-ului, cu login separat făcut de proprietar. Dovadă suplimentară (PR openai/codex #22336, codex doctor): la login ChatGPT plus o variabilă cu cheie API în mediu, doctor raportează semnale de autentificare mixte și testează conectivitatea în modul API key. Asta confirmă că o variabilă moștenită poate schimba modul efectiv. OPENAI_WORKLOAD_IDENTITY_CONTEXT poate rămâne pe denylist din prudență, dar nu este un vector de identitate.
- **Surse citite:** https://learn.chatgpt.com/docs/config-file/environment-variables.md · https://learn.chatgpt.com/docs/auth.md · https://learn.chatgpt.com/docs/non-interactive-mode.md · https://learn.chatgpt.com/docs/image-generation.md · https://learn.chatgpt.com/docs/app-server · local: codex login --help (0.159.0)
- **Verificare adversarială:** CORRECTED (corectat: whatItDoes (https://learn.chatgpt.com/docs/config-file/environment-variables.md ; https://learn.chatgpt.com/docs/auth.md), notes (https://github.com/openai/codex/pull/22336 ; https://learn.chatgpt.com/docs/config-file/environment-variables.md)) — Am confirmat CODEX_API_KEY, CODEX_ACCESS_TOKEN, OPENAI_FEDERATION_RULE_ID, OPENAI_IDENTITY_TOKEN_FILE, CODEX_HOME, CODEX_SQLITE_HOME, CODEX_CA_CERTIFICATE și SSL_CERT_FILE în pagina oficială. Refuzul login și logout sub workload identity și comportamentul forced_login_method (logout + exit) apar în auth.md. Local, codex app-server 0.159.0 acceptă -c, --enable și --disable. OPENAI_BASE_URL și AZURE_OPENAI_API_KEY nu sunt variabile Codex documentate, dar pot rămâne pe denylist ca precauție. Corecția: OPENAI_WORKLOAD_IDENTITY_CONTEXT nu schimbă identitatea.

## security

### Private Intelligence: Zero Data Retention cu Private Safety Processing (ZDR with PSP) (`oa-private-safety-processing`)

- **Sursă oficială:** https://developers.openai.com/api/docs/guides/private-safety-processing
- **Documentație tehnică:** https://openaiassets.blob.core.windows.net/$web/pdf/c7284810-2252-462f-803e-075b0c95bccb/psp-whitepaper.pdf
- **Ce face:** Pentru proiecte API: interacțiunile selectate pentru revizuirea de siguranță sunt criptate dublu (HPKE OpenAI + EKM client) și stocate în storage-ul clientului (S3, Azure Blob, GCS) cu TTL 30 de zile; revizuirea automată rulează într-un runtime atestat hardware fără acces uman; OpenAI păstrează doar un index cu metadate.
- **Plan necesar:** Organizații API aprobate pentru ZDR; activare per proiect de un admin de organizație.
- **Platformă:** OpenAI API Platform + cloud-ul clientului.
- **Rollout:** Disponibil pentru organizații ZDR aprobate.
- **Eligibilitate cont:** Neaplicabil: Hub-ul nu folosește API Platform.
- **Autentificare:** Admin API key de organizație (Management API) sau consola API.
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Facturare API + costuri de storage cloud.
- **Risc de facturare API:** high
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** POST /v1/organization/external_storage, POST …/{id}/validate (Admin API key).
- **Suprafață nativă:** Organization settings → Data controls → Data retention.
- **Cerințe locale:** Cont cloud + EKM.
- **Relevanță pentru Hub:** NONE
- **Rol propus:** Niciunul.
- **Suprafață de execuție:** openai.api_platform
- **Echivalent la celălalt ecosistem:** ZDR Anthropic pentru API (felia Anthropic).
- **Ce face unic / mai bine:** Revizuire de siguranță fără retenție la OpenAI și fără acces uman.
- **Securitate:** n/a pentru Hub.
- **Cale de implementare:** Niciuna.
- **Test necesar:** Niciunul.
- **Status:** NOT_APPLICABLE
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** high
- **Note:** Politica PSP se aplică întregului trafic al proiectului; unele modele cer ZDR with PSP.
- **Surse citite:** https://developers.openai.com/api/docs/guides/private-safety-processing.md · scratchpad/sources-openai-devday.md (recap Private Intelligence)
- **Verificare adversarială:** CONFIRMED — Ghidul a fost citit și confirmă: dublă criptare (HPKE plus strat EKM, recomandat), runtime atestat hardware fără acces uman, TTL de 30 de zile, index doar cu metadate, activare per proiect de un admin cu Admin API key, politică aplicată întregului trafic al proiectului, POST /v1/organization/external_storage și /validate.

### Private Inference (preview, confidential computing) (`oa-private-inference`)

- **Sursă oficială:** https://openai.com/index/devday-2026-recap/
- **Documentație tehnică:** Nicio pagină tehnică publică găsită
- **Ce face:** Anunțat la DevDay ca preview de inferență bazată pe confidential computing, parte din Private Intelligence pentru companii.
- **Plan necesar:** Orientat spre enterprise; condiții nepublicate.
- **Platformă:** API (presupus).
- **Rollout:** Preview.
- **Eligibilitate cont:** Neaplicabil.
- **Autentificare:** Necunoscută.
- **Allowance:** Necunoscută.
- **Utilizare partajată:** Necunoscută.
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Necunoscut.
- **Risc de facturare API:** high
- **Integrare programatică:** UNKNOWN
- **Detaliu integrare:** Nedocumentat public.
- **Suprafață nativă:** n/a
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** NONE
- **Rol propus:** Niciunul.
- **Suprafață de execuție:** openai.api_platform
- **Echivalent la celălalt ecosistem:** n/a
- **Ce face unic / mai bine:** n/a
- **Securitate:** n/a
- **Cale de implementare:** Niciuna.
- **Test necesar:** Niciunul.
- **Status:** DOCUMENTED
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** low
- **Note:** Doar din recapitulare; fără documentație tehnică publică.
- **Surse citite:** scratchpad/sources-openai-devday.md (recap) · https://developers.openai.com/api/docs/llms.txt (fără rezultat) · https://developers.openai.com/api/llms-full.txt (căutare fără rezultat)
- **Verificare adversarială:** CONFIRMED — Secțiunea Private Intelligence din recapitularea citită direct confirmă doar anunțul unui preview bazat pe calcul confidențial. llms.txt și llms-full.txt pentru API nu conțin documentație despre Private Inference.

### Metode app-server cu efecte laterale (resetare limită, e-mail către owner, feedback, scriere config, shell în afara sandbox-ului, ștergere) (`oa-codex-app-server-side-effect-methods`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/app-server
- **Documentație tehnică:** https://learn.chatgpt.com/docs/app-server (API overview)
- **Ce face:** account/rateLimitResetCredit/consume consumă o resetare câștigată; account/sendAddCreditsNudgeEmail cere ChatGPT să trimită e-mail proprietarului workspace-ului; feedback/upload trimite rapoarte și loguri; config/value/write, config/batchWrite, marketplace/add, plugin/install, skills/config/write, externalAgentConfig/import modifică configurația; thread/shellCommand și process/spawn rulează în afara sandbox-ului; thread/delete șterge definitiv.
- **Plan necesar:** n/a
- **Platformă:** Orice platformă cu codex app-server
- **Rollout:** Documentate; process/* experimentale; plugin/install marcat ca în dezvoltare.
- **Eligibilitate cont:** n/a
- **Autentificare:** ChatGPT
- **Allowance:** Nu consumă inferență direct, dar consumă beneficii ale contului sau produc efecte externe.
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** E-mailul de tip nudge poate determina cumpărarea de credite; consumul unei resetări folosește un beneficiu al contului; account/login/start cu apiKey sau scrierile de config care schimbă model_provider ori service_tier ar muta consumul pe facturare API sau l-ar accelera.
- **Risc de facturare API:** high
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Metode de blocat explicit în clientul Hub: account/login/start (mai ales type apiKey, care mută facturarea pe API, și chatgptAuthTokens), account/logout, account/rateLimitResetCredit/consume, account/sendAddCreditsNudgeEmail, feedback/upload, config/value/write și config/batchWrite (pot schimba model_provider, service_tier sau aprobările), marketplace/add\|remove\|upgrade, plugin/install\|uninstall, skills/config/write, externalAgentConfig/import, experimentalFeature/enablement/set, windowsSandbox/setupStart, thread/shellCommand, command/exec (acceptă și dangerFullAccess sau externalSandbox) cu command/exec/write\|resize\|terminate, process/spawn\|writeStdin\|resizePty\|kill, thread/inject_items, thread/backgroundTerminals/*, mcpServer/tool/call, mcpServer/oauth/login, fs/writeFile\|createDirectory\|remove\|copy, thread/delete, thread/rollback (depreciat).
- **Suprafață nativă:** TUI și desktop (/usage pentru resetări, setări).
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Listă de refuz obligatorie în adapterul Codex al Hub-ului.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** anthropic: lista de flaguri interzise din adapterul Claude V2 (--bare, --dangerously-skip-permissions, --max-budget-usd, --fallback-model).
- **Ce face unic / mai bine:** n/a
- **Securitate:** Execuție în afara sandbox-ului, modificarea persistentă a configurației, trimitere de loguri și e-mailuri, ștergere ireversibilă.
- **Cale de implementare:** Allowlist implicit-refuz; orice metodă nouă apărută în schema regenerată este refuzată până la revizuire.
- **Test necesar:** Test simulat: clientul refuză local aceste metode înainte de a scrie pe stdin.
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Politica se aplică și conexiunilor către daemonul partajat.
- **Surse citite:** https://learn.chatgpt.com/docs/app-server
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://learn.chatgpt.com/docs/app-server), apiBillingRisk (https://learn.chatgpt.com/docs/app-server (Authentication modes: apikey) ; https://learn.chatgpt.com/docs/auth), extraBillingRisk (https://learn.chatgpt.com/docs/app-server ; https://learn.chatgpt.com/docs/agent-configuration/speed)) — Toate metodele din record există și au efectele descrise (ieșire din sandbox pentru thread/shellCommand și process/*, ștergere definitivă, e-mail către owner). Lista omitea metodele cu impact direct asupra facturării (login cu API key, scrieri de config), deci riscul grupului este high dacă nu sunt blocate.

### Auto-review al aprobărilor (approvals_reviewer = auto_review) (`oa-codex-auto-review`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/sandboxing/auto-review
- **Documentație tehnică:** https://learn.chatgpt.com/docs/sandboxing/auto-review ; https://learn.chatgpt.com/docs/developer-commands?surface=cli (/approve)
- **Ce face:** Înlocuiește aprobarea umană la granița sandbox-ului cu un agent reviewer separat care decide și motivează; nu extinde permisiunile; se aplică doar când aprobările sunt interactive; /approve reîncearcă o dată o acțiune refuzată.
- **Plan necesar:** Toate planurile (tabel: Auto-review for approval requests)
- **Platformă:** CLI, desktop
- **Rollout:** Disponibil
- **Eligibilitate cont:** Flag local guardian_approval=true.
- **Autentificare:** ChatGPT
- **Allowance:** Reviewerul este un agent separat; consumul exact nu este precizat în pagina citită.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Posibil consum suplimentar la fiecare cerere de aprobare.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** config: approvals_reviewer = auto_review cu approval_policy on-request; cu approval_policy never nu se aplică.
- **Suprafață nativă:** Selectorul de permisiuni (Auto-review) în desktop/TUI.
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Nefolosit pentru firele Hub: aprobările rămân la politica Hub și la proprietar.
- **Suprafață de execuție:** openai.codex_cli
- **Echivalent la celălalt ecosistem:** Claude Code --permission-mode auto și claude auto-mode critique.
- **Ce face unic / mai bine:** Reduce întreruperile în sesiunile interactive ale proprietarului.
- **Securitate:** Delegarea deciziilor de aprobare către un model contravine regulii Hub ca aprobările să fie umane/politice.
- **Cale de implementare:** Setează reviewerul pe utilizator pentru firele Hub și tratează requestApproval în Hub.
- **Test necesar:** config/read (fără inferență).
- **Status:** AVAILABLE
- **Decizie Hub:** REJECT
- **Încredere:** medium
- **Note:** Decizia se referă doar la firele rulate de Hub.
- **Surse citite:** https://learn.chatgpt.com/docs/sandboxing/auto-review · https://learn.chatgpt.com/docs/developer-commands?surface=cli · https://learn.chatgpt.com/docs/pricing
- **Verificare adversarială:** CONFIRMED — Pagina Auto-review și referința de configurare confirmă approvals_reviewer = user \| auto_review (implicit user), aplicarea doar cu aprobări interactive, /approve pentru o singură reîncercare și circuit breaker-ul; reviewerul este un agent Codex separat, iar consumul lui nu este cuantificat.

### Codex Security Review pentru PR-uri GitHub (@codex security review) (`oa-codex-security-review-pr`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/security/security-review
- **Documentație tehnică:** https://learn.chatgpt.com/docs/security/security-review ; https://learn.chatgpt.com/docs/third-party/github
- **Ce face:** Review de securitate mai profund decât Code Review, pe diff, context de repo și threat model sau ghiduri de securitate; automat sau la cerere.
- **Plan necesar:** Enterprise, Business, Edu și Pro; nu Plus.
- **Platformă:** GitHub + Codex cloud
- **Rollout:** Research preview
- **Eligibilitate cont:** Probabil eligibil dacă planul este un nivel Pro; neverificat.
- **Autentificare:** ChatGPT + repo GitHub conectat
- **Allowance:** Consumă alocarea Codex inclusă sau credite ChatGPT.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Poate consuma credite după limită.
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Configurare în setările Codex; comentariu @codex security review; necesită Codex cloud cu repo conectat și drept push/admin.
- **Suprafață nativă:** GitHub
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Poartă suplimentară de securitate pe PR-uri, activată de proprietar.
- **Suprafață de execuție:** openai.codex_security
- **Echivalent la celălalt ecosistem:** Nicio echivalență inclusă verificată.
- **Ce face unic / mai bine:** Threat model per repo și praguri de raportare.
- **Securitate:** Codul analizat în cloud; lipsa constatărilor nu dovedește securitatea.
- **Cale de implementare:** Proprietarul activează; Hub-ul leagă constatările de misiune.
- **Test necesar:** Niciunul automat.
- **Status:** ELIGIBILITY_UNKNOWN
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Planul exact se confirmă prin account/read.
- **Surse citite:** https://learn.chatgpt.com/docs/security/security-review · https://learn.chatgpt.com/docs/third-party/github
- **Verificare adversarială:** CONFIRMED — Pagina Security Review confirmă disponibilitatea pentru Enterprise, Business, Edu și Pro (nu Plus), consumul din alocarea Codex sau din credite, cerința Codex cloud cu repo GitHub conectat și drept push/admin; pagina GitHub o marchează research preview. Constatările postate moștenesc vizibilitatea PR-ului.

### Plugin Codex Security (scanări locale într-un task Codex) (`oa-codex-security-plugin-local`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/security/plugin
- **Documentație tehnică:** https://learn.chatgpt.com/docs/security/plugin ; https://learn.chatgpt.com/docs/security/faq
- **Ce face:** Scanări standard și deep ale depozitului local, evaluarea schimbărilor (PR, commit, interval), triere, rapoarte de vulnerabilitate, propuneri de hardening, export JSON/CSV/SARIF și către GitHub/Jira/Linear; ieșiri report.md, findings/, hardening/.
- **Plan necesar:** Pagina nu precizează planul.
- **Platformă:** Desktop și CLI
- **Rollout:** Disponibil; scanările din Security CLI cer acces beta.
- **Eligibilitate cont:** Pluginul nu apare în codex plugin list local.
- **Autentificare:** ChatGPT
- **Allowance:** Rulează ca task Codex, deci consumă din plan (deduction, nu declarație explicită); scanările deep durează mult.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** unknown
- **Risc de facturare suplimentară (credite/extra usage):** Scanări mari pot epuiza alocarea.
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Instalare din Plugins (desktop) sau /plugins → Install plugin (CLI); pagina recomandă gpt-5.6-sol cu efort xhigh.
- **Suprafață nativă:** Security în bara laterală a desktopului (workbench).
- **Cerințe locale:** Instalarea pluginului (schimbare de configurație, cere aprobare).
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Scanări de securitate native la cererea proprietarului; constatările importate în Hub.
- **Suprafață de execuție:** openai.codex_security
- **Echivalent la celălalt ecosistem:** Claude Code security-review (neverificat în dovezile locale).
- **Ce face unic / mai bine:** Validare a constatărilor și export SARIF.
- **Securitate:** Scanarea citește tot codul; exporturile către trackere externe cer aprobare.
- **Cale de implementare:** După aprobarea instalării: rulare de către proprietar, import report.md/findings în Hub.
- **Test necesar:** Niciunul până la instalare aprobată.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Un rezumat automat al paginii a afirmat consum de API tokens; textul brut verificat nu conține această afirmație.
- **Surse citite:** https://learn.chatgpt.com/docs/security/plugin · https://learn.chatgpt.com/docs/security/faq
- **Verificare adversarială:** CONFIRMED — Pagina pluginului confirmă instalarea din Plugins (marketplace openai-curated) sau /plugins în CLI, recomandarea gpt-5.6-sol cu xhigh, fișierele report.md, findings/, hardening/ și JSON-urile structurate, exporturile JSON/CSV/SARIF și către Linear/GitHub/Jira cu aprobare; planul nu este precizat.

### Codex Security CLI și SDK (npx @openai/codex-security) (`oa-codex-security-cli`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/security/cli
- **Documentație tehnică:** https://learn.chatgpt.com/docs/security/cli/faq ; https://learn.chatgpt.com/docs/security/cli/reference ; https://learn.chatgpt.com/docs/security/sdk
- **Ce face:** Scanări din linia de comandă (scan, --mode deep, --patch, bulk-scan, scans list/compare, findings list/false-positive, install-hook) cu ieșiri report.md, findings.json, coverage.json, scan-manifest.json, results.sarif.
- **Plan necesar:** Acces Codex Security (beta); recomandat Trusted Access for Cyber.
- **Platformă:** Node 22.13+/24/26, Python 3.10+, Git
- **Rollout:** Beta
- **Eligibilitate cont:** Acces beta necunoscut.
- **Autentificare:** ChatGPT, device auth, access token, OPENAI_API_KEY/CODEX_API_KEY, Bedrock, OpenRouter/Fireworks
- **Allowance:** Cu --auth chatgpt: alocarea planului (nedetaliat); cu cheie API: facturare API.
- **Utilizare partajată:** Alocarea comună a planului când se folosește ChatGPT.
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** Dacă OPENAI_API_KEY sau CODEX_API_KEY există în mediu, scanările non-TTY și JSON folosesc implicit cheia API chiar după login ChatGPT; --max-cost este doar estimare, nu plafon.
- **Risc de facturare API:** high
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** npx @openai/codex-security scan <repo> --auth chatgpt --json [--mode deep] [--diff origin/main --head HEAD] [--working-tree --base HEAD] [--output-dir] [--model] [--effort] [--dry-run].
- **Suprafață nativă:** Terminal cu dashboard live
- **Cerințe locale:** Descărcarea pachetului prin npx (interzisă acum), Python 3.10+.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Posibil scanner programatic după aprobare și confirmarea accesului.
- **Suprafață de execuție:** openai.codex_security_cli
- **Echivalent la celălalt ecosistem:** Nicio echivalență inclusă verificată.
- **Ce face unic / mai bine:** Ieșiri structurate și comparare între scanări.
- **Securitate:** Instalare de pachet extern prin npx; risc de facturare API implicită (--auth auto alege cheia din mediu la rulări non-TTY și JSON); scanările rulează cu permisiunile locale ale sistemului, fără pauze de aprobare, și moștenesc mediul, inclusiv credențialele; logurile scans logs nu sunt redactate; hook-ul pre-commit modifică repo-ul.
- **Cale de implementare:** Doar după aprobarea instalării și confirmarea accesului: --auth chatgpt, mediu fără chei API, --dry-run întâi.
- **Test necesar:** --dry-run după instalare aprobată.
- **Status:** ELIGIBILITY_UNKNOWN
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** SDK-ul TypeScript Codex Security este tot în beta.
- **Surse citite:** https://learn.chatgpt.com/docs/security/cli · https://learn.chatgpt.com/docs/security/cli/faq · https://learn.chatgpt.com/docs/codex-sdk
- **Verificare adversarială:** CORRECTED (corectat: securityConcerns (https://learn.chatgpt.com/docs/security/cli ; https://learn.chatgpt.com/docs/security/cli/faq ; https://learn.chatgpt.com/docs/security/cli/reference)) — Cerințele Node 22.13+/24/26 și Python 3.10+, metodele de autentificare, flagurile --diff/--head/--working-tree/--base/--mode/--dry-run și faptul că --max-cost este doar o estimare sunt confirmate. apiBillingRisk high rămâne o încadrare conservatoare: cu --auth chatgpt și mediu curat rularea folosește contul ChatGPT, dar încadrarea în plan nu este documentată.

### Codex Security Cloud (scanări cloud pentru depozite GitHub conectate) (`oa-codex-security-cloud`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/security/setup
- **Documentație tehnică:** https://learn.chatgpt.com/docs/security ; https://learn.chatgpt.com/docs/security/faq
- **Ce face:** Plugin web/desktop: conectezi un repo GitHub și un mediu cloud compatibil, pornești scanări la cerere sau monitorizezi commiturile noi (zile de istoric, pauză), editezi threat model-ul; auto-validarea reproduce problemele în container izolat, iar patch-urile propuse devin draft PR după review.
- **Plan necesar:** Conflict: recapul DevDay spune toți utilizatorii Codex; tabelul pricing bifează funcția doar la Enterprise/Edu; What's new: research preview pentru workspace-uri cu acces.
- **Platformă:** Cloud OpenAI + GitHub
- **Rollout:** Research preview (29.09.2026)
- **Eligibilitate cont:** Necunoscută
- **Autentificare:** ChatGPT + GitHub
- **Allowance:** Nedocumentat în paginile citite; tabelul de credite include Daybreak Blue la tarifele GPT-5.6 Sol.
- **Utilizare partajată:** Necunoscut
- **Inclus în abonament?:** unknown
- **Risc de facturare suplimentară (credite/extra usage):** Daybreak cere aprobare Trusted Access for Cyber; consum pe credite posibil.
- **Risc de facturare API:** unknown
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Doar prin pluginul Codex Security Cloud (Scans, Findings, Repositories); nicio interfață programatică documentată.
- **Suprafață nativă:** Plugins în ChatGPT web/desktop
- **Cerințe locale:** Repo pe GitHub, mediu cloud.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Scanare continuă a depozitului, decisă de proprietar.
- **Suprafață de execuție:** openai.codex_security
- **Echivalent la celălalt ecosistem:** Nicio echivalență inclusă verificată.
- **Ce face unic / mai bine:** Monitorizare continuă cu validare în container.
- **Securitate:** Codul privat este analizat în cloud; lipsa constatărilor nu dovedește securitatea; patch-urile nu se aplică automat.
- **Cale de implementare:** Decizia proprietarului; Hub-ul importă doar constatările exportate.
- **Test necesar:** Niciunul automat.
- **Status:** ELIGIBILITY_UNKNOWN
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Pluginul cloud este distinct de pluginul local Codex Security.
- **Surse citite:** https://learn.chatgpt.com/docs/security/setup · https://learn.chatgpt.com/docs/security · https://learn.chatgpt.com/docs/security/faq · https://learn.chatgpt.com/docs/pricing · https://learn.chatgpt.com/docs/whats-new · local: sources-openai-devday.md
- **Verificare adversarială:** CONFIRMED — Paginile Security, Setup și FAQ confirmă pluginul web/desktop în research preview pentru workspace-uri cu acces, scanările de repository și monitorizarea commiturilor, validarea în container izolat și draft PR după review; pricing bifează funcția doar la Enterprise, în conflict cu recapul DevDay.

### Sandbox și permisiuni Codex (Windows sandbox, permission profiles, execpolicy) (`oa-codex-sandbox-permissions`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/cli/reference
- **Documentație tehnică:** https://learn.chatgpt.com/docs/windows/windows-app ; https://learn.chatgpt.com/docs/app-server (sandboxPolicy, permissionProfile/list, windowsSandbox/setupStart)
- **Ce face:** Politici read-only, workspace-write și danger-full-access pentru comenzile generate de model; sandbox nativ Windows sau Linux în WSL2; reguli execpolicy; permission profiles beta; protecții implicite (ex. .aws sub writable roots din 0.159.0).
- **Plan necesar:** Toate planurile
- **Platformă:** Windows, macOS, Linux
- **Rollout:** Stable; permission profiles beta
- **Eligibilitate cont:** Local: windows_sandbox_service este flag în dezvoltare (false).
- **Autentificare:** n/a
- **Allowance:** Nu consumă.
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** thread/start și turn/start sandboxPolicy {readOnly\|workspaceWrite\|dangerFullAccess\|externalSandbox, networkAccess}; permissionProfile/list; windowsSandbox/setupStart → windowsSandbox/setupCompleted; codex sandbox <cmd>; codex execpolicy check; /setup-default-sandbox și /sandbox-add-read-dir (Windows).
- **Suprafață nativă:** /permissions în TUI; selectorul de sub composer în desktop.
- **Cerințe locale:** Sandbox Windows configurat.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Stratul de izolare al worker-ului Codex, dublat de politicile Hub.
- **Suprafață de execuție:** openai.codex_cli
- **Echivalent la celălalt ecosistem:** claude --permission-mode, --tools și sandbox-ul Claude Code.
- **Ce face unic / mai bine:** Sandbox nativ pe Windows cu aprobări granulare.
- **Securitate:** danger-full-access și externalSandbox interzise pentru Hub; setupStart pentru modul elevat modifică sistemul (cere aprobare).
- **Cale de implementare:** Fire Hub doar readOnly sau workspaceWrite cu rădăcini explicite și rețea restricționată.
- **Test necesar:** Test simulat al parametrilor trimiși; permissionProfile/list (fără inferență).
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Pe Windows, desktop-ul aplică sandbox-ul doar cu Ask for approval selectat.
- **Surse citite:** https://learn.chatgpt.com/docs/cli/reference · https://learn.chatgpt.com/docs/windows/windows-app · https://learn.chatgpt.com/docs/app-server · https://learn.chatgpt.com/docs/changelog
- **Verificare adversarială:** CONFIRMED — app-server.md confirmă sandboxPolicy readOnly/workspaceWrite/dangerFullAccess/externalSandbox, permissionProfile/list și windowsSandbox/setupStart; pagina Windows sandbox confirmă modurile elevated și unelevated; pagina Permissions marchează profilele ca beta; changelog-ul 0.159.0 confirmă protecția .aws.

### Configurație gestionată Codex: requirements.toml de sistem (allowed_login_methods, aprobări, sandbox, web search, feature pins) și configRequirements/read (`oa-gap-codex-requirements-toml`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/enterprise/managed-configuration
- **Documentație tehnică:** https://learn.chatgpt.com/docs/config-file/config-reference.md#requirementstoml ; https://learn.chatgpt.com/docs/app-server (configRequirements/read)
- **Ce face:** Cerințe impuse de administrator pe care utilizatorul nu le poate suprascrie prin config.toml, profile sau -c. Pe Windows fișierul de sistem este %ProgramData%\OpenAI\Codex\requirements.toml. Chei relevante: allowed_login_methods (chatgpt, api sau ambele; api include Amazon Bedrock), allowed_chatgpt_workspaces, cli_auth_credentials_store și chatgpt_base_url (acceptate doar local sau prin MDM, ignorate din cloud), allowed_approval_policies, allowed_approvals_reviewers, allowed_sandbox_modes, allowed_permission_profiles, allowed_web_search_modes (lista goală permite doar disabled), tabelul [features] pentru fixarea flagurilor (ex. browser_use, computer_use, in_app_browser), allowlist mcp_servers, marketplaces.restrict_to_allowed_sources. La conflict, clientul revine la o valoare compatibilă și anunță utilizatorul; dacă nicio metodă de login nu rămâne disponibilă, Codex refuză pornirea. Cerințele efective se citesc prin configRequirements/read.
- **Plan necesar:** Tabelul Feature availability din pricing: requirements.toml este disponibil pe Plus, Pro, Business, Enterprise/Edu și cu API key; politicile gestionate din cloud doar pe Business și Enterprise.
- **Platformă:** Windows (%ProgramData%), macOS/Linux (/etc/codex/requirements.toml), macOS MDM (com.openai.codex:requirements_toml_base64)
- **Rollout:** GA; pentru Codex 0.138+ se recomandă permission profiles în locul allowed_sandbox_modes.
- **Eligibilitate cont:** Pe mașină nu există fișier de cerințe (C:\ProgramData\OpenAI lipsește), deci nicio cerință nu este impusă acum.
- **Autentificare:** Independent de autentificare; allowed_login_methods = ["chatgpt"] este compatibil cu OAuth ChatGPT și blochează API key și Bedrock.
- **Allowance:** Nu consumă alocare.
- **Utilizare partajată:** Efect global asupra tuturor clienților Codex locali (desktop, CLI, IDE, app-server), nu doar asupra Hub-ului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul; reduce riscul prin blocarea loginului API și Bedrock.
- **Risc de facturare API:** none
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Citire: app-server configRequirements/read (params {}) → result.requirements {allowedApprovalPolicies, allowedSandboxModes, featureRequirements, network} sau null; codex sandbox --include-managed-config. Scriere: doar fișierul de sistem sau MDM. Nu există metodă app-server, variabilă de mediu sau flag per proces pentru requirements.toml, deci nu poate fi aplicat per proces copil fără a schimba configurația globală.
- **Suprafață nativă:** Fișier TOML întreținut de administrator; clientul afișează avertismente la conflicte.
- **Cerințe locale:** Drept de scriere în %ProgramData%\OpenAI\Codex (probabil drepturi de administrator; ACL-ul trebuie verificat).
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Plasă de siguranță opțională la nivel de mașină, instalată de proprietar: minim allowed_login_methods = ["chatgpt"]; opțional allowed_approvals_reviewers = ["user"]. Hub-ul pregătește propunerea și verifică efectul prin configRequirements/read; gardele per proces rămân în adaptor.
- **Suprafață de execuție:** openai.codex_cli
- **Echivalent la celălalt ecosistem:** an-cc-managed-settings (managed-settings.json sau registru)
- **Ce face unic / mai bine:** Impunere nativă pe care config-ul, profilele sau flagurile CLI nu o pot ocoli; blochează API key și Bedrock pentru toți clienții Codex de pe mașină.
- **Securitate:** Afectează și sesiunile proprietarului din desktop (ex. dacă ar fixa web search sau computer use); scrierea în ProgramData este o schimbare de configurare de sistem și cere aprobare explicită; un fișier scris de alt proces ar putea impune politici (ACL de verificat); [experimental_network] are suport limitat pe Windows.
- **Cale de implementare:** 1) Hub-ul generează o propunere minimă de requirements.toml în documentația proiectului, nu în ProgramData. 2) Proprietarul o instalează manual, după aprobare. 3) La pornirea adaptorului, Hub-ul apelează configRequirements/read și înregistrează rezultatul. 4) Hub-ul nu scrie niciodată automat fișierul.
- **Test necesar:** După instalarea de către proprietar: configRequirements/read și, într-un CODEX_HOME izolat, pornirea app-server cu o valoare API falsă, pentru a confirma refuzul fără inferență.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Criticul a grupat aici și forced_login_method; acesta este o cheie din config.toml aplicabilă per proces și este tratat în oa-gap-codex-auth-precedence-env. Un rezumat automat inițial susținea greșit că requirements.toml e doar Business/Enterprise; citirea directă a matricei din pricing arată disponibilitate și pe Plus și Pro.
- **Surse citite:** https://learn.chatgpt.com/docs/enterprise/managed-configuration.md · https://learn.chatgpt.com/docs/config-file/config-reference.md · https://learn.chatgpt.com/docs/pricing.md (Feature availability) · https://learn.chatgpt.com/docs/app-server · local: C:\ProgramData\OpenAI nu există
- **Verificare adversarială:** CONFIRMED — Verificat în managed-configuration.md și config-reference.md: calea Windows %ProgramData%\OpenAI\Codex\requirements.toml, ordinea straturilor (sistem < Agent Security < managed_config legacy < MDM) și cheile allowed_login_methods (chatgpt \| api; api include Bedrock), allowed_chatgpt_workspaces, cli_auth_credentials_store și chatgpt_base_url (doar local sau MDM, ignorate din cloud). Sunt confirmate și allowed_approvals_reviewers (user, auto_review), allowed_web_search_modes (lista goală permite doar disabled), [features] cu features.in_app_browser și features.browser_use, precum și refuzul pornirii când nu rămâne nicio metodă de login. Matricea Feature availability din pricing arată requirements.toml disponibil pe Plus, Pro, Business, Enterprise și API key, iar politicile cloud doar pe Business și Enterprise. configRequirements/read este documentat, cu răspunsul descris. C:\ProgramData\OpenAI lipsește local (reverificat).

### Execuție de comenzi în sandbox-ul Codex fără inferență: command/exec (app-server) și codex sandbox (CLI) (`oa-gap-codex-command-exec`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/app-server (Command execution)
- **Documentație tehnică:** local: schema 0.159 CommandExecParams; codex sandbox --help (0.159.0); https://learn.chatgpt.com/docs/sandboxing.md
- **Ce face:** command/exec rulează un singur argv sub sandbox-ul serverului, fără thread și fără tură, deci fără model. Parametri (schema 0.159): command, cwd, sandboxPolicy (readOnly cu networkAccess implicit false, workspaceWrite, externalSandbox, dangerFullAccess), env (suprascrieri; null elimină o variabilă moștenită), timeoutMs sau disableTimeout, outputBytesCap sau disableOutputCap, tty, size, streamStdin, streamStdoutStderr, processId. Continuarea se face cu command/exec/write, resize, terminate și notificarea command/exec/outputDelta. externalSandbox sare peste sandbox-ul Codex. Pe CLI, codex sandbox [COMMAND] rulează comanda sub sandbox-ul nativ Windows (token restricționat). Opțiunile documentate pentru Windows sunt --profile/-p, --permission-profile/-P, --cd/-C (cere --permission-profile), --include-managed-config (cere --permission-profile) și --config/-c. Flagurile --sandbox-state-json, --sandbox-state-readable-root, --sandbox-state-disable-network, --enable și --disable apar doar în help-ul local 0.159.0, nu în documentația oficială. process/spawn (experimental, cere experimentalApi) rulează în afara sandbox-ului.
- **Plan necesar:** Orice plan (nu folosește modelul).
- **Platformă:** Windows (sandbox nativ cu token restricționat; setup elevated sau unelevated), macOS (Seatbelt), Linux (bwrap + seccomp)
- **Rollout:** command/exec stabil; process/spawn experimental.
- **Eligibilitate cont:** Disponibil local în 0.159.0 (comanda sandbox și metoda în schemă).
- **Autentificare:** Nu necesită model; app-server rulează cu contul existent.
- **Allowance:** Nu consumă alocare.
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** JSON-RPC: {method: command/exec, params: {command:[...], cwd, sandboxPolicy:{type: readOnly \| workspaceWrite}, env:{VAR:null}, timeoutMs}} → {exitCode, stdout, stderr}. CLI: codex sandbox -C <dir> --permission-profile <nume> -- <cmd>. Metoda nu este în allowlist-ul actual al V2.
- **Suprafață nativă:** Comenzile ! din TUI și terminalul integrat folosesc aceleași politici.
- **Cerințe locale:** Sandbox-ul Windows configurat (windowsSandbox/setupStart; modul elevated poate cere UAC).
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Executor local fără inferență pentru verificările Hub (teste, lint, git status) sub sandbox-ul oficial, doar readOnly și workspaceWrite, fără rețea.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** an-cc-sandboxing (sandbox Bash; Seatbelt/bubblewrap, fără echivalent nativ Windows)
- **Ce face unic / mai bine:** Sandbox Windows nativ disponibil programatic, fără a porni un model.
- **Securitate:** dangerFullAccess și externalSandbox elimină izolarea; process/spawn rulează în afara sandbox-ului; env poate injecta secrete; disableTimeout poate bloca resurse.
- **Cale de implementare:** 1) Extinderea allowlist-ului doar după aprobare. 2) Validator care acceptă numai readOnly și workspaceWrite, cu cwd în workspace-ul Hub și timeoutMs obligatoriu. 3) REJECT pentru dangerFullAccess, externalSandbox, process/spawn, disableTimeout. 4) Audit pentru fiecare comandă.
- **Test necesar:** Test local fără model: comandă readOnly care încearcă o scriere și trebuie să eșueze; comandă care încearcă rețea și trebuie să eșueze.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** oa-codex-app-server-side-effect-methods acoperă metodele periculoase (shell în afara sandbox-ului); acest record acoperă capabilitatea de execuție sandboxată.
- **Surse citite:** https://learn.chatgpt.com/docs/app-server · local: codex-schema-0159/v2/CommandExecParams.json · local: codex sandbox --help · https://learn.chatgpt.com/docs/llms-full.txt (secțiunea codex sandbox)
- **Verificare adversarială:** CORRECTED (corectat: whatItDoes (https://learn.chatgpt.com/docs/app-server.md (Command execution) ; https://learn.chatgpt.com/docs/llms-full.txt (sandboxWindowsOptions) ; local: codex sandbox --help 0.159.0)) — Metoda command/exec, lista de sandboxPolicy, metodele write, resize și terminate, outputDelta, avertismentul despre externalSandbox și windowsSandbox/setupStart (elevated \| unelevated) sunt documentate. programmaticDetail (codex sandbox -C <dir> --permission-profile <nume> -- <cmd>) este compatibil cu documentația. Status AVAILABLE, WRAP și apiBillingRisk none sunt corecte. Corecția privește doar flagul --sandbox-state-disable-network, care nu este documentat oficial.

## other

### OpenAI Marketplace (`oa-marketplace`)

- **Sursă oficială:** https://openai.com/index/devday-2026-recap/#do-more-with-your-chatgpt-subscription
- **Documentație tehnică:** Nicio pagină tehnică publică citită
- **Ce face:** Clienții enterprise eligibili pot aplica o parte din angajamentul financiar existent cu OpenAI la software aprobat de la parteneri (32 inițial, ex. Adobe, Figma, HubSpot, Salesforce, ServiceNow, CrowdStrike).
- **Plan necesar:** Clienți enterprise cu angajament financiar.
- **Platformă:** Marketplace OpenAI.
- **Rollout:** Beta.
- **Eligibilitate cont:** Neeligibil.
- **Autentificare:** n/a
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Angajament financiar enterprise.
- **Risc de facturare API:** high
- **Integrare programatică:** NONE
- **Detaliu integrare:** n/a
- **Suprafață nativă:** n/a
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** NONE
- **Rol propus:** Niciunul.
- **Suprafață de execuție:** openai.marketplace
- **Echivalent la celălalt ecosistem:** n/a
- **Ce face unic / mai bine:** n/a
- **Securitate:** n/a
- **Cale de implementare:** Niciuna.
- **Test necesar:** Niciunul.
- **Status:** NOT_APPLICABLE
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** medium
- **Surse citite:** scratchpad/sources-openai-devday.md (recap)
- **Verificare adversarială:** CONFIRMED — Recapitularea citită direct confirmă: se folosește o parte din angajamentul financiar enterprise existent, cu 32 de parteneri inițiali (Adobe, Figma, HubSpot, Salesforce, ServiceNow, CrowdStrike etc.), în beta pentru clienții enterprise eligibili.

### Conversații vocale: /voice și F8 în Codex CLI; ChatGPT Voice în desktop (`oa-codex-voice`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/changelog (Codex CLI 0.155.0 și 0.156.0)
- **Documentație tehnică:** https://learn.chatgpt.com/docs/features/voice ; https://learn.chatgpt.com/docs/pricing (FAQ Voice)
- **Ce face:** Conversație vocală cu transcriere live și control al microfonului în TUI (experimentală în 0.155.0, activă implicit în 0.156.0 cu F8, selector /voice și runtime audio inclus pentru Windows); în desktop, ChatGPT Voice poate porni, verifica și coordona taskuri Codex.
- **Plan necesar:** Desktop: Plus, Pro, Business, Edu, Enterprise; indisponibil prin API key.
- **Platformă:** Windows, macOS, Linux (CLI); desktop macOS/Windows
- **Rollout:** Activ implicit din 22.09.2026 în CLI; în desktop depinde de rollout.
- **Eligibilitate cont:** Flaguri locale realtime_conversation și in_app_dictation = true.
- **Autentificare:** ChatGPT
- **Allowance:** Pricing: vocea din desktop consumă bugetul Codex la echivalentul a 0,05 USD pe minut; 1,25 credite/minut la facturare pe credite.
- **Utilizare partajată:** Vocea și taskurile împart limitele planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** După limită, minutele pot consuma credite existente.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Nicio metodă app-server documentată pentru voce în paginile citite; Hub-ul nu o folosește.
- **Suprafață nativă:** TUI (F8, /voice), desktop (Start voice chat), Pets/Quick Chat.
- **Cerințe locale:** Microfon; runtime audio inclus în CLI pentru Windows.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Proprietarul poate dicta sau discuta taskuri; Hub-ul înregistrează doar rezultatele.
- **Suprafață de execuție:** openai.codex_cli
- **Echivalent la celălalt ecosistem:** Nicio suprafață vocală Claude Code verificată în dovezile locale.
- **Ce face unic / mai bine:** Voce direct în terminal.
- **Securitate:** Audio trimis la OpenAI; o singură conversație vocală activă în desktop.
- **Cale de implementare:** Nicio integrare.
- **Test necesar:** Niciunul.
- **Status:** AVAILABLE
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Tariful per minut este din FAQ pricing pentru desktop; aplicarea identică în CLI nu este declarată explicit.
- **Surse citite:** https://learn.chatgpt.com/docs/changelog · https://learn.chatgpt.com/docs/features/voice · https://learn.chatgpt.com/docs/pricing · local: sources-openai-devday.md
- **Verificare adversarială:** CONFIRMED — Confirmat: /voice experimental în 0.155.0, activ implicit cu F8 și runtime audio pentru Windows în 0.156.0; ChatGPT Voice în desktop pe Plus, Pro, Business, Edu și Enterprise, indisponibil prin API key; 0,05 USD pe minut din bugetul Codex sau 1,25 credite pe minut; o singură conversație vocală activă. Tabelul de slash commands nu listează /voice, dar changelog-ul îl menționează.

### codex exec-server (executor remote standalone) (`oa-codex-exec-server`)

- **Sursă oficială:** https://raw.githubusercontent.com/openai/codex/main/codex-rs/cli/src/main.rs
- **Documentație tehnică:** https://learn.chatgpt.com/docs/changelog (0.158.0: bearer tokens pentru WebSocket exec-server)
- **Ce face:** Serviciu experimental care execută comenzile agentului pe alt proces sau host; app-server se poate conecta la el; CODEX_EXEC_SERVER_URL ocolește atașarea la daemon.
- **Plan necesar:** n/a
- **Platformă:** CLI
- **Rollout:** Experimental
- **Eligibilitate cont:** Comanda există local.
- **Autentificare:** Bearer token pe WebSocket
- **Allowance:** Nu consumă direct.
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** codex exec-server; variabila CODEX_EXEC_SERVER_URL.
- **Suprafață nativă:** n/a
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul.
- **Suprafață de execuție:** openai.codex_cli
- **Echivalent la celălalt ecosistem:** Nicio echivalență verificată.
- **Ce face unic / mai bine:** Separarea execuției de agent.
- **Securitate:** Expunere de rețea dacă este pornit pe WebSocket.
- **Cale de implementare:** Nicio integrare.
- **Test necesar:** Niciunul.
- **Status:** AVAILABLE
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** medium
- **Note:** Nu apare în tabelul de comenzi al referinței CLI, dar documentația îl menționează: --strict-config este suportat de exec-server, iar CODEX_API_KEY poate fi folosit cu codex exec-server --remote (posibilă facturare API în modul remote). Sursa îl marchează EXPERIMENTAL.
- **Surse citite:** https://raw.githubusercontent.com/openai/codex/main/codex-rs/cli/src/main.rs · https://learn.chatgpt.com/docs/changelog · https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server-daemon/README.md
- **Verificare adversarială:** CORRECTED (corectat: status (local: sources-openai-devday.md secțiunea E ; https://raw.githubusercontent.com/openai/codex/main/codex-rs/cli/src/main.rs), notes (https://learn.chatgpt.com/docs/config-file/environment-variables ; https://learn.chatgpt.com/docs/non-interactive-mode ; https://learn.chatgpt.com/docs/cli/reference)) — Subcomanda experimentală, variabila CODEX_EXEC_SERVER_URL și bearer tokens pentru WebSocket (0.158.0) sunt confirmate; statusul trebuia să fie AVAILABLE, deoarece comanda există local.

### ChatGPT Sites (site-uri și aplicații ușoare găzduite, cu automatizări programate) (`oa-sites`)

- **Sursă oficială:** https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites
- **Documentație tehnică:** https://learn.chatgpt.com/docs/sites.md
- **Ce face:** ChatGPT construiește, previzualizează, publică și partajează site-uri și aplicații ușoare din Work (web) sau Work/Codex (desktop); fiecare deploy este URL de producție; D1 până la 10 GB și R2; domenii custom; audiențe de la proprietar la public; co-editare; automatizări (schedule-uri cloud) legate de un Site publicat.
- **Plan necesar:** Beta public pentru workspace-uri, Plus și Pro (learn: Plus, Pro, Business, Enterprise, Edu); limite de beta pe plan
- **Platformă:** ChatGPT web (Work) și desktop (Work sau Codex); nu în aplicația Classic
- **Rollout:** Public beta, în extindere; automatizările Site „când sunt disponibile”
- **Eligibilitate cont:** Probabil eligibil pe Pro; neverificat
- **Autentificare:** Cont ChatGPT; vizitatorii restricționați se autentifică cu ChatGPT
- **Allowance:** Inclus în beta până la limitele planului; la limită nu se pot crea Site-uri noi sau menține public un Site intens folosit
- **Utilizare partajată:** Construcția consumă Work/Codex; limitele Sites sunt pe cont
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** Inclus doar pe durata beta; prețul ulterior necunoscut; domeniul custom se cumpără separat.
- **Risc de facturare API:** none
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Niciun API Sites documentat. Crearea și publicarea se fac doar prin prompt (@Sites), în Work pe web sau în Work/Codex în desktop. În desktop, un Site poate porni și dintr-un proiect local compatibil (legătura se păstrează în .openai/hosting.json, iar versiunile salvate sunt separate de deploy), deci codul rămâne local. Codex CLI și extensia IDE nu au vedere de administrare Sites; adminii au comanda „Copy source clone command”. Schedule-urile unui Site nu pot folosi accesul conectat al vizitatorilor.
- **Suprafață nativă:** Work/Codex, Sites în bara laterală, Share/Publish, Automations
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Hub-ul nu publică date; poate pregăti conținut Markdown pentru un Site pe care proprietarul îl publică manual.
- **Suprafață de execuție:** openai.sites
- **Echivalent la celălalt ecosistem:** Anthropic: Artifacts publicate (anthropic.claude_artifacts)
- **Ce face unic / mai bine:** Găzduire, bază de date și domenii custom incluse în beta; editare din Site-ul publicat.
- **Securitate:** Fiecare deploy este de producție; risc de publicare accidentală a datelor interne; fără rețele private, TCP brut sau procesări PHI/carduri.
- **Cale de implementare:** Hub-ul pregătește conținut; publicarea o face proprietarul.
- **Test necesar:** n/a
- **Status:** ELIGIBILITY_UNKNOWN
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Ștergerea unui Site este permanentă. Sites poate găzdui și un server MCP pentru un plugin (vezi oa-sites-hosted-plugin).
- **Surse citite:** https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites · https://learn.chatgpt.com/docs/sites.md · https://learn.chatgpt.com/docs/enterprise/sites.md · https://openai.com/index/devday-2026-recap/ (captură locală)
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://learn.chatgpt.com/docs/sites.md; https://learn.chatgpt.com/docs/enterprise/sites.md; https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites)) — Sunt confirmate: public beta pe Plus, Pro și workspace-uri, indisponibil pe Free/Go, inclus în beta până la limitele planului, D1 10 GB, R2 fără limită fixă, fără rețele private sau TCP brut, fără rezidența datelor, deploy-uri de producție și ștergere definitivă. ELIGIBILITY_UNKNOWN/ASSISTED sunt corecte.

### Import din alt agent (Claude Code, Claude Cowork, Cursor) în ChatGPT desktop/Codex (`oa-import-other-agent`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/import.md
- **Documentație tehnică:** https://learn.chatgpt.com/docs/app-server.md (externalAgentConfig/detect, externalAgentConfig/import)
- **Ce face:** Importă setări (settings.json → config.toml, instrucțiuni → AGENTS.md), skills, pluginuri, configurări MCP, hooks, comenzi, subagenți, foldere de proiect, memorii de proiect și chaturile ultimelor 30 de zile; CLI /import până la 50 de chaturi.
- **Plan necesar:** Nespecificat
- **Platformă:** ChatGPT desktop (cu sincronizare automată); Codex CLI /import
- **Rollout:** Disponibil
- **Eligibilitate cont:** Probabil disponibil; neexecutat
- **Autentificare:** Cont ChatGPT; fișierele locale ale celuilalt agent
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** app-server externalAgentConfig/detect (citire) și externalAgentConfig/import (scriere, interzis fără aprobare); flagul local external_agent_memory_import este încă în dezvoltare.
- **Suprafață nativă:** Import în ChatGPT desktop; /import în Codex CLI
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Referință de portabilitate; Hub-ul nu rulează importul, fiindcă ar copia CLAUDE.md, MCP și hooks în profilul Codex.
- **Suprafață de execuție:** openai.codex_desktop
- **Echivalent la celălalt ecosistem:** Anthropic: skill-ul local import-memory (import de memorie din alt asistent)
- **Ce face unic / mai bine:** Migrare completă a configurației între vendori
- **Securitate:** Hooks și servere MCP importate pot executa cod; permisiunile uneltelor trebuie revizuite; sincronizarea automată poate propaga schimbări neaprobate.
- **Cale de implementare:** Niciuna; doar detectarea read-only, dacă devine utilă
- **Test necesar:** n/a
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Importul nu modifică configurația agentului sursă.
- **Surse citite:** https://learn.chatgpt.com/docs/import.md · https://learn.chatgpt.com/docs/app-server.md
- **Verificare adversarială:** CONFIRMED — Learn import confirmă: desktop-ul importă din Claude Code, Claude Cowork și Cursor, iar CLI din Claude Code și Cursor; CLI importă până la 50 de chaturi din ultimele 30 de zile; tabelul de mapare este cel din record. Importul nu schimbă și nu șterge configurația agentului sursă. App-server confirmă externalAgentConfig/detect și /import.

### Compliance API, Conversation API și Analytics API pentru workspace-uri (`oa-compliance-analytics-api`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/enterprise/compliance-api.md
- **Documentație tehnică:** https://learn.chatgpt.com/docs/enterprise/analytics-api.md
- **Ce face:** Acces programatic de administrator la conversații, sarcini programate, activitate deep research, fișiere Library și analitice de utilizare.
- **Plan necesar:** Enterprise (și Edu după caz)
- **Platformă:** API de admin
- **Rollout:** Disponibil
- **Eligibilitate cont:** Neeligibil pe un plan individual
- **Autentificare:** Permisiuni Compliance API de admin
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Ar cere Enterprise
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Admin API (chatgpt.com/public/admin/api-reference). Compliance API, cu cheia Compliance API de Enterprise, dă acces la loguri de audit și fișiere (de ex. conversation_message, codex_log), inclusiv proiecte, sarcini programate și activitate deep research. Analytics API folosește o cheie Admin la nivel de workspace, cu scope-ul enterprise.analytics.usage.read. Nicio cale pentru planurile individuale, unde rămâne doar exportul manual.
- **Suprafață nativă:** Consola de admin
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul
- **Suprafață de execuție:** openai.chatgpt_admin
- **Echivalent la celălalt ecosistem:** Anthropic: neverificat
- **Ce face unic / mai bine:** Singura oglindire programatică a conversațiilor ChatGPT
- **Securitate:** Acces la toate conversațiile workspace-ului
- **Cale de implementare:** Niciuna
- **Test necesar:** n/a
- **Status:** PLAN_RESTRICTED
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Pentru un cont personal, singura cale este exportul manual (oa-chatgpt-data-export).
- **Surse citite:** https://learn.chatgpt.com/llms.txt · https://help.openai.com/en/articles/10500283-deep-research-in-chatgpt · https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt · https://learn.chatgpt.com/docs/enterprise/chatgpt-space.md · https://learn.chatgpt.com/docs/pricing.md
- **Verificare adversarială:** CORRECTED (corectat: programmaticIntegration (https://learn.chatgpt.com/docs/enterprise/compliance-api.md; https://learn.chatgpt.com/docs/enterprise/analytics-api.md), programmaticDetail (https://learn.chatgpt.com/docs/enterprise/compliance-api.md; https://learn.chatgpt.com/docs/enterprise/analytics-api.md)) — Am citit ambele pagini, pe care recordul spunea că nu le-a citit. Mecanismul este programatic, dar PLAN_RESTRICTED/REFERENCE rămân corecte (Enterprise/Edu, plus ChatGPT for Teachers conform titlului ghidului Help).

### Generarea de imagini în Codex și ChatGPT Work (gpt-image-2, skill $imagegen) (`oa-gap-codex-image-generation`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/image-generation
- **Documentație tehnică:** https://learn.chatgpt.com/docs/pricing#image-generation-usage-limits
- **Ce face:** Unealtă built-in care generează și editează imagini cu gpt-image-2, invocată explicit cu $imagegen sau implicit, cu imagini de referință atașate (-i). Consumă aceleași limite generale ca mesajele locale și taskurile cloud, în medie de 3–5 ori mai repede decât ture similare fără imagini; după epuizarea limitelor consumă credite. Nu este disponibilă pe Free. Cu API key se aplică prețurile API. Tarife în credite per 1M tokeni: GPT-Image-2 (image) 200 / 50 / 750 (input / cached / output), GPT-Image-2 (text) 125 / 31,25 / 250. Limitele de imagini din ChatGPT web sunt separate de cele din Codex.
- **Plan necesar:** Planuri plătite (Plus, Pro, Business, Enterprise/Edu); nu Free.
- **Platformă:** ChatGPT desktop (Codex/Work), Codex CLI, extensia IDE, ChatGPT web
- **Rollout:** GA
- **Eligibilitate cont:** Flagul image_generation este activ local (stable, true); planul proprietarului nu este verificat în V2.
- **Autentificare:** ChatGPT OAuth (limite de abonament) sau API key (preț API, interzis).
- **Allowance:** Limite Codex/Work, consumate de 3–5 ori mai repede în medie.
- **Utilizare partajată:** Aceeași alocare cu firele Codex și Work ale proprietarului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Credite după epuizarea limitelor; dacă OPENAI_API_KEY ajunge în mediul copilului, agentul poate genera prin API la preț API (ghidul oficial sugerează asta pentru loturi mari).
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Dezactivare per proces copil fără schimbare globală: codex app-server --disable image_generation (flag documentat ca echivalent cu -c features.image_generation=false; cheia nu apare în config reference, dar flagul există în codex features list). Global: [features] image_generation = false în requirements.toml. Activare per misiune: proces app-server separat fără --disable, după aprobare. Tipul exact de item emis pentru generare nu a fost verificat în schemă.
- **Suprafață nativă:** Composer în desktop (vizualizare Focused/Canvas, comentarii pe imagini), CLI cu $imagegen.
- **Cerințe locale:** Niciuna în plus.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Util pentru asset-uri web ale agenției (bannere, ilustrații, placeholder-e), dar dezactivat implicit în firele Hub; activare per misiune cu aprobare și buget de consum.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** Nu există echivalent în inventarul Anthropic (Claude Code nu are record de generare de imagini).
- **Ce face unic / mai bine:** Generare și editare direct lângă cod, cu imagini de referință și comentarii pe canvas.
- **Securitate:** Consum accelerat al alocării comune; risc de mutare pe facturare API prin OPENAI_API_KEY; imagini cu persoane reale sau mărci necesită permisiuni.
- **Cale de implementare:** 1) Adaugă --disable image_generation în lansarea standard a app-server. 2) Profil separat „assets” care permite generarea doar după aprobare. 3) Telemetrie: diferența de rateLimits înainte și după misiune.
- **Test necesar:** Test fără model: codex features list cu --disable image_generation arată false; test LIVE_VALIDATION separat, aprobat, pentru consumul real.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** medium
- **Note:** API-ul OpenAI listează separat GPT-Image-2.5 Sunburst și Flare; documentația Codex numește gpt-image-2 pentru generarea built-in.
- **Surse citite:** https://learn.chatgpt.com/docs/image-generation.md · https://learn.chatgpt.com/docs/pricing.md · local: codex features list (0.159.0): image_generation stable true · https://help.openai.com/en/articles/11369540
- **Verificare adversarială:** CONFIRMED — image-generation.md confirmă gpt-image-2, $imagegen, -i/--image, consumul de 3–5 ori mai rapid și sugestia OPENAI_API_KEY pentru loturi mari prin API. Pricing confirmă consumul din aceleași limite, apoi din credite, lipsa pe Free, prețul API la autentificarea cu API key și tarifele GPT-Image-2 200/50/750 și 125/31,25/250. FAQ-ul din help 11369540 confirmă că limitele de imagini din ChatGPT nu se aplică în Codex. Flagul generic --disable (echivalent cu -c features.<name>=false) este documentat; numele feature-ului image_generation nu apare în documentația oficială și a fost verificat doar local (codex features list 0.159.0: stable, true), cum precizează chiar recordul. Pentru Go documentația nu spune explicit dacă generarea în Codex e disponibilă.

### Feature flags Codex: citire (codex features list, experimentalFeature/list) și modificare (features enable/disable, experimentalFeature/enablement/set, --enable/--disable) (`oa-gap-codex-feature-flags`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/app-server (experimentalFeature/*)
- **Documentație tehnică:** https://learn.chatgpt.com/docs/developer-commands?surface=cli (codex features) ; local schema 0.159 ExperimentalFeatureEnablementSetParams
- **Ce face:** Citire: codex features list afișează numele, stadiul (under development, experimental, stable, deprecated, removed) și starea efectivă; experimentalFeature/list întoarce aceleași informații paginat (name, stage, displayName, description, enabled, defaultEnabled). Scriere: codex features enable\|disable persistă în $CODEX_HOME/config.toml (fără --profile); experimentalFeature/enablement/set modifică în memorie, la nivelul întregului proces, un map de flaguri (documentat pentru chei ca apps și plugins); flagurile globale --enable/--disable sau -c features.<nume>=bool se aplică doar procesului lansat. requirements.toml poate fixa flaguri global. Stare locală în 0.159.0: apps, plugins, memories, multi_agent, computer_use, browser_use, image_generation, goals, hooks, skill_mcp_dependency_install au valoarea true; skip_host_skill_discovery, network_proxy, multi_agent_v2 au valoarea false.
- **Plan necesar:** Toate planurile
- **Platformă:** Codex CLI și app-server
- **Rollout:** GA pentru citire; flagurile individuale au stadii diferite.
- **Eligibilitate cont:** Citirea a funcționat local fără inferență.
- **Autentificare:** Nu necesită model.
- **Allowance:** Nu consumă.
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Indirect: activarea unor flaguri (image_generation, multi_agent, memories) crește consumul.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** MIRROR_STATE: codex features list sau experimentalFeature/list la pornirea adaptorului, cu diff față de ultima stare. Garduri per proces copil: codex app-server --disable image_generation --disable skill_mcp_dependency_install --disable apps (nepersistente). Interzise fără aprobare: codex features enable\|disable și experimentalFeature/enablement/set.
- **Suprafață nativă:** Setările desktop și config.toml
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Oglindirea capabilităților efective (ce poate face un fir Codex) și aplicarea de garduri nepersistente per proces.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** Setările și variabilele Claude Code (an-cc-safe-mode-isolation, an-cc-managed-settings)
- **Ce face unic / mai bine:** Inventar explicit al capabilităților și al stadiului lor, citibil fără model.
- **Securitate:** experimentalFeature/enablement/set este global pe proces: pe daemonul partajat ar afecta și sesiunile proprietarului; enable/disable scriu în config-ul utilizatorului.
- **Cale de implementare:** 1) Snapshot al flagurilor în telemetria Hub la fiecare pornire. 2) Set standard de --disable pentru firele Hub. 3) Metodele de scriere rămân în afara allowlist-ului.
- **Test necesar:** Test fără model: pornire app-server cu --disable X urmată de experimentalFeature/list care arată X false.
- **Status:** AVAILABLE
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** high
- **Note:** Critical pentru recordurile de imagini, web search, skills și apps; flagul daemon_auto_start este true, iar Hub-ul trebuie să ruleze propriul proces app-server stdio, nu daemonul partajat.
- **Surse citite:** https://learn.chatgpt.com/docs/app-server · https://learn.chatgpt.com/docs/llms-full.txt (codex features) · local: codex features list (0.159.0) · local: codex --help (--enable/--disable)
- **Verificare adversarială:** CONFIRMED — Documentate: codex features list, enable și disable (persistente în $CODEX_HOME/config.toml, fără --profile), experimentalFeature/list (paginat; câmpuri name, stage, displayName, description, announcement, enabled, defaultEnabled; stage documentat ca beta \| underDevelopment \| stable \| deprecated \| removed) și experimentalFeature/enablement/set (patch în memorie pentru chei ca apps și plugins). Flagurile globale --enable și --disable sunt documentate. Starea locală a fost reverificată azi, fără inferență: apps, browser_use, computer_use, daemon_auto_start, goals, hooks, image_generation, in_app_browser, memories, multi_agent, plugins și skill_mcp_dependency_install au true; multi_agent_v2 false; network_proxy este experimental și false; skip_host_skill_discovery este under development și false. CLI-ul local afișează stadiul experimental, iar documentația app-server numește beta.

## cloud

### Amazon Bedrock Managed Agents, powered by OpenAI (`oa-bedrock-managed-agents`)

- **Sursă oficială:** https://developers.openai.com/api/docs/guides/agents-api/bedrock-managed-agents
- **Documentație tehnică:** https://aws.amazon.com/bedrock/managed-agents-openai/
- **Ce face:** Adaptează Agents API pentru AWS: harness-ul agentului OpenAI și inferența rulează în Amazon Bedrock; comenzile și uneltele rulează în AgentCore Runtime sau pe compute propriu; autentificare AWS IAM cu SigV4.
- **Plan necesar:** Cont AWS cu acces Bedrock (facturare AWS).
- **Platformă:** AWS.
- **Rollout:** Anunțat la DevDay; regiuni și prețuri în documentația AWS.
- **Eligibilitate cont:** Neaplicabil.
- **Autentificare:** AWS IAM / SigV4.
- **Allowance:** Facturare AWS.
- **Utilizare partajată:** Separat de ChatGPT.
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Serviciu plătit nou (AWS).
- **Risc de facturare API:** high
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Endpoint Amazon Bedrock; contracte API care nu sunt identice cu Agents API.
- **Suprafață nativă:** Consola AWS.
- **Cerințe locale:** Credențiale AWS.
- **Relevanță pentru Hub:** NONE
- **Rol propus:** Niciunul.
- **Suprafață de execuție:** openai.bedrock_managed_agents
- **Echivalent la celălalt ecosistem:** Claude pe Amazon Bedrock (tot plătit separat).
- **Ce face unic / mai bine:** Compute controlat de client.
- **Securitate:** Credențiale AWS.
- **Cale de implementare:** BillingPolicy new_paid_service: deny.
- **Test necesar:** Niciunul.
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Pagina AWS nu a fost citită.
- **Surse citite:** https://developers.openai.com/api/docs/guides/agents-api/bedrock-managed-agents.md · https://developers.openai.com/api/docs/guides/amazon-bedrock.md · scratchpad/sources-openai-devday.md (recap)
- **Verificare adversarială:** CONFIRMED — Ghidul citit confirmă: harness-ul și inferența rulează în Amazon Bedrock, execuția în AgentCore Runtime sau pe compute propriu, autentificarea prin IAM cu SigV4, iar contractele API nu sunt identice. Prețurile și regiunile sunt la AWS (pagina AWS necitită).

### Codex / ChatGPT Work local cu Amazon Bedrock ca model_provider (`oa-codex-bedrock-provider`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/amazon-bedrock
- **Documentație tehnică:** https://developers.openai.com/api/docs/guides/amazon-bedrock
- **Ce face:** Clienții locali Codex/Work pot trimite cererile la Amazon Bedrock (model_provider amazon-bedrock pentru Mantle sau amazon-bedrock-runtime pentru CRIS), cu Bedrock API key sau lanțul de credențiale AWS; fără ChatGPT sign-in, fără Fast mode, fără funcții cloud OpenAI.
- **Plan necesar:** Cont AWS cu acces la modelele OpenAI în Bedrock.
- **Platformă:** Codex desktop, CLI, IDE, SDK.
- **Rollout:** Disponibil; GPT-6.1 Sol adăugat în cataloagele Bedrock în Codex 0.159.1.
- **Eligibilitate cont:** Neaplicabil.
- **Autentificare:** AWS_BEARER_TOKEN_BEDROCK sau credențiale AWS SDK.
- **Allowance:** Facturare AWS.
- **Utilizare partajată:** Separat de ChatGPT.
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Facturare AWS directă.
- **Risc de facturare API:** high
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** config.toml model_provider; app-server account/bedrock/discover, account/bedrock/setup; account/read type amazonBedrock.
- **Suprafață nativă:** Configurarea locală Codex.
- **Cerințe locale:** Credențiale AWS.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Rută interzisă; Hub-ul trebuie să o detecteze și să o blocheze.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** Claude Code cu Bedrock/Vertex (interzis de politică).
- **Ce face unic / mai bine:** n/a
- **Securitate:** Variabile AWS moștenite pot redirecționa silențios facturarea.
- **Cale de implementare:** Mediul copil este allowlist-only (AWS_BEARER_TOKEN_BEDROCK este în BILLING_RISK_ENV). Refuz dacă thread/start.modelProvider sau account/read indică amazonBedrock; metodele account/bedrock/* sunt scoase din allowlist. Clienții desktop citesc variabile din ~/.codex/.env, iar lanțul AWS SDK poate folosi fișierele ~/.aws, care ocolesc mediul de proces. De aceea CODEX_HOME-ul Hub nu trebuie să conțină .env sau model_provider Bedrock. Gardă nativă, cu aprobarea proprietarului: allowed_login_methods = ["chatgpt"] în requirements.toml locale, unde „api” include Amazon Bedrock.
- **Test necesar:** Test simulat account/read type amazonBedrock → refuz.
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Surse citite:** https://learn.chatgpt.com/docs/amazon-bedrock.md · https://developers.openai.com/api/docs/guides/amazon-bedrock.md · https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server-protocol/src/protocol/common.rs · https://api.github.com/repos/openai/codex/commits?path=codex-rs/protocol/src/account.rs
- **Verificare adversarială:** CORRECTED (corectat: implementationPath (https://learn.chatgpt.com/docs/amazon-bedrock.md ; https://learn.chatgpt.com/llms-full.txt (Manage authentication locally))) — Au fost confirmate: providerii amazon-bedrock (Mantle) și amazon-bedrock-runtime (CRIS), autentificarea prin Bedrock API key sau lanțul AWS SDK, lipsa Fast mode și a funcțiilor cloud OpenAI, ID-urile openai.gpt-6-*, precum și account/bedrock/discover\|setup ca metode experimentale.

### Codex Cloud: medii cloud reutilizabile (`oa-codex-cloud-environments`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/environments/cloud-environments
- **Documentație tehnică:** https://learn.chatgpt.com/docs/cloud ; https://learn.chatgpt.com/docs/auth
- **Ce face:** Mediu publicat și reutilizat: depozite GitHub, install script, start skill, acces la internet cu preset și domenii permise, network secrets și variabile de mediu (inclusiv Personal vault), stare salvată; fiecare task primește un workspace izolat care continuă cât timp computerul doarme.
- **Plan necesar:** Plus, Pro, Business, Enterprise (nu API key); cloud necesită login ChatGPT.
- **Platformă:** Cloud OpenAI + GitHub
- **Rollout:** Disponibil (medii reutilizabile anunțate la DevDay 29.09.2026)
- **Eligibilitate cont:** Neconfigurat; plan neverificat în V2.
- **Autentificare:** ChatGPT + conector GitHub
- **Allowance:** Configurarea nu consumă semnificativ; taskurile consumă.
- **Utilizare partajată:** Chaturile cloud împart alocarea cu mesajele locale.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Business: VM-uri mai mari; credite după limită.
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Crearea și publicarea se fac în ChatGPT (Work in > Cloud > Select environment > Create environment) sau din Settings > Codex Cloud > Environments; ID-ul mediului se alege din pickerul interactiv codex cloud sau se citește din câmpul environment_id al taskurilor returnate de codex cloud list --json (--env doar filtrează taskurile). Valorile personale se gestionează în Personal vault. Code Review și integrările GitHub/Linear folosesc încă mediile Codex Cloud (Legacy), cu depreciere planificată.
- **Suprafață nativă:** ChatGPT web/desktop, Settings > Codex Cloud > Environments.
- **Cerințe locale:** Repo publicat pe GitHub; MFA activat pe cont dacă autentificarea ChatGPT folosește e-mail și parolă.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Execuție cloud opțională pentru taskuri paralele, după decizia proprietarului.
- **Suprafață de execuție:** openai.codex_cloud
- **Echivalent la celălalt ecosistem:** anthropic.claude_code_web (medii cloud Claude Code) — referință.
- **Ce face unic / mai bine:** Mediu pregătit și testat automat, reutilizat între taskuri.
- **Securitate:** Codul privat și secretele ajung în cloudul OpenAI; secretele se introduc doar de proprietar; cloudul vede doar commituri publicate.
- **Cale de implementare:** Proprietarul creează mediul; Hub-ul memorează doar ENV_ID și politica de rețea.
- **Test necesar:** Niciunul automat.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Recapul DevDay listează disponibilitatea atât per plan, cât și pentru toate planurile; tabelul pricing este sursa mai precisă.
- **Surse citite:** https://learn.chatgpt.com/docs/cloud · https://learn.chatgpt.com/docs/environments/cloud-environments · https://learn.chatgpt.com/docs/pricing · https://learn.chatgpt.com/docs/auth · local: sources-openai-devday.md
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://learn.chatgpt.com/docs/environments/cloud-environments ; https://learn.chatgpt.com/docs/cli/reference), localRequirements (https://learn.chatgpt.com/docs/auth)) — Mediile reutilizabile, install script și start skill, network secrets, Personal vault și workspace-urile izolate care continuă cât timp computerul doarme sunt confirmate; corectată descoperirea ID-ului de mediu și adăugate cerința MFA și nota Legacy.

### Taskuri Codex Cloud din CLI (codex cloud exec/list/status/diff/apply, codex apply) (`oa-codex-cloud-tasks-cli`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/cli/reference
- **Documentație tehnică:** https://raw.githubusercontent.com/openai/codex/main/codex-rs/cloud-tasks/src/cli.rs
- **Ce face:** Trimite taskuri în cloud fără TUI, listează taskurile recente în JSON, afișează starea și diff-ul și aplică local diff-ul unui task.
- **Plan necesar:** Plus, Pro, Business, Enterprise (nu API key)
- **Platformă:** CLI Windows/macOS/Linux
- **Rollout:** Experimental
- **Eligibilitate cont:** Comanda există local; niciun mediu cloud configurat.
- **Autentificare:** Aceleași credențiale ca CLI-ul principal (ChatGPT)
- **Allowance:** Chaturile cloud împart alocarea planului și pot folosi mai mult decât mesajele locale; --attempts multiplică.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Best-of-N (până la 4) multiplică consumul; credite după limită.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** codex cloud exec --env ENV_ID [--branch BR] [--attempts 1-4] PROMPT; codex cloud list --json [--env] [--limit 1-20] [--cursor] → tasks[{id, url, title, status, updated_at, environment_id, environment_label, summary, is_review, attempt_total}]; codex cloud status ID; codex cloud diff ID [--attempt N]; codex cloud apply ID [--attempt N]; codex apply TASK_ID (cod nenul la conflict git apply).
- **Suprafață nativă:** ChatGPT web/desktop/mobil pentru revizuire.
- **Cerințe locale:** Mediu cloud publicat; branch împins.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Executor cloud gated: observare fără cost, lansare doar cu grant.
- **Suprafață de execuție:** openai.codex_cloud
- **Echivalent la celălalt ecosistem:** anthropic.claude_code_web (sesiuni cloud).
- **Ce face unic / mai bine:** Best-of-N și diff aplicabil local.
- **Securitate:** Lansarea trimite codul în cloud; apply scrie în workspace.
- **Cale de implementare:** list/status/diff = observare fără inferență; exec doar cu grant explicit legat de branch/commit publicat; apply doar sub lease de workspace și cu aprobare.
- **Test necesar:** codex cloud list --json (fără inferență) după configurarea mediului.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Subcomenzile status/diff/apply provin din sursa open-source; referința publică documentează exec, list și codex apply.
- **Surse citite:** https://learn.chatgpt.com/docs/cli/reference · https://raw.githubusercontent.com/openai/codex/main/codex-rs/cloud-tasks/src/cli.rs · https://learn.chatgpt.com/docs/pricing · local: sources-openai-devday.md secțiunea E
- **Verificare adversarială:** CONFIRMED — cloud-tasks/src/cli.rs confirmă exec (--env obligatoriu, --attempts 1–4, --branch implicit branch-ul curent), status, list (--env, --limit 1–20, --cursor, --json), diff și apply cu --attempt; referința CLI confirmă statutul Experimental, câmpurile JSON și codex apply.

### Codex Cloud (Legacy): mediile vechi pentru Code Review și integrările GitHub și Linear, cu depreciere planificată (`oa-gap-codex-cloud-legacy`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/environments/cloud-environment
- **Documentație tehnică:** https://learn.chatgpt.com/docs/cloud/internet-access ; https://learn.chatgpt.com/docs/environments/cloud-environments ; https://help.openai.com/en/articles/11369540
- **Ce face:** Codex Cloud (Legacy) continuă să ofere mediile folosite de Code Review și de integrările GitHub și Linear: container universal (openai/codex-universal), script de setup și de mentenanță, variabile și secrete, acces la internet oprit implicit în faza agentului (configurabil limitat sau complet), proxy HTTP(S) pentru tot traficul; configurare în setările Codex pe chatgpt.com. OpenAI anunță intenția de a depreca această experiență, fără dată publicată. Noul Codex Cloud folosește medii reutilizabile publicate din desktop sau web; conform help center, la lansare mediile standard nu au taxă VM separată, iar consumul intră în limitele Codex și în credite. În Enterprise, setarea Use Codex in the cloud se moștenește din Legacy.
- **Plan necesar:** Codex Cloud: Plus eligibil, toate nivelurile Pro, Business, Enterprise, Healthcare, Education; nu Free sau Go; nu cu API key.
- **Platformă:** Cloud OpenAI (chatgpt.com)
- **Rollout:** Legacy activ, cu depreciere planificată fără calendar publicat.
- **Eligibilitate cont:** Nu se știe dacă proprietarul are medii Legacy sau integrări GitHub/Linear configurate.
- **Autentificare:** ChatGPT (MFA obligatoriu pentru conturile cu parolă).
- **Allowance:** Limitele Codex; Code Review prin GitHub are contabilizare proprie.
- **Utilizare partajată:** Alocarea comună Codex/Work.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Credite după epuizarea limitelor; nu există taxă VM separată pentru mediile standard la lansare.
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Configurare în UI (settings/environments); declanșare prin @codex review sau integrări. Nu există API documentat pentru mediile Legacy.
- **Suprafață nativă:** chatgpt.com Codex settings, GitHub, Linear
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință: Hub-ul nu construiește pe Legacy; dacă proprietarul activează review-uri automate GitHub, Hub-ul le înregistrează ca dependență cu termen de migrare.
- **Suprafață de execuție:** openai.codex_cloud
- **Echivalent la celălalt ecosistem:** an-cc-code-review-managed și an-cc-cloud-sessions
- **Ce face unic / mai bine:** Singurul suport actual pentru Code Review și integrările GitHub/Linear.
- **Securitate:** Codul și secretele mediului rulează în cloud OpenAI; activarea accesului la internet crește riscul de exfiltrare.
- **Cale de implementare:** Doar înregistrare în inventar și alertă la anunțul datei de depreciere.
- **Test necesar:** Niciunul (fără execuție).
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Completează oa-codex-cloud-environments, oa-codex-cloud-integrations și oa-codex-review-github-auto; data deprecierii nu este publicată.
- **Surse citite:** https://learn.chatgpt.com/docs/environments/cloud-environment.md · https://learn.chatgpt.com/docs/cloud.md · https://learn.chatgpt.com/docs/llms-full.txt (mențiuni Legacy) · https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
- **Verificare adversarială:** CONFIRMED — environments/cloud-environment.md are titlul Codex Cloud (Legacy) și susține în continuare Code Review și integrările Linear și GitHub. Pagina Cloud environments spune că OpenAI plănuiește să depreciere această experiență, fără dată. Confirmate: container universal (openai/codex-universal), scripturi de setup și mentenanță, secrete disponibile doar la setup, internetul agentului oprit implicit și cache de container de până la 12 ore. Help 11369540, citit prin browserul integrat, confirmă eligibilitatea (Plus eligibil, toate nivelurile Pro, Business, Enterprise, Healthcare, Education; nu Free sau Go), lipsa taxei VM separate la lansare pentru mediile standard și moștenirea setării cloud în Enterprise. Matricea din pricing marchează Codex cloud ca indisponibil cu API key.

## agents

### Istoricul sesiunilor Codex: thread/list, thread/read, thread/turns/list, thread/items/list, thread/loaded/list (`oa-codex-thread-history-mirror`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/app-server
- **Documentație tehnică:** https://learn.chatgpt.com/docs/app-server (thread/*) ; changelog 0.159.0 (paginare de la item)
- **Ce face:** Paginează firele salvate în CODEX_HOME cu filtre (sourceKinds cli, vscode, exec, appServer, subAgent*; cwd; searchTerm; archived; isPinned) și citește un fir fără a-l relua; thread/status/changed semnalează schimbări de stare.
- **Plan necesar:** Orice cont Codex
- **Platformă:** Orice platformă cu codex app-server
- **Rollout:** thread/list și thread/read documentate; thread/turns/list și thread/items/list experimentale (experimentalApi).
- **Eligibilitate cont:** Metode prezente în 0.158; nevalidate pe firele desktop ale proprietarului.
- **Autentificare:** ChatGPT
- **Allowance:** Nu consumă inferență.
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** thread/list{cursor, limit, sortKey created_at\|updated_at\|recency_at, sortDirection, modelProviders, sourceKinds, archived, isPinned, cwd, useStateDbOnly, searchTerm, parentThreadId\|ancestorThreadId (experimental)}; fără sourceKinds serverul returnează implicit doar sursele interactive cli și vscode, deci firele exec, appServer și subAgent* trebuie cerute explicit; thread/read{includeTurns}; thread/turns/list{itemsView} și thread/items/list{turnId} (experimentale); thread/loaded/list; notificarea thread/status/changed.
- **Suprafață nativă:** Selectorul de sesiuni din TUI (codex resume), lista de chaturi din desktop, codex agents.
- **Cerințe locale:** app-server pornit cu același CODEX_HOME ca desktopul/CLI-ul pentru a vedea aceleași fire.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Oglindă read-only a activității Codex a proprietarului, legată de misiunile Hub (metadate, stare, rezumat).
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** anthropic.claude_code_background: claude agents --json (sesiuni active cu status idle/busy).
- **Ce face unic / mai bine:** Istoric complet paginat, cu filtre pe sursă și pe arborele de subagenți.
- **Securitate:** Firele conțin prompturi, ieșiri de comenzi și diff-uri, posibil date sensibile; Hub-ul păstrează doar metadate și rezumate, nu citește direct fișierele rollout și nu copiază transcrieri integrale fără aprobare.
- **Cale de implementare:** Observator separat, fără turn/start în allowlist, pornit doar la cerere; mapare thread id → task Hub.
- **Test necesar:** thread/list pe CODEX_HOME implicit cu limit mic; confirmă dacă apar și firele create din desktop.
- **Status:** AVAILABLE
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** medium
- **Note:** Pe Windows, aplicația desktop folosește același CODEX_HOME ca CLI-ul nativ (%USERPROFILE%\.codex), deci firele ar trebui să fie în același depozit; sourceKind-ul atribuit firelor create din desktop nu este documentat și rămâne de verificat.
- **Surse citite:** https://learn.chatgpt.com/docs/app-server · https://learn.chatgpt.com/docs/changelog
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://learn.chatgpt.com/docs/app-server), notes (https://learn.chatgpt.com/docs/windows/windows-app)) — Metodele și filtrele sunt confirmate. Corectat: comportamentul implicit al sourceKinds (doar cli și vscode) ar ascunde firele proprii ale Hub-ului (appServer) dacă nu sunt cerute explicit.

### Daemonul app-server local partajat (codex app-server daemon; pornire automată din 0.157.0) (`oa-codex-shared-daemon`)

- **Sursă oficială:** https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server-daemon/README.md
- **Documentație tehnică:** https://learn.chatgpt.com/docs/changelog (Codex CLI 0.155.0, 0.156.0, 0.157.0) ; https://learn.chatgpt.com/docs/cli/reference (codex remote-control)
- **Ce face:** Server app-server detașat, cu socket de control în CODEX_HOME, la care se atașează TUI-ul, codex agents, remote control și clienții desktop/mobil; firele salvate și goals active se recuperează după restart; updater automat configurabil.
- **Plan necesar:** Orice plan cu Codex
- **Platformă:** Windows (terminal neelevat care permite procese detașate), macOS, Linux
- **Rollout:** Crate marcat experimental; pornire automată pentru sesiuni interactive eligibile din 0.157.0 (25.09.2026); /daemon și --no-daemon din 0.156.0; codex app-server daemon update din 0.155.0.
- **Eligibilitate cont:** Local: flagul daemon_auto_start=true; comenzile există în 0.158.
- **Autentificare:** ChatGPT (identitatea cu care rulează daemonul)
- **Allowance:** Daemonul nu consumă; turnurile rulate prin el consumă din plan.
- **Utilizare partajată:** Toți clienții atașați folosesc același cont și aceeași alocare.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Munca pusă în coadă sau goals reluate automat după restart pot consuma alocarea fără interacțiune.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** codex app-server daemon start\|restart\|update\|enable-remote-control\|disable-remote-control\|stop\|version\|bootstrap --remote-control (un singur obiect JSON pe stdout); setări în CODEX_HOME/app-server-daemon/settings.json (remoteControlEnabled, shutdownGraceSeconds, updater); codex app-server proxy (stdio → socketul de control); codex --remote unix://; thread/loaded/list pe conexiunea partajată.
- **Suprafață nativă:** TUI (/daemon), codex agents, desktop și mobil prin remote control.
- **Cerințe locale:** CODEX_HOME suficient de scurt pe Windows (adresa socketului AF_UNIX max. 108 octeți), altfel TUI-ul revine la server încorporat.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Doar observare (versiune, fire încărcate); execuția Hub rămâne pe app-server stdio propriu.
- **Suprafață de execuție:** openai.codex_app_server_daemon
- **Echivalent la celălalt ecosistem:** anthropic.claude_code_background: claude agents --json.
- **Ce face unic / mai bine:** Un singur runtime local pentru toți clienții Codex, cu recuperare după restart.
- **Securitate:** Clienții partajați folosesc mediul moștenit la pornirea daemonului, fără izolare per client; updaterul poate schimba binarul și întrerupe munca; orice client conectat prin proxy are drepturi complete (poate porni turnuri).
- **Cale de implementare:** Hub-ul nu execută prin daemon și nu îl pornește/oprește/actualizează fără aprobare; observator opțional prin codex app-server proxy cu allowlist read-only (thread/loaded/list, thread/list, thread/read) și codex app-server daemon version.
- **Test necesar:** codex app-server daemon version (JSON, fără inferență) pentru a vedea dacă rulează și ce versiune are.
- **Status:** AVAILABLE
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** medium
- **Note:** CODEX_EXEC_SERVER_URL setat face ca invocarea să ocolească atașarea implicită la daemon.
- **Surse citite:** https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server-daemon/README.md · https://raw.githubusercontent.com/openai/codex/main/codex-rs/cli/src/main.rs · https://learn.chatgpt.com/docs/changelog · https://learn.chatgpt.com/docs/developer-commands?surface=cli · local: sources-openai-devday.md secțiunea E
- **Verificare adversarială:** CONFIRMED — Confirmat în README-ul crate-ului app-server-daemon (experimental, comenzi cu un singur obiect JSON, settings.json, limita AF_UNIX de 108 octeți pe Windows, mediu moștenit fără izolare, CODEX_EXEC_SERVER_URL), în main.rs (app-server proxy --sock) și în changelog (0.155.0–0.157.0). README-ul mai spune că daemon update repornește daemonul și poate întrerupe munca activă sau din coadă, iar updaterul verifică implicit la cinci minute, apoi orar.

### Vizualizarea /agents: codex agents (agent command center) (`oa-codex-agents-overview`)

- **Sursă oficială:** local: sources-openai-devday.md (recap DevDay 2026, Codex CLI new form)
- **Documentație tehnică:** https://raw.githubusercontent.com/openai/codex/main/codex-rs/cli/src/main.rs (subcomanda Agents) ; https://learn.chatgpt.com/docs/changelog (0.155.0, 0.156.0)
- **Ce face:** Ecran TUI care listează toate sesiunile agent de pe daemonul partajat: filtrare după stare, creare de sesiuni în worktree, ascundere, arhivare și ștergere de taskuri, detalii despre worktree-urile gestionate.
- **Plan necesar:** Toate planurile (recap DevDay)
- **Platformă:** Windows, macOS, Linux
- **Rollout:** Livrat în CLI înainte de DevDay: agents overview apare în 0.155.0 (17.09.2026), iar command center cu filtrare pe stare și sesiuni în worktree în 0.156.0 (22.09.2026); prezentat la DevDay (29.09.2026); nu apare în tabelul de comenzi al referinței publice CLI; prezent în binarul local 0.158.
- **Eligibilitate cont:** Comanda codex agents există local.
- **Autentificare:** ChatGPT
- **Allowance:** Vizualizarea nu consumă; taskurile pornite din ea consumă.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Delegarea către mai mulți agenți în paralel multiplică consumul.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** codex agents [-C DIR] [--remote ...] [--no-alt-screen]; --no-daemon este respins; nu există ieșire --json. Echivalent programatic: thread/list, thread/loaded/list și thread/status/changed pe daemon.
- **Suprafață nativă:** Terminalul proprietarului.
- **Cerințe locale:** Daemon partajat activ.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Proprietarul îl folosește direct; Hub-ul reproduce aceeași imagine prin metodele app-server read-only.
- **Suprafață de execuție:** openai.codex_cli
- **Echivalent la celălalt ecosistem:** claude agents --json (anthropic) oferă JSON non-TTY; Codex nu oferă echivalent JSON pentru această vedere.
- **Ce face unic / mai bine:** Delegare și urmărire a mai multor taskuri din același terminal, cu worktree-uri integrate.
- **Securitate:** Ștergerea taskurilor și a worktree-urilor gestionate din această vedere este ireversibilă pentru munca necomisă.
- **Cale de implementare:** MIRROR_STATE prin app-server; nicio automatizare a TUI-ului.
- **Test necesar:** Niciun test care consumă; opțional thread/loaded/list pe daemon.
- **Status:** AVAILABLE
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** medium
- **Note:** Documentația publică numește funcția agents overview / agent command center.
- **Surse citite:** local: sources-openai-devday.md · https://raw.githubusercontent.com/openai/codex/main/codex-rs/cli/src/main.rs · https://learn.chatgpt.com/docs/changelog · https://learn.chatgpt.com/docs/cli/reference
- **Verificare adversarială:** CORRECTED (corectat: rollout (https://learn.chatgpt.com/docs/changelog ; https://raw.githubusercontent.com/openai/codex/main/codex-rs/cli/src/main.rs)) — Subcomanda Agents (sesiuni pe daemonul partajat, --no-daemon respins, -C, --no-alt-screen, fără --json) este confirmată în main.rs; corectată doar cronologia lansării.

### codex queue și cozi de prompturi (Queue/Steer) (`oa-codex-queue`)

- **Sursă oficială:** https://raw.githubusercontent.com/openai/codex/main/codex-rs/cli/src/queue_cmd.rs
- **Documentație tehnică:** https://learn.chatgpt.com/docs/developer-commands?surface=cli ; https://learn.chatgpt.com/docs/changelog
- **Ce face:** Pune un mesaj text în coada unei sesiuni existente (după UUID sau nume exact), livrat la următorul turn; în TUI, comenzile slash pot fi puse în coadă cu Tab; aplicația mobilă sincronizează prompturile din coadă cu gazda.
- **Plan necesar:** Toate planurile cu Codex
- **Platformă:** Windows, macOS, Linux
- **Rollout:** În binarul local 0.158; nu apare în referința publică CLI citită.
- **Eligibilitate cont:** Comanda codex queue există local.
- **Autentificare:** ChatGPT
- **Allowance:** Mesajul livrat pornește sau continuă un turn și consumă din plan.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul suplimentar față de un turn normal.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** codex queue --thread <UUID\|nume> --message <text> [--remote ws://\|unix://]; fără imagini. Echivalent app-server: turn/steer (turn activ) sau turn/start ulterior pe același fir.
- **Suprafață nativă:** TUI (Tab pentru a pune în coadă), mobil (Queue/Steer).
- **Cerințe locale:** Sesiune existentă, de regulă pe daemonul partajat.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Nicio utilizare pe sesiunile proprietarului; Hub-ul folosește turn/steer doar pe firele proprii.
- **Suprafață de execuție:** openai.codex_cli
- **Echivalent la celălalt ecosistem:** claude --input-format stream-json (mesaje în flux către o sesiune headless).
- **Ce face unic / mai bine:** Trimiterea de instrucțiuni către o sesiune deja pornită, din alt proces.
- **Securitate:** Injectarea de mesaje în sesiunile interactive ale proprietarului ar echivala cu acțiuni în numele lui.
- **Cale de implementare:** Nu se implementează pentru sesiuni externe; eventual doar cu aprobare explicită per mesaj.
- **Test necesar:** Niciunul (consumă la livrare).
- **Status:** AVAILABLE
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Recapul DevDay menționează queue printre îmbunătățirile CLI; detaliile provin din sursa open-source.
- **Surse citite:** https://raw.githubusercontent.com/openai/codex/main/codex-rs/cli/src/queue_cmd.rs · https://raw.githubusercontent.com/openai/codex/main/codex-rs/cli/src/main.rs · https://learn.chatgpt.com/docs/developer-commands?surface=cli · https://learn.chatgpt.com/docs/changelog
- **Verificare adversarială:** CONFIRMED — queue_cmd.rs confirmă --thread (UUID sau nume exact), --message nevid, opțiunile remote și refuzul imaginilor; referința CLI confirmă Tab pentru coadă și Enter pentru steer în TUI, iar changelog-ul iOS confirmă sincronizarea cozii cu gazda.

### Goal mode: /goal și thread/goal/set\|get\|clear (`oa-codex-goals`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/long-running-work
- **Documentație tehnică:** https://learn.chatgpt.com/docs/app-server (thread/goal/*) ; https://learn.chatgpt.com/docs/developer-commands?surface=cli (/goal)
- **Ce face:** Atașează unui fir un obiectiv persistent (max. 4.000 de caractere), folosit ca prim prompt și criteriu de finalizare; Codex lucrează spre el ore sau zile, cu pauză, reluare, editare și ștergere; goals active se recuperează după restartul daemonului și pot relua rulări blocate de limite.
- **Plan necesar:** Toate planurile cu Codex (goal mode nu mai e experimental din 21.05.2026)
- **Platformă:** Desktop, CLI, IDE
- **Rollout:** GA
- **Eligibilitate cont:** Flag local goals=true.
- **Autentificare:** ChatGPT
- **Allowance:** Consum susținut din plan, potențial pe mai multe ferestre de limită.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Rulări lungi autonome pot epuiza alocarea și apoi creditele existente; reluare după resetarea limitelor.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** thread/goal/set{threadId, objective (max. 4.000 de caractere), status, tokenBudget} → goal{objective, status, tokenBudget, tokensUsed, timeUsedSeconds}; thread/goal/get; thread/goal/clear; notificări thread/goal/updated și thread/goal/cleared; un obiectiv nou resetează contabilizarea consumului; TUI: /goal <obiectiv>, /goal edit\|pause\|resume\|clear.
- **Suprafață nativă:** Rândul de progres al goal-ului în desktop; /goal în CLI și IDE.
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Execuție de lungă durată pentru o misiune Hub, sub buget și cu oprire controlată de Hub.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** Nicio echivalență directă verificată în Claude Code în dovezile locale; se emulează prin bucla Hub peste claude -p --resume.
- **Ce face unic / mai bine:** Obiectiv persistent cu criteriu de finalizare și recuperare după restart.
- **Securitate:** Autonomie extinsă; Hub-ul impune timeout, prag de usedPercent și oprire (turn/interrupt, thread/goal/clear).
- **Cale de implementare:** Obiectivul misiunii rămâne canonic în Hub; doar cu grant explicit se oglindește într-un thread goal cu tokenBudget nativ derivat din bugetul misiunii, plus plafon de timp și prag de usedPercent la care Hub-ul face pauză (turn/interrupt, thread/goal/clear).
- **Test necesar:** Test simulat al notificărilor goal; live doar sub grant dedicat.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Obiectivele mai lungi se pun într-un fișier la care goal-ul face referire.
- **Surse citite:** https://learn.chatgpt.com/docs/long-running-work · https://learn.chatgpt.com/docs/app-server · https://learn.chatgpt.com/docs/developer-commands?surface=cli · https://learn.chatgpt.com/docs/changelog
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://learn.chatgpt.com/docs/app-server ; https://learn.chatgpt.com/docs/developer-commands?surface=cli), implementationPath (https://learn.chatgpt.com/docs/app-server)) — Metodele thread/goal/*, limita de 4.000 de caractere, ieșirea din experimental pe 21.05.2026 (26.519) și recuperarea după restartul daemonului sunt confirmate. Adăugat parametrul nativ tokenBudget, preferabil unui plafon reimplementat de Hub.

### Subagenți și agenți custom (multi_agent) (`oa-codex-subagents`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/agent-configuration/subagents
- **Documentație tehnică:** https://learn.chatgpt.com/docs/agent-configuration/subagents ; https://learn.chatgpt.com/docs/app-server (sourceKinds subAgent*, parentThreadId)
- **Ce face:** Codex lansează agenți specializați (built-in default, worker, explorer sau custom din fișiere TOML), le rutează instrucțiunile, așteaptă rezultatele și le consolidează în firul principal.
- **Plan necesar:** Toate planurile (tabel: Subagents and custom agents)
- **Platformă:** CLI, desktop, IDE; web doar vizualizare
- **Rollout:** Disponibil; multi_agent_v2 este stabil, dar oprit local.
- **Eligibilitate cont:** Flag local multi_agent=true.
- **Autentificare:** ChatGPT
- **Allowance:** Fiecare subagent consumă tokeni separat; totalul crește față de un singur agent.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Paralelismul multiplică consumul.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** [agents] enabled, max_threads, max_concurrent_threads_per_session, default_subagent_model, default_subagent_reasoning_effort; fișiere ~/.codex/agents/*.toml și .codex/agents/*.toml cu name, description, developer_instructions, model, sandbox_mode, mcp_servers, skills.config; subagenții apar ca fire sourceKinds subAgent*; /agent și /subagents în TUI.
- **Suprafață nativă:** Panoul de agenți de fundal (desktop), /agent (CLI).
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Delegare internă într-un task Codex, cu limită de paralelism impusă de Hub.
- **Suprafață de execuție:** openai.codex_cli
- **Echivalent la celălalt ecosistem:** claude --agents (JSON subagenți custom) și subagenții Claude Code.
- **Ce face unic / mai bine:** Agenții custom moștenesc sandbox-ul părintelui și pot avea MCP și skills proprii.
- **Securitate:** Subagenții moștenesc permisiunile părintelui; fișierele TOML din repo pot schimba comportamentul.
- **Cale de implementare:** Implicit agents.enabled=false sau max_threads mic pentru firele Hub; activare per misiune cu buget; subagenții raportați prin thread/list filtrat pe părinte.
- **Test necesar:** config/read pentru a verifica override-ul; niciun turn.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Orchestrarea între agenți la nivel de companie rămâne în Hub.
- **Surse citite:** https://learn.chatgpt.com/docs/agent-configuration/subagents · https://learn.chatgpt.com/docs/app-server · local: sources-openai-devday.md secțiunea E
- **Verificare adversarială:** CONFIRMED — Confirmat: agenții built-in default, worker și explorer, fișierele TOML personale și de proiect, câmpurile [agents] (max_threads este alias legacy pentru max_concurrent_threads_per_session), moștenirea sandbox-ului și consumul mai mare de tokeni. În fluxurile non-interactive, acțiunile care cer o aprobare nouă eșuează și sunt raportate firului părinte.

### Import din Claude Code/Cursor (/import, externalAgentConfig) (`oa-codex-import-external-agent`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/import
- **Documentație tehnică:** https://learn.chatgpt.com/docs/app-server (externalAgentConfig/detect\|import) ; https://learn.chatgpt.com/docs/developer-commands?surface=cli (/import)
- **Ce face:** Detectează și migrează setări, instrucțiuni, skills, pluginuri, config MCP, subagenți, proiecte și până la 50 de chaturi din ultimele 30 de zile din Claude Code sau Cursor (desktopul și din Claude Cowork), cu sincronizare automată opțională în desktop.
- **Plan necesar:** Toate planurile cu Codex
- **Platformă:** Desktop, CLI
- **Rollout:** Disponibil
- **Eligibilitate cont:** Metodele există în 0.158.
- **Autentificare:** ChatGPT
- **Allowance:** Detectarea nu consumă.
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** externalAgentConfig/detect {includeHome, cwds} (citire); externalAgentConfig/import {migrationItems, source} (scriere; itemType: AGENTS_MD, CONFIG, SKILLS, PLUGINS, MCP_SERVER_CONFIG, SUBAGENTS, HOOKS, COMMANDS, SESSIONS); externalAgentConfig/import/readHistories; /import în TUI. Documentația spune că /import nu este disponibil în sesiuni remote sau conectate la daemon, dar changelog-ul 0.157.0 afirmă că a fost activat acolo; conflictul trebuie verificat pe binarul local.
- **Suprafață nativă:** Settings > Import (desktop), /import (TUI).
- **Cerințe locale:** Configurații Claude Code existente pe mașină.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Detectarea divergențelor dintre configurația Claude și cea Codex; sursa canonică rămâne Hub-ul.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** Nicio funcție inversă (Codex → Claude) verificată.
- **Ce face unic / mai bine:** Migrare oficială inter-vendor, inclusiv skills și MCP.
- **Securitate:** Importul poate copia variabile de mediu MCP sau setări sensibile; nu se rulează automat.
- **Cale de implementare:** Doar detect în observator; Hub-ul generează singur AGENTS.md și CLAUDE.md din sursa canonică; importul efectiv doar cu aprobare.
- **Test necesar:** externalAgentConfig/detect cu cwd-ul proiectului (fără inferență), ignorând home-ul dacă nu e aprobat.
- **Status:** AVAILABLE
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** medium
- **Note:** Detectarea în home poate atinge ~/.claude: se rulează doar cu includeHome=false până la aprobare.
- **Surse citite:** https://learn.chatgpt.com/docs/import · https://learn.chatgpt.com/docs/app-server · https://learn.chatgpt.com/docs/developer-commands?surface=cli
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://learn.chatgpt.com/docs/app-server ; https://learn.chatgpt.com/docs/import ; https://learn.chatgpt.com/docs/changelog)) — Sursele (Claude Code, Claude Cowork doar în desktop, Cursor), tipurile importate și limita CLI de 50 de chaturi din ultimele 30 de zile sunt confirmate; semnalat conflictul documentație/changelog privind /import în sesiunile daemon.

### dots (agenți mereu activi cu computer propriu în cloud) (`oa-dots`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/dots.md
- **Documentație tehnică:** https://learn.chatgpt.com/docs/dots/computers-and-apps.md
- **Ce face:** Agent pe GPT-6 Astra cu computer și browser propriu în cloud, care lucrează proactiv spre un obiectiv, folosește pluginurile conectate, deleagă sarcini în Codex/Work, are note proprii și memoria ChatGPT, și poate folosi un singur calculator personal conectat.
- **Plan necesar:** Pro 100/200/500 doar pentru utilizatori peste 18 ani în afara SEE, Regatului Unit și Elveției; Business Premium și Enterprise la nivel mondial (Enterprise oprit implicit)
- **Platformă:** ChatGPT desktop și web desktop, apoi mobil; canale Slack, Microsoft Teams, apel vocal; SMS în curând
- **Rollout:** Rollout gradual
- **Eligibilitate cont:** Dacă contul este în România (SEE) pe un plan Pro, dots nu este disponibil; țara contului nu este confirmată.
- **Autentificare:** Cont ChatGPT; pluginurile folosesc permisiunile existente
- **Allowance:** Conversațiile cu dot nu consumă limitele ChatGPT; sarcinile pornite în Work/Codex consumă normal; limite extinse în prima lună
- **Utilizare partajată:** Work + Codex pentru sarcinile delegate
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** Recap-ul anunță scalare viitoare (mai mulți dots, mai multă muncă) — probabil plătită; sarcinile delegate pot trece în credite dacă există sold.
- **Risc de facturare API:** low
- **Integrare programatică:** NONE
- **Detaliu integrare:** Nicio interfață API, MCP, webhook sau adresă de e-mail documentată pentru dots.
- **Suprafață nativă:** Profilul dot în ChatGPT, Activity, Scheduled, Custom Rules
- **Cerințe locale:** Pentru acces local: aplicația ChatGPT deschisă și online; un singur calculator
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Referință de produs; Hub-ul nu conectează un dot la acest PC și nu îl orchestrează.
- **Suprafață de execuție:** openai.dots
- **Echivalent la celălalt ecosistem:** Anthropic: Claude Cowork (anthropic.claude_cowork) și rutine cloud (anthropic.claude_routines_cloud) — paritatea nu a fost verificată
- **Ce face unic / mai bine:** Agent persistent cu reguli personalizate (fără întrebare / la cerere / cu aprobare / predare), auto-review înaintea acțiunilor sensibile și Activity view.
- **Securitate:** Acces la conturi și la calculatorul personal; oprirea nu anulează acțiunile deja făcute; parolele sensibile rămân la utilizator.
- **Cale de implementare:** Niciuna până la eligibilitate și o interfață documentată
- **Test necesar:** n/a
- **Status:** PLAN_RESTRICTED
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Accesul local al unui dot este separat de conexiunile Work/Codex Sync și trebuie revocat manual.
- **Surse citite:** https://learn.chatgpt.com/docs/dots.md · https://learn.chatgpt.com/docs/dots/getting-started.md · https://learn.chatgpt.com/docs/dots/computers-and-apps.md · https://learn.chatgpt.com/docs/dots/controls.md · https://learn.chatgpt.com/docs/dots/channels.md · https://learn.chatgpt.com/docs/dots/tasks-and-memory.md · https://learn.chatgpt.com/docs/enterprise/cloud-local-access.md · https://openai.com/index/introducing-dots/ (captură locală)
- **Verificare adversarială:** CONFIRMED — Learn dots confirmă: Pro 100/200/500 doar pentru utilizatori peste 18 ani, în afara SEE, Regatului Unit și Elveției; Business Premium și Enterprise la nivel mondial (Enterprise oprit implicit). Conversațiile nu consumă limitele, iar sarcinile delegate le consumă. Canalele sunt ChatGPT, apel, Slack și Teams; se poate conecta un singur calculator. Nu am găsit API, webhook sau MCP. Restricția este regională, deci PLAN_RESTRICTED depinde de țara contului, încă neconfirmată.

### Agents API (harness Codex gestionat de OpenAI) (`oa-agents-api`)

- **Sursă oficială:** https://developers.openai.com/api/docs/guides/agents-api/overview.md
- **Documentație tehnică:** https://developers.openai.com/api/docs/guides/agents-api/quickstart
- **Ce face:** API beta care creează sesiuni durabile cu model, unelte (MCP HTTP, funcții, web search, programmatic tool calling), subagenți (max_concurrent_subagents), vault-uri de secrete, medii openai_hosted sau proprii și directoare de capabilități (skills); compactare automată și recuperare.
- **Plan necesar:** Cont API (cheie API)
- **Platformă:** HTTP API
- **Rollout:** Public beta
- **Eligibilitate cont:** Nu există cont API pentru Hub; politica interzice API billing
- **Autentificare:** Doar cheie API (Bearer); autentificarea ChatGPT nu este menționată
- **Allowance:** Fără plan inclus
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Tokeni la prețuri API, uneltele la tarife standard, sandbox-urile găzduite la tarife de container; rezidență doar SUA; fără ZDR.
- **Risc de facturare API:** high
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Sesiuni/turn-uri/evenimente, webhook-uri de sesiune, tracing; ruta SIWC acceptă doar POST /v1/responses, deci nici planul ChatGPT nu poate fi folosit aici.
- **Suprafață nativă:** n/a
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Doar referință de arhitectură; echivalentul pe abonament este Codex app-server local (același harness open source), deja folosit de V2.
- **Suprafață de execuție:** openai.agents_api
- **Echivalent la celălalt ecosistem:** Anthropic: Claude Agent SDK/API (facturare API, refuzat la fel); echivalent pe abonament: anthropic.claude_code_headless
- **Ce face unic / mai bine:** Harness gestionat cu subagenți, vault-uri și medii partenere
- **Securitate:** Secrete în vault-uri cloud; date doar în SUA
- **Cale de implementare:** Niciuna
- **Test necesar:** Testul BillingPolicy trebuie să refuze această rută
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Recap: niciun cost pentru API-ul în sine; se plătesc tokenii și uneltele.
- **Surse citite:** https://developers.openai.com/api/docs/guides/agents-api/overview.md · https://developers.openai.com/api/docs/llms.txt · https://developers.openai.com/api/docs/pricing.md · https://openai.com/index/introducing-the-agents-api/ (captură locală)
- **Verificare adversarială:** CONFIRMED — Ghidul Agents API confirmă: model facturat la tarifele API, unelte la tarife standard, sandbox-uri găzduite la tarife de container, antetul OpenAI-Beta: agents=v1, autentificare cu cheie API. Rezidența datelor este doar în SUA, fără ZDR. BLOCKED/REJECT sunt consecvente cu politica.

### ChatGPT Work (agent pentru sarcini lungi, cu livrabile) (`oa-chatgpt-work`)

- **Sursă oficială:** https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex
- **Documentație tehnică:** https://learn.chatgpt.com/docs/get-started-with-work.md
- **Ce face:** Mod agentic în ChatGPT pentru cercetare, analize, documente, foi de calcul, prezentări, rapoarte și Sites; rulează în cloud pe web/mobil și poate folosi fișiere și aplicații locale în desktop; modele GPT-6.1 Sol, GPT-6 Sol, Luna (doar în Work/Codex) și Astra; voce; sarcini programate sau pe evenimente.
- **Plan necesar:** Web și mobil: planuri plătite eligibile. Desktop: când Work este inclus în plan și în workspace (pagina de prețuri learn afirmă că Work și Codex sunt incluse și în Free/Go, cu GPT-6 Luna în desktop, sub rezerva rollout-ului). Pro 100/200 și Business Premium folosesc întreaga alocare pentru Astra; Plus și Business Standard au Astra limitat. Ultrafast: doar Pro 500 și Enterprise/Edu eligibile.
- **Platformă:** ChatGPT web, mobil, desktop (macOS, Windows)
- **Rollout:** Disponibil; Work Cloud sync în extindere
- **Eligibilitate cont:** Neverificată în V2 (planul raportat de V1 „prolite” nu este confirmat).
- **Autentificare:** Cont ChatGPT
- **Allowance:** Aceeași structură de utilizare ca Codex; planurile Pro nu au limită de 5 ore (learn pricing)
- **Utilizare partajată:** Work și Codex partajează utilizarea (inclusiv aplicațiile SIWC)
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** După alocare, utilizarea continuă din soldul de credite dacă există; Ultrafast doar pe Pro 500.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Nicio interfață programatică documentată pentru Work. Calea programatică soră este Codex app-server (JSON-RPC, login ChatGPT), care consumă același pool; model/list este catalog, nu dovadă de drept de acces.
- **Suprafață nativă:** Comutatorul Chat/Work în ChatGPT; Work Local/Cloud în desktop
- **Cerințe locale:** ChatGPT desktop pentru acces la fișiere locale
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Proprietarul folosește Work pentru livrabile; Hub-ul pregătește brieful și importă rezultatul; sarcinile automate ale Hub-ului rulează prin Codex app-server.
- **Suprafață de execuție:** openai.chatgpt_work
- **Echivalent la celălalt ecosistem:** Anthropic: Claude Cowork (anthropic.claude_cowork) și Claude Code interactiv (anthropic.claude_code_interactive)
- **Ce face unic / mai bine:** Aceleași capabilități ca Codex într-o experiență pentru muncă non-cod; sincronizare între dispozitive.
- **Securitate:** Mesajele și contextul pot fi stocate în cloud chiar și pentru sarcini locale; acces la fișiere și aplicații locale cu permisiune.
- **Cale de implementare:** Șablon de brief în Hub + import manual al livrabilului cu proveniență
- **Test necesar:** n/a (nu se pornește inferență)
- **Status:** ELIGIBILITY_UNKNOWN
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Help-ul precizează că login-ul Codex cu ChatGPT folosește utilizarea și facturarea planului, iar cheia API folosește prețuri API.
- **Surse citite:** https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex · https://learn.chatgpt.com/docs/get-started-with-work.md · https://learn.chatgpt.com/docs/pricing.md · https://learn.chatgpt.com/docs/enterprise/chatgpt-work-usage-and-cost.md · https://learn.chatgpt.com/docs/enterprise/cloud-local-access.md · https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers
- **Verificare adversarială:** CORRECTED (corectat: planRequired (https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex; https://learn.chatgpt.com/docs/pricing.md)) — Sunt confirmate: utilizarea comună Work–Codex, lipsa limitei de 5 ore pe Pro, trecerea la credite după alocare dacă există sold, faptul că login-ul Codex cu ChatGPT folosește planul (iar cheia API, prețurile API), stocarea în cloud a contextului chiar și pentru sarcinile locale și lipsa unei interfețe programatice pentru Work.

### ChatGPT agent (mod agent, retras) (`oa-chatgpt-agent-mode-legacy`)

- **Sursă oficială:** https://help.openai.com/en/articles/11752874-chatgpt-agent
- **Documentație tehnică:** n/a
- **Ce face:** Modul agent nu mai este disponibil; OpenAI trimite utilizatorii către ChatGPT Work și cloud browser.
- **Plan necesar:** n/a
- **Platformă:** n/a
- **Rollout:** Retras
- **Eligibilitate cont:** n/a
- **Autentificare:** n/a
- **Allowance:** Istoric: 40 mesaje/lună Plus, 400 Pro
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** n/a
- **Risc de facturare API:** none
- **Integrare programatică:** NONE
- **Detaliu integrare:** n/a
- **Suprafață nativă:** n/a
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** NONE
- **Rol propus:** Niciunul; eliminat din planificare
- **Suprafață de execuție:** openai.chatgpt_chat
- **Echivalent la celălalt ecosistem:** n/a
- **Ce face unic / mai bine:** n/a
- **Securitate:** n/a
- **Cale de implementare:** n/a
- **Test necesar:** n/a
- **Status:** NOT_APPLICABLE
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** high
- **Note:** Sarcinile programate care îl foloseau trebuie refăcute în Work.
- **Surse citite:** https://help.openai.com/en/articles/11752874-chatgpt-agent
- **Verificare adversarială:** CONFIRMED — Help 11752874 confirmă: ChatGPT agent nu mai este disponibil, utilizatorii sunt îndrumați spre Work și cloud browser, iar limitele istorice erau 40 de mesaje/lună pe Plus și 400 pe Pro.

### ChatGPT Workspace Agents și declanșarea lor prin API (`oa-workspace-agents`)

- **Sursă oficială:** https://help.openai.com/en/articles/20001143-chatgpt-workspace-agents-for-enterprise-and-business
- **Documentație tehnică:** https://developers.openai.com/workspace-agents/trigger-runs.md
- **Ce face:** Agenți construiți în workspace (instrucțiuni, aplicații, MCP personalizate, skills, fișiere până la 512 MB/fișier și 10 GB/agent), publicați în ChatGPT, Slack, pe program sau prin API; Connector Action Constraints și aprobări pentru scrieri.
- **Plan necesar:** Business și Enterprise (Enterprise oprit implicit)
- **Platformă:** ChatGPT, Slack, API api.chatgpt.com, plugin Workspace Agents în Codex
- **Rollout:** Disponibil; statusul rulărilor în beta
- **Eligibilitate cont:** Neeligibil pe un plan individual
- **Autentificare:** Workspace Agent access token (Admin > Access tokens, scope Workspace Agents), nu cheie API
- **Allowance:** Nedocumentat
- **Utilizare partajată:** Workspace
- **Inclus în abonament?:** unknown
- **Risc de facturare suplimentară (credite/extra usage):** Probabil credite de workspace (nedocumentat în sursele citite); ar cere plan Business.
- **Risc de facturare API:** unknown
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** POST https://api.chatgpt.com/v1/workspace_agents/{id}/trigger (input, conversation_key, Idempotency-Key) → 202 cu URL de conversație; GET .../runs/{run_id} cu antet OpenAI-Beta: workspace_agent_runs=v1; răspunsul agentului nu poate fi citit prin API.
- **Suprafață nativă:** Agents în bara laterală ChatGPT
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință: model de declanșare idempotentă compatibil cu Hub-ul, dacă proprietarul trece vreodată pe Business.
- **Suprafață de execuție:** openai.workspace_agents
- **Echivalent la celălalt ecosistem:** Anthropic: neverificat
- **Ce face unic / mai bine:** Singura cale documentată de a porni un agent ChatGPT din backend cu autentificare ChatGPT
- **Securitate:** Conturi deținute de agent pentru conexiuni; exfiltrare prin acțiuni de scriere.
- **Cale de implementare:** Niciuna
- **Test necesar:** n/a
- **Status:** PLAN_RESTRICTED
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Help-ul spune că API-ul nu returnează run ID, iar documentația developer îl oferă cu antetul beta — diferență de detaliu.
- **Surse citite:** https://help.openai.com/en/articles/20001143-chatgpt-workspace-agents-for-enterprise-and-business · https://developers.openai.com/workspace-agents/llms-full.txt · https://developers.openai.com/workspace-agents/authentication.md · https://developers.openai.com/workspace-agents/trigger-runs.md · https://learn.chatgpt.com/docs/enterprise/access-tokens.md
- **Verificare adversarială:** CONFIRMED — Help 20001143 și ghidul trigger-runs confirmă: Business și Enterprise (Enterprise oprit implicit), fișiere de maximum 512 MB fiecare și 10 GB per agent, POST .../trigger cu 202 și Idempotency-Key, run ID doar cu antetul beta workspace_agent_runs=v1, iar răspunsul agentului nu se poate citi prin API.

### Custom GPTs: retragere planificată și migrarea fluxurilor către pluginuri (`oa-gap-custom-gpts`)

- **Sursă oficială:** https://help.openai.com/en/articles/8554407-gpts-in-chatgpt
- **Documentație tehnică:** https://learn.chatgpt.com/docs/migrate-custom-gpts
- **Ce face:** GPT-urile personalizate combină instrucțiuni, fișiere de knowledge, capabilități (web search, imagini, analiză de date) și fie apps, fie actions custom. OpenAI plănuiește retragerea lor în favoarea pluginurilor: pentru workspace-urile Enterprise afectate retragerea este planificată pentru 11 decembrie 2026, migrarea fiind țintită pentru 17 septembrie 2026; celelalte planuri ar urma același calendar. Pe conturile personale (Free, Go, Plus, Pro) crearea și publicarea de GPT-uri noi nu mai sunt disponibile, iar cele existente rămân utilizabile până la retragere. Instrucțiunile și fișierele devin skill-uri; acțiunile custom nu se transferă și se refac ca apps sau server MCP.
- **Plan necesar:** Utilizare: toate planurile. Creare: nu pe conturile personale (help center); Business/Enterprise/Edu după setările workspace-ului.
- **Platformă:** ChatGPT web, desktop, mobil
- **Rollout:** În retragere
- **Eligibilitate cont:** Cont personal: fără creare de GPT-uri noi.
- **Autentificare:** Sesiunea ChatGPT
- **Allowance:** Limitele Chat
- **Utilizare partajată:** Chat
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul
- **Risc de facturare API:** none
- **Integrare programatică:** NONE
- **Detaliu integrare:** Niciun API pentru Hub; migrarea se face în UI (Enterprise: și în bloc, de către admin).
- **Suprafață nativă:** Explore GPTs, editorul GPT
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Hub-ul nu construiește pe GPT-uri; procedurile companiei rămân Agent Skills și pluginuri portabile.
- **Suprafață de execuție:** openai.chatgpt_chat
- **Echivalent la celălalt ecosistem:** an-claudeai-projects și an-claudeai-skills (instrucțiuni și cunoștințe reutilizabile)
- **Ce face unic / mai bine:** Niciuna relevantă pentru Hub, dat fiind calendarul de retragere.
- **Securitate:** Acțiunile custom trimit date către API-uri externe; nu se migrează fără revizuire.
- **Cale de implementare:** Niciuna; eventualele GPT-uri existente ale proprietarului se inventariază manual și se convertesc în skills.
- **Test necesar:** Niciunul
- **Status:** PLAN_RESTRICTED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Contradicție între surse: pagina de prețuri afișează încă Creează și partajează GPT-uri pentru Go/Plus/Pro, iar help center (actualizat pe 2026-09-29) spune că crearea nu mai este disponibilă pe conturile personale.
- **Surse citite:** https://help.openai.com/en/articles/8554407-gpts-in-chatgpt · https://learn.chatgpt.com/docs/migrate-custom-gpts.md · https://chatgpt.com/pricing
- **Verificare adversarială:** CONFIRMED — Help 8554407 (actualizat pe 2026-09-29, citit prin browserul integrat) confirmă: retragere planificată pe 11 decembrie 2026 pentru workspace-urile Enterprise afectate, migrare țintită pe 17 septembrie 2026, celelalte planuri urmând același calendar. Pe conturile personale (Free, Go, Plus, Pro) crearea și publicarea de GPT-uri noi nu mai sunt disponibile, iar cele existente rămân utilizabile. Un GPT poate folosi apps sau actions, nu ambele. migrate-custom-gpts.md confirmă că instrucțiunile și fișierele devin skill, iar acțiunile custom se refac ca app sau server MCP; pagina nu conține date. Contradicția este reală: pagina de prețuri ro-RO afișează încă GPT-uri personalizate pe cardurile Plus și Pro.

### OpenAI Agents SDK (Python și TypeScript, open source) (`oa-gap-agents-sdk`)

- **Sursă oficială:** https://developers.openai.com/api/docs/guides/agents/sdk
- **Documentație tehnică:** https://github.com/openai/openai-agents-python ; https://github.com/openai/openai-agents-js ; https://developers.openai.com/api/docs/guides/agents
- **Ce face:** Bibliotecă open source (licență MIT, conform depozitelor) pentru a construi agenți în propria aplicație: agenți cu instrucțiuni și unelte, handoffs și agents-as-tools, guardrails, human-in-the-loop, sesiuni, tracing, sandbox agents și, în TypeScript, agenți realtime. Documentația OpenAI o poziționează între Agents API (harness Codex gestionat) și Responses API. Depozitele se descriu ca provider-agnostic (Python: peste 100 de modele prin integrări opționale precum LiteLLM sau any-llm).
- **Plan necesar:** Cont API OpenAI (cheie API) pentru modelele OpenAI; nu folosește abonamentul ChatGPT.
- **Platformă:** Python, Node.js/TypeScript
- **Rollout:** GA (open source)
- **Eligibilitate cont:** n/a
- **Autentificare:** API key OpenAI sau cheile altor provideri
- **Allowance:** Facturare API per token
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Inferența prin OpenAI API este interzisă de BillingPolicy; providerii terți pot fi și ei plătiți.
- **Risc de facturare API:** high
- **Integrare programatică:** NONE
- **Detaliu integrare:** Nu există rută cu autentificare de abonament; SDK-ul ar putea fi folosit doar ca bibliotecă de orchestrare cu modele locale (nevalidat), ceea ce ar dubla funcții pe care Hub-ul le deține deja.
- **Suprafață nativă:** n/a (bibliotecă)
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință pentru tipare de orchestrare (handoffs, guardrails, sesiuni, tracing); fără dependență de runtime în V2.
- **Suprafață de execuție:** openai.agents_sdk
- **Echivalent la celălalt ecosistem:** an-cc-agent-sdk (Claude Agent SDK)
- **Ce face unic / mai bine:** Primitive clare pentru handoffs și guardrails; suport pentru provideri multipli.
- **Securitate:** Tracing-ul este integrat și activ implicit pe calea server-side a SDK-ului: fiecare rulare poate trimite înregistrări cu apeluri de model, unelte, handoffs și guardrails către Traces dashboard din platforma OpenAI. Trebuie dezactivat explicit dacă SDK-ul ar fi folosit vreodată. Fără chei API în mediul Hub.
- **Cale de implementare:** Doar studiu de design; nicio instalare de pachete.
- **Test necesar:** Niciunul
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** executionSurface nou propus: openai.agents_sdk. Licența MIT este confirmată prin GitHub API pentru ambele depozite. Ultimele versiuni: openai-agents-python v0.22.3 (2026-09-17) și openai-agents-js v0.18.0 (2026-09-10). README-ul Python confirmă caracterul provider-agnostic (Responses, Chat Completions și peste 100 de alte LLM-uri, prin any-llm și LiteLLM).
- **Surse citite:** https://developers.openai.com/api/docs/guides/agents/sdk.md · https://developers.openai.com/api/docs/guides/agents.md · https://github.com/openai/openai-agents-python · https://github.com/openai/openai-agents-js
- **Verificare adversarială:** CORRECTED (corectat: securityConcerns (https://developers.openai.com/api/docs/guides/agents/integrations-observability.md (Tracing)), notes (https://github.com/openai/openai-agents-python ; https://github.com/openai/openai-agents-js)) — Ghidul Agents SDK confirmă depozitele oficiale, primitivele (handoffs, guardrails, human review, sandbox agents, results/state) și diferența față de Agents API, unde harness-ul gestionat rulează în serviciul OpenAI. Nu există rută cu autentificare de abonament, deci apiBillingRisk high, NONE, DOCUMENTED și REFERENCE rămân corecte. Corecțiile rezolvă cele două puncte lăsate deschise: destinația tracing-ului și versiunile.

### Unealta Plugins din Agents API (pachete de skills + configurație MCP reutilizabile între sesiuni) (`oa-gap-agents-api-plugins-tool`)

- **Sursă oficială:** https://developers.openai.com/api/docs/guides/agents-api/tools/plugins
- **Documentație tehnică:** https://developers.openai.com/api/docs/guides/agents-api/tools/plugins.md ; https://developers.openai.com/plugins/build/plugins
- **Ce face:** Un plugin împachetează skills, configurație MCP sau ambele: .codex-plugin/plugin.json declară "skills": "./skills/" și "mcpServers": "./.mcp.json" (căi relative care încep cu ./, fără ..). Într-un sandbox self-hosted, rădăcina pluginului se adaugă în environment.capability_directories; într-un sandbox găzduit de OpenAI se trimite câte un ZIP per plugin în environment.plugins, cu nume și descriere identice cu manifestul. Sesiunile se creează cu client.beta.agents.sessions.create.
- **Plan necesar:** Cont API OpenAI (Agents API, facturare pe tokeni și unelte).
- **Platformă:** OpenAI API (beta)
- **Rollout:** Public beta (Agents API)
- **Eligibilitate cont:** n/a
- **Autentificare:** API key
- **Allowance:** Facturare API
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Facturare API pentru tokeni și unelte; sandbox-uri partenere cu costuri proprii.
- **Risc de facturare API:** high
- **Integrare programatică:** NONE
- **Detaliu integrare:** Rută disponibilă doar cu API key; interzisă de BillingPolicy. Formatul .codex-plugin/plugin.json este același cu cel al pluginurilor Codex.
- **Suprafață nativă:** n/a
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință de format: skill-urile Hub (SKILL.md) pot fi împachetate în formatul .codex-plugin pentru portabilitate între Codex, pluginuri ChatGPT și Agents API, fără execuție prin Agents API.
- **Suprafață de execuție:** openai.agents_api
- **Echivalent la celălalt ecosistem:** an-cc-plugins (plugin.json Claude Code) și std-agent-skills-spec
- **Ce face unic / mai bine:** Același pachet reutilizabil între suprafețele OpenAI.
- **Securitate:** Pluginurile încărcate într-un sandbox găzduit trimit cod și configurație la OpenAI; serverele MCP din plugin au acces la rețea.
- **Cale de implementare:** Niciuna în runtime; eventual un exportator de format în V2, după decizie.
- **Test necesar:** Niciunul
- **Status:** BLOCKED
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Extinde oa-agents-api (REJECT), care nu menționa unealta Plugins.
- **Surse citite:** https://developers.openai.com/api/docs/guides/agents-api/tools/plugins.md · https://developers.openai.com/api/docs/llms.txt
- **Verificare adversarială:** CONFIRMED — developers.openai.com/api/docs/guides/agents-api/tools/plugins.md confirmă: .codex-plugin/plugin.json cu "skills": "./skills/" și "mcpServers": "./.mcp.json"; căi care încep cu ./, fără ..; environment.capability_directories pentru self_hosted; câte un ZIP per plugin în environment.plugins pentru openai_hosted, cu nume și descriere identice cu manifestul. Sesiunile se creează cu client.beta.agents.sessions.create. Ruta cere API key și facturare API; BLOCKED și REFERENCE sunt corecte.

## memory

### Memories locale Codex (`oa-codex-memories`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/customization/memories
- **Documentație tehnică:** https://learn.chatgpt.com/docs/customization/memories ; https://learn.chatgpt.com/docs/pricing (Memories Limited*)
- **Ce face:** Transformă contextul util din conversațiile eligibile în fișiere locale de memorie în ~/.codex/memories (CODEX_HOME), cu redactarea secretelor și generare asincronă, folosite ca strat de reamintire în sesiunile viitoare.
- **Plan necesar:** Tabel pricing: Limited* (regional) pe toate planurile; disponibil în SEE/UK/CH din 16.06.2026.
- **Platformă:** Desktop, CLI (TUI), IDE
- **Rollout:** Disponibil, cu limitări regionale.
- **Eligibilitate cont:** Flag local memories=true.
- **Autentificare:** ChatGPT
- **Allowance:** Generarea folosește modele (memories.extract_model, consolidation_model) și se oprește sub memories.min_rate_limit_remaining_percent, deci consumă din plan.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Consum de fundal greu de atribuit unui task.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** [features] memories; memories.generate_memories, use_memories, disable_on_external_context, no_memories_if_mcp_or_web_search, min_rate_limit_remaining_percent; /memories per chat; override per proces prin -c.
- **Suprafață nativă:** Settings > Personalization (desktop), /memories (TUI).
- **Cerințe locale:** CODEX_HOME local.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Memoria canonică rămâne în Hub; memoriile Codex sunt strat local derivat, oprit pentru firele Hub.
- **Suprafață de execuție:** openai.codex_cli
- **Echivalent la celălalt ecosistem:** CLAUDE.md și memoria automată Claude Code.
- **Ce face unic / mai bine:** Reamintire automată între sesiuni fără configurare.
- **Securitate:** Memoriile pot conține detalii private ale proiectelor; nu se editează manual ca mecanism de control; Hub-ul nu le copiază.
- **Cale de implementare:** Pentru firele rulate de Hub: use_memories=false și generate_memories=false prin override de proces, pentru reproductibilitate și fără consum ascuns; setările proprietarului rămân neatinse.
- **Test necesar:** config/read pentru a confirma override-ul (fără inferență).
- **Status:** AVAILABLE
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** ChatGPT web folosește o memorie separată de cea locală Codex.
- **Surse citite:** https://learn.chatgpt.com/docs/customization/memories · https://learn.chatgpt.com/docs/pricing · https://learn.chatgpt.com/docs/changelog
- **Verificare adversarială:** CONFIRMED — Pagina Memories confirmă fișierele din ~/.codex/memories, redactarea secretelor, generarea în fundal oprită sub pragul min_rate_limit_remaining_percent și cheile de configurare; memoriile locale sunt dezactivate implicit (local, flagul memories apare activ). Changelog-ul din 16.06.2026 confirmă disponibilitatea în SEE/UK/CH, dezactivată implicit acolo.

### Memoria ChatGPT (saved memories, chat history) și memoriile locale Codex (`oa-chatgpt-memory`)

- **Sursă oficială:** https://help.openai.com/en/articles/8590148-memory-faq
- **Documentație tehnică:** https://learn.chatgpt.com/docs/customization/memories.md
- **Ce face:** ChatGPT reține preferințe și context din chaturi, memorii salvate, instrucțiuni, fișiere și aplicații conectate; rezumat al memoriei, surse, corectare și ștergere. Codex local păstrează memorii separate în ~/.codex/memories/.
- **Plan necesar:** Controalele variază după plan, regiune și workspace
- **Platformă:** ChatGPT web/desktop/mobil; Codex CLI/IDE/desktop
- **Rollout:** GA
- **Eligibilitate cont:** Codex: flagul memories este activ local; memoria ChatGPT a contului neverificată
- **Autentificare:** Cont ChatGPT
- **Allowance:** Generarea memoriilor Codex se oprește sub pragul memories.min_rate_limit_remaining_percent
- **Utilizare partajată:** Codex rate limits
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul
- **Risc de facturare API:** none
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Memoria ChatGPT nu are API. Codex: chei config memories.generate_memories, memories.use_memories, memories.disable_on_external_context și comanda /memories; fișierele locale nu sunt suprafață de control recomandată. Nu există metode memory/* în app-server.
- **Suprafață nativă:** Settings > Personalization > Memory
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Memoria canonică rămâne în Hub; importul din ChatGPT se face manual (export/copiere) cu aprobare; Hub-ul nu citește ~/.codex/memories fără aprobare explicită.
- **Suprafață de execuție:** openai.chatgpt_chat
- **Echivalent la celălalt ecosistem:** Anthropic: memoria Claude (anthropic.claude_chat) și skill-ul local import-memory
- **Ce face unic / mai bine:** Memorie îmbunătățită cu surse vizibile și corectare inline
- **Securitate:** Memoria poate conține date sensibile și poate ajunge pe pagini partajate; logurile memoriilor șterse pot fi păstrate până la 30 de zile.
- **Cale de implementare:** Hub memory canonic + flux ASSISTED de import cu proveniență și revizuire
- **Test necesar:** Test de import local din fișier Markdown, fără model
- **Status:** DOCUMENTED
- **Decizie Hub:** REIMPLEMENT
- **Încredere:** high
- **Note:** Flagul local external_agent_memory_import este încă „under development”.
- **Surse citite:** https://help.openai.com/en/articles/8590148-memory-faq · https://learn.chatgpt.com/docs/customization/memories.md · https://learn.chatgpt.com/docs/dots/tasks-and-memory.md · sources-openai-devday.md secțiunea E (flag memories)
- **Verificare adversarială:** CORRECTED (corectat: programmaticIntegration (https://help.openai.com/en/articles/8590148-memory-faq)) — Help 8590148 și learn memories confirmă: controale diferite după plan și regiune, surse vizibile, loguri ale memoriilor șterse păstrate până la 30 de zile și o memorie Codex locală separată în ~/.codex/memories/, cu cheile memories.*. App-server nu are metode memory/*. Am corectat doar enum-ul (memoria se gestionează exclusiv în UI).

### Exportul datelor ChatGPT (istoric și date de cont) (`oa-chatgpt-data-export`)

- **Sursă oficială:** https://help.openai.com/en/articles/7260999-exporting-your-chatgpt-history-and-data
- **Documentație tehnică:** n/a
- **Ce face:** Export ZIP din Settings > Data controls > Export (sau Privacy Portal) cu istoricul chaturilor și alte date; livrare în până la 7 zile, link valabil 24 de ore.
- **Plan necesar:** Free, Go, Plus, Pro și Edu eligibil; nu Business, Enterprise, Healthcare
- **Platformă:** ChatGPT web; Privacy Portal
- **Rollout:** GA
- **Eligibilitate cont:** Probabil disponibil pe un plan individual
- **Autentificare:** Cont ChatGPT + verificarea e-mailului/telefonului
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul
- **Risc de facturare API:** none
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Niciun API; proprietarul descarcă arhiva, iar Hub-ul poate importa selectiv, cu aprobare, conversațiile relevante. Sarcinile programate și linkurile lor nu sunt incluse.
- **Suprafață nativă:** Settings > Data controls > Export
- **Cerințe locale:** Spațiu local; descărcarea necesită permisiune explicită
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Rută de portabilitate (fără lock-in) pentru istoric, importat în memoria Hub-ului doar la cerere.
- **Suprafață de execuție:** openai.chatgpt_chat
- **Echivalent la celălalt ecosistem:** Anthropic: export claude.ai neverificat în această sesiune
- **Ce face unic / mai bine:** Singura rută oficială de extragere în masă pentru conturi personale
- **Securitate:** Arhiva conține date foarte sensibile; nu se procesează automat.
- **Cale de implementare:** Importator local offline pentru fișierul exportat, rulat doar la cererea proprietarului
- **Test necesar:** Test pe un fișier sintetic, fără date reale
- **Status:** DOCUMENTED
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Exportul nu poate restaura chaturile deja șterse.
- **Surse citite:** https://help.openai.com/en/articles/7260999-exporting-your-chatgpt-history-and-data · https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt
- **Verificare adversarială:** CONFIRMED — Help 7260999 confirmă: Settings > Data controls > Export sau Privacy Portal; disponibil pe Free, Go, Plus, Pro și Edu eligibil, nu pe Business, Enterprise sau Healthcare; livrare în până la 7 zile, link valabil 24 de ore. Chaturile șterse nu se recuperează. Sarcinile programate nu sunt incluse (help 10291617).

## mobile

### Remote control de pe telefon și codex remote-control (`oa-codex-remote-control`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/remote-connections
- **Documentație tehnică:** https://learn.chatgpt.com/docs/remote ; https://learn.chatgpt.com/docs/cli/reference (codex remote-control) ; https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server-daemon/README.md
- **Ce face:** Din ChatGPT pe iOS/Android (sau alt desktop) pornești, urmărești, aprobi și revizuiești taskuri Codex care rulează pe computerul-gazdă (desktop app pe macOS/Windows); pairing QR unu-la-unu inițiat din Settings > Connections > Control this Mac or PC; CLI-ul gestionează daemonul cu remote control și coduri de pairing scurte.
- **Plan necesar:** Mobile remote control: Plus, Pro, Business, Enterprise (nu API key); poate cere activare de admin în workspace.
- **Platformă:** Gazdă Windows/macOS; client iOS/Android sau alt desktop
- **Rollout:** Codex Remote a ajuns GA pe 25.06.2026, cu pairing QR unu-la-unu autentificat; disponibilitatea depinde în continuare de rollout și de setările workspace-ului; comanda CLI codex remote-control este Experimental; conexiunile nefolosite din 08.06.2026 trebuie reîmperecheate; gazdele Windows sunt suportate din 29.05.2026.
- **Eligibilitate cont:** Neconfigurat; comanda codex remote-control există local.
- **Autentificare:** Același cont și workspace ChatGPT pe ambele dispozitive, cu MFA/SSO/passkey
- **Allowance:** Taskurile rulează pe gazdă și consumă din plan.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul suplimentar.
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** codex remote-control (foreground), codex remote-control start\|stop, codex remote-control pair --json → pairingCode, manualPairingCode, environmentId, expiresAt; codex app-server daemon enable-remote-control\|disable-remote-control. Configurarea mobilă pornește doar din aplicația desktop, nu din CLI.
- **Suprafață nativă:** ChatGPT mobil (Codex pe iOS, Remote pe Android), desktop Settings > Connections.
- **Cerințe locale:** Gazda trează, online, cu desktop app pornit.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Proprietarul folosește telefonul pentru sesiunile proprii; Hub-ul nu activează remote control.
- **Suprafață de execuție:** openai.codex_remote_control
- **Echivalent la celălalt ecosistem:** anthropic.claude_mobile_remote: claude --remote-control [name] și comutatorul Remote Control din desktop.
- **Ce face unic / mai bine:** Aprobări și instrucțiuni de pe telefon pentru munca locală.
- **Securitate:** Telefonul primește acces la proiectele, fișierele, credențialele, pluginurile și Computer Use ale gazdei; schimbarea contului invalidează sesiunile remote. Firele Hub rulate prin app-server stdio propriu nu sunt expuse remote.
- **Cale de implementare:** Proprietarul face pairing-ul; Hub-ul nu rulează niciodată remote-control start sau pair; poate afișa doar starea daemonului.
- **Test necesar:** Niciunul automat.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Remote control pe Windows disponibil din 29.05.2026 (changelog 26.527).
- **Surse citite:** https://learn.chatgpt.com/docs/remote · https://learn.chatgpt.com/docs/remote-connections · https://learn.chatgpt.com/docs/cli/reference · https://learn.chatgpt.com/docs/changelog · https://learn.chatgpt.com/docs/pricing
- **Verificare adversarială:** CORRECTED (corectat: rollout (https://learn.chatgpt.com/docs/changelog ; https://learn.chatgpt.com/docs/remote-connections ; https://learn.chatgpt.com/docs/cli/reference)) — Setup-ul doar din desktop (Settings > Connections > Control this Mac or PC), subcomenzile CLI și câmpurile pair --json, planurile (fără API key) și accesul telefonului la resursele gazdei sunt confirmate; corectat statutul de lansare (GA).

## browser

### Browser integrat în desktop (previzualizare, comentarii, browser use, Developer mode CDP) (`oa-codex-in-app-browser`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/browser
- **Documentație tehnică:** https://learn.chatgpt.com/docs/browser ; https://learn.chatgpt.com/docs/changelog (26.609 Developer mode)
- **Ce face:** Vedere comună asupra site-urilor și aplicațiilor web locale într-un chat: previzualizare, adnotări vizuale, interacțiune a ChatGPT cu pagina; profil separat de browserul obișnuit; Developer mode oferă acces CDP controlat pentru depanare.
- **Plan necesar:** Previzualizări și comentarii: toate planurile din tabel; Computer Use in the browser: Limited* (regional).
- **Platformă:** ChatGPT desktop (macOS, Windows) și web
- **Rollout:** Disponibil
- **Eligibilitate cont:** Flaguri locale in_app_browser, browser_use, browser_use_full_cdp_access = true; plugin browser instalat.
- **Autentificare:** ChatGPT
- **Allowance:** Consum normal pe plan.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul suplimentar.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Documentat ca indisponibil în Codex CLI și extensia IDE; nicio metodă app-server documentată.
- **Suprafață nativă:** Panoul browser din desktop, Settings > Browser.
- **Cerințe locale:** Desktop app.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Proprietarul verifică vizual UI-ul Hub (127.0.0.1:8011) cu Codex; Hub-ul înregistrează rezultatul.
- **Suprafață de execuție:** openai.codex_desktop
- **Echivalent la celălalt ecosistem:** anthropic.claude_desktop_browser (panoul browser Claude) și anthropic.claude_in_chrome.
- **Ce face unic / mai bine:** Comentarii pe pagina randată transformate direct în taskuri.
- **Securitate:** Conținutul paginilor este context neîncrezător (prompt injection); descărcările ajung în Downloads.
- **Cale de implementare:** Fără integrare; decizia separată despre Playwright local rămâne deschisă.
- **Test necesar:** Niciunul automat.
- **Status:** AVAILABLE
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Site tools (WebMCP) nu sunt disponibile în workspace-uri Enterprise/Edu.
- **Surse citite:** https://learn.chatgpt.com/docs/browser · https://learn.chatgpt.com/docs/pricing · https://learn.chatgpt.com/docs/changelog · local: sources-openai-devday.md secțiunea E
- **Verificare adversarială:** CONFIRMED — Pagina Browser confirmă indisponibilitatea în CLI și IDE, profilul separat, descărcările în Downloads, lipsa automatizării uploadurilor și Developer mode cu acces CDP complet aprobat explicit; pricing confirmă previzualizările pe toate planurile și Computer Use in the browser ca limitat regional.

### Extensia ChatGPT pentru Chrome/Edge/Brave/Opera/Vivaldi (browser control, side chat) (`oa-codex-browser-extension`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/chrome-extension
- **Documentație tehnică:** https://learn.chatgpt.com/docs/chrome-extension ; https://learn.chatgpt.com/docs/changelog (16.06.2026, 25.08.2026)
- **Ce face:** ChatGPT Work și Codex lucrează în browserul real al proprietarului, pe site-uri unde e deja autentificat, în fundal pe tab-uri; side chat în Chrome, Edge, Brave, Vivaldi.
- **Plan necesar:** Use ChatGPT with Chrome: Limited* (regional) pe toate planurile; disponibil în SEE din 16.06.2026.
- **Platformă:** Browsere Chromium pe desktop
- **Rollout:** Disponibil, cu limitări regionale
- **Eligibilitate cont:** Plugin chrome (openai-bundled 26.924.22138) instalat; starea extensiei în browser necunoscută.
- **Autentificare:** Sesiunile browserului proprietarului
- **Allowance:** Consum normal pe plan.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul suplimentar.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Mențiune @Chrome/@Edge în prompt; control din Settings > Computer Use; nicio interfață programatică pentru Hub.
- **Suprafață nativă:** Bara de unelte a browserului, desktop app.
- **Cerințe locale:** Extensia instalată și conectată.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Doar uz direct al proprietarului.
- **Suprafață de execuție:** openai.codex_desktop
- **Echivalent la celălalt ecosistem:** anthropic.claude_in_chrome (claude --chrome).
- **Ce face unic / mai bine:** Lucru pe site-uri autentificate fără a prelua browserul.
- **Securitate:** Acționează cu sesiunile autentificate ale proprietarului (e-mail, conturi); risc ridicat de acțiuni externe; Hub-ul nu o comandă.
- **Cale de implementare:** Nicio integrare.
- **Test necesar:** Niciunul.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Opera suportă control de browser, dar nu side chat.
- **Surse citite:** https://learn.chatgpt.com/docs/chrome-extension · https://learn.chatgpt.com/docs/pricing · https://learn.chatgpt.com/docs/changelog
- **Verificare adversarială:** CONFIRMED — Pagina Browser extension confirmă cele cinci browsere, lipsa side chat în Opera, configurarea din Settings > Computer Use și acțiunile pe sesiunile autentificate ale proprietarului; changelog-ul confirmă extinderea browserelor (25.08.2026) și disponibilitatea în SEE (16.06.2026).

### Cloud browser în ChatGPT Work (succesorul modului agent) (`oa-work-cloud-browser`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/browser.md
- **Documentație tehnică:** n/a
- **Ce face:** Browser pe un computer separat în cloud pentru sarcini pe site-uri cu autentificare; lucrul continuă cu dispozitivul închis; preluare manuală, formular securizat de autentificare, aprobări Always Ask/Auto Approve/Always Allow.
- **Plan necesar:** Navigarea pe site-uri care cer autentificare (web și mobil): Plus și Pro, în funcție de rollout. Autentificarea pe site-uri nu este disponibilă în Enterprise și Edu; pentru Business documentația nu precizează.
- **Platformă:** ChatGPT Work web și mobil
- **Rollout:** Disponibil
- **Eligibilitate cont:** Probabil disponibil pe Pro; neverificat
- **Autentificare:** Cont ChatGPT; credențialele site-urilor nu sunt vizibile modelului
- **Allowance:** Consumă Work
- **Utilizare partajată:** Work + Codex
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Credite doar dacă există sold
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Nicio interfață programatică
- **Suprafață nativă:** Work > @Browser
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Operat de proprietar; Hub-ul doar înregistrează rezultatul.
- **Suprafață de execuție:** openai.chatgpt_work
- **Echivalent la celălalt ecosistem:** Anthropic: Claude in Chrome (anthropic.claude_in_chrome), local nu în cloud
- **Ce face unic / mai bine:** Rulează fără calculatorul utilizatorului
- **Securitate:** Sesiuni autentificate în cloud; unele site-uri blochează browserele automate; CAPTCHA nu se ocolește.
- **Cale de implementare:** Niciuna
- **Test necesar:** n/a
- **Status:** ELIGIBILITY_UNKNOWN
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Browserul integrat din desktop rulează local și poate folosi CDP în modul dezvoltator.
- **Surse citite:** https://learn.chatgpt.com/docs/browser.md · https://help.openai.com/en/articles/11752874-chatgpt-agent
- **Verificare adversarială:** CORRECTED (corectat: planRequired (https://learn.chatgpt.com/docs/browser.md)) — Sunt confirmate: computerul separat în cloud, formularul securizat de autentificare, preluarea manuală, opțiunile Always ask/Auto approve/Always allow și blocarea unor site-uri. Help 11752874 confirmă că browserul cloud înlocuiește modul agent.

### Site tools (WebMCP) în browserul ChatGPT Desktop (`oa-site-tools-webmcp`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/webmcp.md
- **Documentație tehnică:** https://webmachinelearning.github.io/webmcp/
- **Ce face:** O pagină web își înregistrează unelte prin document.modelContext.registerTool() în pagina principală, iar ChatGPT le folosește în browserul integrat din desktop pentru a acționa asupra conținutului live.
- **Plan necesar:** Enterprise cu aprobare admin; Edu nesuportat; alte planuri nespecificate
- **Platformă:** Browserul integrat din ChatGPT desktop; modele GPT-5.6 Sol și GPT-6 Sol (nu Luna)
- **Rollout:** Disponibil cu subset de API WebMCP
- **Eligibilitate cont:** Neverificată
- **Autentificare:** Sesiunea paginii (autentificarea existentă a aplicației web)
- **Allowance:** Consumă Work/Codex
- **Utilizare partajată:** Work + Codex
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul
- **Risc de facturare API:** none
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** UI-ul Hub-ului (127.0.0.1:8011) ar putea înregistra unelte WebMCP read-only; API-ul declarativ (atribute HTML) și uneltele din iframe nu sunt suportate.
- **Suprafață nativă:** Browserul integrat din ChatGPT desktop
- **Cerințe locale:** ChatGPT desktop; pagina Hub deschisă în browserul integrat
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Opțiune viitoare: proprietarul deschide Hub-ul în browserul ChatGPT și cere acțiuni read-only sau propuneri, sub supraveghere.
- **Suprafață de execuție:** openai.chatgpt_desktop_browser
- **Echivalent la celălalt ecosistem:** Anthropic: Claude in Chrome (anthropic.claude_in_chrome); suportul WebMCP neverificat
- **Ce face unic / mai bine:** Refolosește logica și permisiunile existente ale aplicației, fără server MCP separat
- **Securitate:** Orice unealtă înregistrată poate fi apelată de agent; scrierile trebuie să treacă prin aprobările Hub-ului; paginile terțe pot încerca prompt injection.
- **Cale de implementare:** Prototip ulterior cu unelte read-only, activat doar la cerere
- **Test necesar:** Test unitar al înregistrării uneltelor fără model
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Recompensele de securitate WebMCP sunt tratate prin programul Bugcrowd al OpenAI.
- **Surse citite:** https://learn.chatgpt.com/docs/webmcp.md · https://help.openai.com/en/articles/20001256-plugins-in-chatgpt
- **Verificare adversarială:** CONFIRMED — Learn webmcp confirmă: document.modelContext.registerTool doar în pagina principală, modelele GPT-5.6 Sol și GPT-6 Sol (WebMCP oprit pe GPT-5.6 Luna), Site tools permise de admin în Enterprise, indisponibile în Edu, API declarativ nesuportat, bug bounty pe Bugcrowd. Pentru planurile personale nu există restricție declarată.

### Annotations Extensibility / Browser Annotation API (document.oai.annotation în browserul integrat) (`oa-gap-browser-annotation-api`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/annotations-extensibility
- **Documentație tehnică:** https://learn.chatgpt.com/docs/annotations-extensibility.md ; https://learn.chatgpt.com/docs/browser
- **Ce face:** Adnotările din browserul integrat funcționează pe orice site: utilizatorul selectează o zonă, comentează și o trimite ca context către Codex sau ChatGPT Work. API-ul permite site-ului să personalizeze: containere și ținte selectabile (oai-annotation-container, oai-annotatable), selecție de text (oai-annotation-container-text), metadate (oai-annotation-metadata: maximum 6 proprietăți, 2048 bytes), cereri din propriul buton prin document.oai.annotation.request(target, {mode, enterAnnotationMode, metadata, initialComment de maximum 240 de unități}), controale custom, suprafețe canvas, controlul modului Annotation. API-ul există doar în browserul integrat al desktop app (versiunea DevDay 2026+), pe pagini top-level securizate (HTTPS sau localhost). Deschiderea unei adnotări nu trimite mesaj; doar utilizatorul trimite. Nu este disponibil în Enterprise sau Edu.
- **Plan necesar:** Planuri non-Enterprise/Edu (Pro inclus implicit prin excludere); depinde de desktop app.
- **Platformă:** ChatGPT desktop app (browser integrat)
- **Rollout:** Lansat la DevDay 2026; cererile inițiate de site pot necesita permisiune per site.
- **Eligibilitate cont:** Neverificat pentru contul proprietarului.
- **Autentificare:** Sesiunea desktop a proprietarului.
- **Allowance:** Adnotarea în sine nu consumă; tura trimisă consumă limitele Codex/Work.
- **Utilizare partajată:** Alocarea comună Codex/Work.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul direct.
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** UI-ul Hub (127.0.0.1:8011) poate adăuga atribute oai-annotatable și metadate non-sensibile pe componente și un buton care apelează document.oai.annotation.request doar la gest utilizator, cu feature detection; Hub-ul nu poate trimite adnotări.
- **Suprafață nativă:** Modul Annotation din browserul integrat al desktop app
- **Cerințe locale:** ChatGPT desktop app la zi; plugin Annotations Extensibility opțional.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Opțional: feedback vizual al proprietarului pe UI-ul Hub către Codex, cu obiecte numite clar (misiuni, taskuri, aprobări).
- **Suprafață de execuție:** openai.codex_desktop
- **Echivalent la celălalt ecosistem:** an-desktop-built-in-browser (Browser pane din Claude Desktop)
- **Ce face unic / mai bine:** Selecție semantică a componentelor și metadate structurate trimise cu feedback-ul.
- **Securitate:** Metadatele ajung la model: fără secrete, tokenuri sau date personale; 127.0.0.1 versus localhost trebuie testat.
- **Cale de implementare:** Atribute adăugate progresiv în UI-ul V2, după o decizie de design; fără dependență funcțională.
- **Test necesar:** Test manual al proprietarului în browserul integrat; nicio execuție de model de către Hub.
- **Status:** DOCUMENTED
- **Decizie Hub:** REUSE_NATIVE
- **Încredere:** medium
- **Note:** oa-codex-in-app-browser acoperă browserul; acest record acoperă API-ul de extensie pentru site-uri.
- **Surse citite:** https://learn.chatgpt.com/docs/annotations-extensibility.md
- **Verificare adversarială:** CONFIRMED — annotations-extensibility.md confirmă: API-ul nu este disponibil în Enterprise sau Edu; document.oai.annotation există doar în browserul integrat, pe pagini top-level securizate (HTTPS sau localhost), pentru versiunea DevDay 2026 a desktop app sau mai nouă. Confirmate și atributele oai-annotation-container, oai-annotatable, oai-annotation-container-text și oai-annotation-metadata (maximum 6 proprietăți, 2.048 bytes, valori de maximum 256 caractere), request(target, {mode, …}) apelat din gest utilizator și initialComment de maximum 240 de unități UTF-16. Cererile inițiate de site pot cere permisiune. Deschiderea unei adnotări nu trimite mesajul. Rămâne de testat dacă 127.0.0.1 este tratat ca localhost.

## computer

### Computer Use (plugin computer-use / unified-computer-use) (`oa-codex-computer-use`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/computer-use
- **Documentație tehnică:** https://learn.chatgpt.com/docs/computer-use ; https://learn.chatgpt.com/docs/changelog (26.527 Windows, 16.06.2026 SEE)
- **Ce face:** ChatGPT vede și operează interfețe grafice pe macOS și Windows (testare aplicații, fluxuri în mai multe aplicații, setări); pe Windows lucrează în prim-plan pe desktopul activ, preluând mouse-ul și tastatura.
- **Plan necesar:** Limited* (regional) pe toate planurile; disponibil în SEE/UK/CH din 16.06.2026; pe Windows din 29.05.2026.
- **Platformă:** Desktop macOS și Windows
- **Rollout:** Disponibil, cu limitări regionale
- **Eligibilitate cont:** Pluginurile computer-use și unified-computer-use instalate local; flag computer_use=true în binarul desktop.
- **Autentificare:** ChatGPT
- **Allowance:** Consum normal pe plan (sarcinile vizuale pot folosi GPT-6 Astra, mai costisitor).
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Computer use prin Agents API este facturat API și refuzat.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Plugin cu server MCP Computer-use și skill; aprobare per aplicație; lista Always allow în $CODEX_HOME/config.toml [computer_use.windows] always_allowed_app_ids; admin: [features].computer_use=false. Documentația nu descrie utilizarea din CLI sau app-server.
- **Suprafață nativă:** @Computer sau @AppName în prompt; Settings > Computer use.
- **Cerințe locale:** Aplicația țintă vizibilă pe desktopul activ; Windows deblocat.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Doar uz direct al proprietarului; Hub-ul nu controlează desktopul.
- **Suprafață de execuție:** openai.codex_desktop
- **Echivalent la celălalt ecosistem:** anthropic.claude_computer_use (skill computer-use în Claude desktop).
- **Ce face unic / mai bine:** Operare GUI pe Windows cu aprobări per aplicație.
- **Securitate:** Poate modifica starea sistemului în afara proiectului; nu poate automatiza terminale, ChatGPT însuși sau prompturi de securitate/admin; un singur controller pentru desktop.
- **Cale de implementare:** Nicio comandă din Hub; doar înregistrarea rezultatelor raportate de proprietar.
- **Test necesar:** Niciunul automat.
- **Status:** ASSISTED_ONLY
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Pentru rulare în fundal pe Windows, documentația sugerează o mașină virtuală.
- **Surse citite:** https://learn.chatgpt.com/docs/computer-use · https://learn.chatgpt.com/docs/pricing · https://learn.chatgpt.com/docs/changelog · local: sources-openai-devday.md secțiunea E
- **Verificare adversarială:** CONFIRMED — Pagina Computer Use confirmă pluginul cu server MCP și skill, operarea în prim-plan pe Windows, lista always_allowed_app_ids din [computer_use.windows], dezactivarea admin prin [features].computer_use = false, sugestia de VM și imposibilitatea de a automatiza terminale, ChatGPT sau prompturi de securitate.

### Appshots pe Windows (`oa-codex-appshots`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/whats-new
- **Documentație tehnică:** https://learn.chatgpt.com/docs/pricing (Appshots)
- **Ce face:** Apăsarea simultană a ambelor taste Alt trimite captura ferestrei din prim-plan și textul disponibil într-un chat ChatGPT.
- **Plan necesar:** Plus, Pro, Business, API key; nu Enterprise (tabel pricing).
- **Platformă:** Desktop Windows (și macOS)
- **Rollout:** Depinde de rollout (anunțat 7–11.09.2026)
- **Eligibilitate cont:** Neverificată
- **Autentificare:** ChatGPT
- **Allowance:** Consum normal pe plan.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Doar scurtătură de tastatură.
- **Suprafață nativă:** Desktop
- **Cerințe locale:** Desktop app actualizat.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul.
- **Suprafață de execuție:** openai.codex_desktop
- **Echivalent la celălalt ecosistem:** Nicio echivalență verificată.
- **Ce face unic / mai bine:** Context rapid din altă aplicație.
- **Securitate:** Captura poate conține date sensibile trimise la OpenAI.
- **Cale de implementare:** Nicio integrare.
- **Test necesar:** Niciunul.
- **Status:** ELIGIBILITY_UNKNOWN
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** medium
- **Note:** n/a
- **Surse citite:** https://learn.chatgpt.com/docs/whats-new · https://learn.chatgpt.com/docs/pricing
- **Verificare adversarială:** CONFIRMED — Pagina Appshots, changelog-ul 26.908 (11.09.2026) și digestul 7–11 septembrie confirmă apăsarea ambelor taste Alt pe Windows și conținutul capturat; pricing confirmă Plus, Pro, Business și API key, fără Enterprise.

### Funcții doar macOS: Computer History, Record & Replay, locked use, snapshot-uri de fir partajate (`oa-codex-macos-only-features`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/changelog
- **Documentație tehnică:** https://learn.chatgpt.com/docs/computer-use ; https://learn.chatgpt.com/docs/customization/memories
- **Ce face:** Computer History transformă activitatea din aplicații și site-uri în memorii (Pro, Business, Enterprise); Record & Replay transformă un flux demonstrat într-un skill; locked use permite Computer Use după blocarea Mac-ului; snapshot-uri read-only ale firelor partajabile.
- **Plan necesar:** Variabil (Computer History: Pro, Business, Enterprise)
- **Platformă:** Doar macOS
- **Rollout:** Disponibil pe macOS
- **Eligibilitate cont:** Neaplicabil pe Windows 11
- **Autentificare:** ChatGPT
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** n/a
- **Risc de facturare API:** none
- **Integrare programatică:** NONE
- **Detaliu integrare:** n/a
- **Suprafață nativă:** Desktop macOS
- **Cerințe locale:** macOS
- **Relevanță pentru Hub:** NONE
- **Rol propus:** Niciunul.
- **Suprafață de execuție:** openai.codex_desktop
- **Echivalent la celălalt ecosistem:** n/a
- **Ce face unic / mai bine:** n/a
- **Securitate:** Computer History colectează activitate personală.
- **Cale de implementare:** n/a
- **Test necesar:** Niciunul.
- **Status:** NOT_APPLICABLE
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** high
- **Note:** Mașina proprietarului este Windows 11.
- **Surse citite:** https://learn.chatgpt.com/docs/changelog · https://learn.chatgpt.com/docs/computer-use · https://learn.chatgpt.com/docs/pricing
- **Verificare adversarială:** CONFIRMED — Paginile Computer History și Record & Replay, secțiunea Locked use din Computer Use și changelog-ul (snapshot-uri partajate din 20.08.2026) confirmă că funcțiile sunt doar pentru macOS; Computer History cere Pro, Business sau Enterprise și Memories.

### Computer use în Agents API (browser găzduit) și în Codex/Work pentru Pro 500 (`oa-agents-api-computer-use`)

- **Sursă oficială:** https://developers.openai.com/api/docs/guides/agents-api/tools/computer-use
- **Documentație tehnică:** https://developers.openai.com/api/docs/guides/tools-computer-use.md
- **Ce face:** Unealtă computer_use într-un mediu openai_hosted cu desktop activat și acces la rețea; agentul vede capturi și acționează; utilizatorul aprobă fiecare origine nouă; autentificare prin e-mail/parolă/cod, fără passkeys.
- **Plan necesar:** API; recap: și în Codex și ChatGPT Work pentru abonații Pro 500 $ și clienții Enterprise eligibili
- **Platformă:** Mediu găzduit OpenAI, model gpt-6-astra
- **Rollout:** Anunțat 29.09.2026
- **Eligibilitate cont:** Nepresupusă (nici cont API, nici Pro 500 confirmat)
- **Autentificare:** Cheie API
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Tarif neclar în pagina de prețuri; pe Pro 500 ar cere upgrade de plan (interzis automat).
- **Risc de facturare API:** high
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** În Agents API: unealta {type: computer_use}, environment.type=openai_hosted, desktop.enabled=true, network.access. Subagenții nu se pot autentifica.
- **Suprafață nativă:** n/a
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul
- **Suprafață de execuție:** openai.agents_api
- **Echivalent la celălalt ecosistem:** Anthropic: computer use (anthropic.claude_computer_use), neverificat pe abonament
- **Ce face unic / mai bine:** Browser găzduit cu aprobare pe origine și credențiale ținute în afara modelului
- **Securitate:** Capturile conțin date sensibile; autentificări delegate
- **Cale de implementare:** Niciuna
- **Test necesar:** n/a
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** medium
- **Note:** Distinct de pluginul local Computer Use din ChatGPT Desktop (vezi oa-work-computer-use-desktop).
- **Surse citite:** https://developers.openai.com/api/docs/guides/agents-api/tools/computer-use · https://developers.openai.com/api/docs/pricing.md · https://openai.com/index/devday-2026-recap/ (captură locală)
- **Verificare adversarială:** CONFIRMED — Ghidul confirmă: unealta {type: computer_use}, mediul openai_hosted cu desktop.enabled și network.access, aprobare pentru fiecare origine nouă, autentificare prin e-mail/parolă/cod (fără passkeys), iar subagenții nu se pot autentifica. Pagina de prețuri nu listează computer use separat.

### Computer Use în ChatGPT Desktop (Work și Codex) (`oa-work-computer-use-desktop`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/computer-use.md
- **Documentație tehnică:** https://learn.chatgpt.com/docs/enterprise/managed-configuration.md
- **Ce face:** ChatGPT vede și controlează interfețele grafice ale calculatorului local prin pluginul Computer Use, cu aprobare per aplicație; pe Windows rulează doar în prim-plan și preia intrarea.
- **Plan necesar:** Work sau Codex, în regiunile suportate
- **Platformă:** ChatGPT desktop macOS și Windows
- **Rollout:** Disponibil în regiunile suportate
- **Eligibilitate cont:** Local: flagul computer_use este activ și pluginurile computer-use și unified-computer-use (26.924.22138) sunt instalate și activate; disponibilitatea regională pentru cont nu este verificată.
- **Autentificare:** Cont ChatGPT; permisiuni OS
- **Allowance:** Consumă Work/Codex
- **Utilizare partajată:** Work + Codex
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Credite doar dacă există sold
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** În Work doar interactiv. Tehnic, un turn Codex app-server ar putea folosi pluginul, dar nu este aprobat. Dezactivare administrativă prin requirements.toml [features].computer_use=false; pe Windows allowlist în $CODEX_HOME/config.toml.
- **Suprafață nativă:** Plugins > Computer Use; Settings > Computer Use
- **Cerințe locale:** Windows 11 cu sesiunea activă; nu poate automatiza terminale, ChatGPT însuși sau prompturi de administrator
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Doar sub supravegherea proprietarului; Hub-ul nu pornește computer use neasistat.
- **Suprafață de execuție:** openai.chatgpt_work
- **Echivalent la celălalt ecosistem:** Anthropic: computer use (anthropic.claude_computer_use) și Claude in Chrome (anthropic.claude_in_chrome)
- **Ce face unic / mai bine:** Controlul oricărei aplicații desktop, nu doar browser
- **Securitate:** Pe Windows preia tastatura/mouse-ul în timpul sarcinii; risc la fluxuri cu credențiale sau plăți; un singur controller.
- **Cale de implementare:** Păstrează blocat în Hub; revizuire după decizia despre automatizarea locală
- **Test necesar:** n/a
- **Status:** AVAILABLE
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Pentru aplicații web documentația recomandă mai întâi browserul integrat.
- **Surse citite:** https://learn.chatgpt.com/docs/computer-use.md · https://learn.chatgpt.com/docs/browser.md · sources-openai-devday.md secțiunea E (codex features list, codex plugin list)
- **Verificare adversarială:** CONFIRMED — Learn computer-use confirmă: disponibil în regiunile suportate pe macOS și Windows; pe Windows rulează doar în prim-plan; nu poate automatiza terminale, ChatGPT însuși sau prompturi de administrator. Adminii îl pot opri cu [features].computer_use=false, iar allowlist-ul Windows stă în $CODEX_HOME/config.toml. Pentru aplicațiile web locale se recomandă întâi browserul integrat. AVAILABLE se sprijină pe flag-ul și pluginurile locale; regiunea contului rămâne neverificată.

## documents

### Pluginuri pentru documente, foi de calcul, prezentări, PDF și vizualizatorul de fișiere (`oa-codex-document-plugins`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/artifacts-viewer
- **Documentație tehnică:** https://learn.chatgpt.com/docs/artifacts-viewer ; https://learn.chatgpt.com/docs/plugins
- **Ce face:** Creează, previzualizează și rafinează cu adnotări fișiere docx, pptx, xlsx și PDF alături de chat; pluginuri instalate local: documents, spreadsheets, presentations, pdf, template-creator (marketplace openai-primary-runtime) și visualize.
- **Plan necesar:** Toate planurile (pluginuri incluse)
- **Platformă:** Desktop; web pentru revizuire
- **Rollout:** Disponibil
- **Eligibilitate cont:** Instalate și activate local (26.921.10847).
- **Autentificare:** ChatGPT
- **Allowance:** Consum normal pe plan.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul suplimentar.
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** CLI-ul poate crea și edita fișiere, dar nu le previzualizează. Nu este verificat dacă skill-urile acestor pluginuri sunt vizibile în firele app-server ale Hub-ului (de verificat cu skills/list și plugin/list).
- **Suprafață nativă:** Vizualizatorul de fișiere din desktop.
- **Cerințe locale:** Desktop app.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Rapoartele și prezentările companiei se produc nativ; Hub-ul furnizează conținutul și înregistrează fișierul rezultat.
- **Suprafață de execuție:** openai.codex_desktop
- **Echivalent la celălalt ecosistem:** Skills Claude docx, xlsx, pptx, pdf (ListSkills local).
- **Ce face unic / mai bine:** Previzualizare și adnotare integrate.
- **Securitate:** Fișierele pot conține date ale clienților.
- **Cale de implementare:** REUSE_NATIVE în desktop; test fără inferență pentru vizibilitatea skill-urilor în app-server.
- **Test necesar:** skills/list și plugin/list pe CODEX_HOME implicit.
- **Status:** AVAILABLE
- **Decizie Hub:** REUSE_NATIVE
- **Încredere:** medium
- **Note:** Marketplace-ul openai-primary-runtime poate fi specific runtime-ului desktop.
- **Surse citite:** https://learn.chatgpt.com/docs/artifacts-viewer · https://learn.chatgpt.com/docs/plugins · https://learn.chatgpt.com/docs/cli · local: sources-openai-devday.md secțiunea E
- **Verificare adversarială:** CONFIRMED — Pagina Work with files confirmă previzualizarea și adnotarea documentelor, prezentărilor, foilor de calcul și PDF-urilor în desktop și lipsa previzualizării în CLI; inventarul local provine din dovezile colectate.

### Dynamic Pages (pagini cu grafice, dashboard-uri, @dot/@ChatGPT, actualizare automată) (`oa-dynamic-pages`)

- **Sursă oficială:** https://help.openai.com/en/articles/20001549-getting-started-with-space-in-chatgpt
- **Documentație tehnică:** https://learn.chatgpt.com/docs/space/pages.md
- **Ce face:** Tip nou de document pentru planuri, rapoarte și concepte vizuale: grafice, trackere, vizualizări interactive (/visualize), blocuri de prompt, comentarii și etichetarea unui dot sau a ChatGPT pentru pașii următori; recap-ul promite actualizare automată din instrumente conectate.
- **Plan necesar:** Pro, Business, Enterprise
- **Platformă:** ChatGPT web și desktop
- **Rollout:** Paginile cu grafice sunt disponibile în Space; „Keep updated” (actualizare automată) nu este disponibil la lansare
- **Eligibilitate cont:** Neverificată
- **Autentificare:** Cont ChatGPT
- **Allowance:** Limitele Chat/Work
- **Utilizare partajată:** Chat/Work
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul identificat
- **Risc de facturare API:** none
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Niciun API; o cadență scrisă în pagină nu creează un task programat — trebuie verificat separat în Scheduled.
- **Suprafață nativă:** Pagini în Space
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Import manual al rapoartelor Hub-ului; dashboard-urile canonice rămân în UI-ul Hub-ului.
- **Suprafață de execuție:** openai.space_pages
- **Echivalent la celălalt ecosistem:** Anthropic: Artifacts cu capabilități runtime (anthropic.claude_artifacts)
- **Ce face unic / mai bine:** Document viu editat simultan de oameni și agenți
- **Securitate:** Date copiate din surse conectate devin vizibile tuturor celor cu acces la pagină.
- **Cale de implementare:** Export Markdown/CSV din Hub; fără sincronizare automată revendicată
- **Test necesar:** n/a
- **Status:** ROLLOUT_PENDING
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Nu există o pagină oficială dedicată „Dynamic Pages”; descrierea combină recap-ul cu documentația Space.
- **Surse citite:** https://help.openai.com/en/articles/20001549-getting-started-with-space-in-chatgpt · https://learn.chatgpt.com/docs/space/pages.md · https://learn.chatgpt.com/docs/space/agents.md · https://openai.com/index/devday-2026-recap/ (captură locală)
- **Verificare adversarială:** CORRECTED (corectat: programmaticIntegration (https://learn.chatgpt.com/docs/space/pages.md)) — Nu există o pagină dedicată „Dynamic Pages”. Learn space/pages și space/agents confirmă graficele, /visualize, blocurile Prompt/Task/Agent Instructions și @ChatGPT/@dot. ROLLOUT_PENDING rămâne acceptabil doar pentru actualizarea automată „Keep updated”.

### Collaborative Slides (editor de prezentări în ChatGPT, export PowerPoint/Google Slides) (`oa-collaborative-slides`)

- **Sursă oficială:** https://openai.com/index/devday-2026-recap/ (captură locală)
- **Documentație tehnică:** https://help.openai.com/en/articles/20001549-getting-started-with-space-in-chatgpt
- **Ce face:** Conform recap-ului: editor de prezentări cu grafice native editabile, creare din conversație sau din șablon propriu, editare/comentarii multi-utilizator, prezentare din ChatGPT și export PowerPoint sau Google Slides.
- **Plan necesar:** Pro, Business, Enterprise (recap)
- **Platformă:** ChatGPT web și desktop
- **Rollout:** Help Space: Slides și Sheets „coming soon” — contrazice recap-ul care le prezintă ca disponibile
- **Eligibilitate cont:** Neverificată; probabil încă indisponibil
- **Autentificare:** Cont ChatGPT
- **Allowance:** Limitele Chat/Work
- **Utilizare partajată:** Chat/Work
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul identificat
- **Risc de facturare API:** none
- **Integrare programatică:** NONE
- **Detaliu integrare:** Niciun API pentru Slides. Alternativa programatică existentă este pluginul Codex „presentations” (instalat local) printr-un turn Codex app-server care produce .pptx — cale acoperită de felia Codex.
- **Suprafață nativă:** Space (când va fi lansat); Work cu Google Slides conectat
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Pentru livrabile, Hub-ul folosește pluginul Codex presentations; Slides colaborative rămâne operat de proprietar.
- **Suprafață de execuție:** openai.space_pages
- **Echivalent la celălalt ecosistem:** Anthropic: skill pptx (listat local în claude.ai)
- **Ce face unic / mai bine:** Editare multi-utilizator cu grafice native și export în formatele uzuale
- **Securitate:** Datele din prezentări intră în cloud și în setările de antrenare ale colaboratorilor
- **Cale de implementare:** Reevaluare după lansarea efectivă
- **Test necesar:** n/a
- **Status:** ROLLOUT_PENDING
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Work pe desktop nu include încă PowerPoint la lansare (help 20001278); Google Slides este suportat prin aplicația Google Workspace conectată.
- **Surse citite:** https://openai.com/index/devday-2026-recap/ (captură locală) · https://help.openai.com/en/articles/20001549-getting-started-with-space-in-chatgpt · https://help.openai.com/en/articles/20001278-creating-and-editing-documents-spreadsheets-and-presentations-with-chatgpt-work
- **Verificare adversarială:** CONFIRMED — Help Space spune că Slides și Sheets vin „în curând”. Prezentarea generală learn/space enumeră totuși prezentările ca parte din Space: e o contradicție de documentație, așa că ROLLOUT_PENDING rămâne prudent. Help 20001278 confirmă că PowerPoint lipsește din fluxul Work desktop la lansare, iar Google Slides merge prin aplicația conectată.

### Visualizations (@Visualize în Chat și Work, /visualize în paginile Space) (`oa-gap-chatgpt-visualizations`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/visualizations
- **Documentație tehnică:** https://learn.chatgpt.com/docs/visualizations.md ; https://learn.chatgpt.com/docs/space/pages
- **Ce face:** Transformă întrebări și date în grafice, hărți, diagrame, calculatoare, simulări și explicații interactive în chat. Se invocă prin @Visualize (plugin) sau automat, când ChatGPT consideră util; în Space, /visualize inserează o vizualizare într-o pagină. Disponibilitate: web pentru conturile suportate în Chat și Work; desktop în preview cu rollout; mobil în rollout; Codex CLI și extensia IDE nu redau vizualizări. Rezultatul este un snapshot, nu un dashboard sincronizat; exportul variază; poate fi transformat într-un Site.
- **Plan necesar:** Depinde de plan, platformă, cont și workspace (preview).
- **Platformă:** ChatGPT web, desktop, mobil
- **Rollout:** Preview în rollout
- **Eligibilitate cont:** Pluginul visualize 1.0.41 este instalat în Codex local; afișarea sugestiei Visualize în composer confirmă activarea contului (neverificat).
- **Autentificare:** Sesiunea ChatGPT
- **Allowance:** Limitele planului pentru Chat sau Work.
- **Utilizare partajată:** Chat sau alocarea Work.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul documentat.
- **Risc de facturare API:** none
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Niciun API; nu se redă în CLI sau app-server. Hub-ul poate exporta date agregate (CSV/JSON) pe care proprietarul le folosește cu @Visualize.
- **Suprafață nativă:** Composer ChatGPT (@Visualize), editorul de pagini Space
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Asistat: explicații vizuale ad-hoc pentru proprietar; dashboard-urile canonice rămân în UI-ul Hub.
- **Suprafață de execuție:** openai.chatgpt_chat
- **Echivalent la celălalt ecosistem:** an-inline-visualizations
- **Ce face unic / mai bine:** Controale interactive generate din prompt; integrare în paginile Space.
- **Securitate:** Datele trimise pentru vizualizare intră în chat; partajarea chatului expune datele sursă.
- **Cale de implementare:** Export de date fără secrete din Hub; nicio integrare de cod.
- **Test necesar:** Niciunul pentru Hub.
- **Status:** ROLLOUT_PENDING
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** De verificat dacă pluginul visualize instalat în Codex adaugă instrucțiuni sau skills în firele app-server ale Hub-ului (vezi oa-gap-codex-skills-isolation).
- **Surse citite:** https://learn.chatgpt.com/docs/visualizations.md · local: codex plugin list (visualize 1.0.41, openai-bundled, din evidența colectată)
- **Verificare adversarială:** CONFIRMED — visualizations.md confirmă: preview în rollout, cu disponibilitate dependentă de plan, platformă, cont și workspace; web disponibil conturilor suportate în Chat și Work; desktop în preview; mobil în rollout. Codex CLI și extensia IDE nu redau vizualizări. Se folosesc @Visualize și /visualize în paginile Space, rezultatul este un snapshot, nu un dashboard sincronizat, iar exportul variază. Nu există API; NATIVE_INTERACTIVE, ASSISTED și ROLLOUT_PENDING sunt coerente.

### ChatGPT pentru Excel, Word și PowerPoint (add-in Microsoft) și ChatGPT pentru Google Sheets (`oa-gap-chatgpt-office-addins`)

- **Sursă oficială:** https://help.openai.com/en/articles/20001526-chatgpt-for-word
- **Documentație tehnică:** https://help.openai.com/en/articles/20001063-chatgpt-for-excel-and-google-sheets ; https://help.openai.com/en/articles/20001242-chatgpt-for-powerpoint ; https://help.openai.com/en/articles/20001278
- **Ce face:** Un singur add-in Microsoft deschide ChatGPT într-un sidebar în Word, Excel și PowerPoint; există și ChatGPT pentru Google Sheets. Word: redactare, editare, formatare; conversațiile sunt separate de istoricul ChatGPT, memoria și skill-urile nu se transferă, pluginurile nu sunt suportate. Excel/Sheets: construire și explicare de modele, cu skills (implicit pentru modelare financiară) și apps. PowerPoint: creare și editare de slide-uri editabile, cu pluginuri, skills și apps unde este suportat. Codex din desktop app poate lucra cu registrul Excel deschis prin add-in (@Microsoft Excel). Consumul folosește tarife pe token la nivelul API-ului modelului, din alocarea comună cu Codex și alte funcții premium, apoi credite; exemplu PowerPoint: 10–50 credite per mesaj cu GPT-5.5.
- **Plan necesar:** Word: toate planurile ChatGPT, inclusiv Free. Excel, Google Sheets și PowerPoint: Free, Go, Plus, Pro, Business, Enterprise, Edu și K-12. Free și Go au acces limitat. Plus și Pro (la PowerPoint și Business) au acces supus limitei agentice a planului.
- **Platformă:** Microsoft Excel, Word, PowerPoint (desktop și web); Google Sheets
- **Rollout:** GA (Word lansat recent; Business/Enterprise: Word activat implicit de la 1 octombrie 2026)
- **Eligibilitate cont:** Neinstalat sau neverificat pentru proprietar.
- **Autentificare:** Login ChatGPT în add-in
- **Allowance:** Alocarea agentică comună cu Codex și Work.
- **Utilizare partajată:** Help 11369540: Codex, ChatGPT Work, ChatGPT for Excel și Workspace Agents folosesc un pool comun de alocare și credite. Word consumă din alocarea comună cu Codex și alte funcții premium. Pentru PowerPoint și Excel, limitele agentice se partajează odată ce prețurile acestor funcții devin efective; pagina pricing spune că în prezent intră Excel pe Plus și Pro. Creditele acoperă Codex, Work, Word, Excel și PowerPoint (help 9793128).
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Credite după epuizarea alocării incluse.
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Niciun API pentru Hub. Hub-ul contabilizează consumul comun prin account/rateLimits/read; documentele companiei se produc prin pipeline-ul Hub sau prin pluginurile de documente Codex.
- **Suprafață nativă:** Ribbon și sidebar în Office; meniul Extensions în Google Sheets
- **Cerințe locale:** Microsoft 365 cu acces la add-in-uri (sau instalare prin manifest de către admin).
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Asistat: proprietarul editează documente pentru clienți în Office; Hub-ul ține cont că acest consum reduce alocarea disponibilă firelor Codex.
- **Suprafață de execuție:** openai.office_addins
- **Echivalent la celălalt ecosistem:** Echivalentul Anthropic pentru Office nu are record în inventar (de verificat).
- **Ce face unic / mai bine:** Editare nativă care păstrează structura slide-urilor, formulele și formatarea Office.
- **Securitate:** Conform termenilor Marketplace, Microsoft poate citi conținutul registrului și prompturile; unele loguri sunt păstrate 30 de zile de OpenAI; nu se folosesc date confidențiale ale clienților fără acord.
- **Cale de implementare:** Doar înregistrare în inventar și în modelul de consum al Hub-ului.
- **Test necesar:** Niciunul pentru Hub.
- **Status:** DOCUMENTED
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** oa-codex-document-plugins acoperă pluginurile de documente din Codex; acest record acoperă add-in-urile Office. Criticul citase help 20001278 ca pagina add-in-urilor; aceasta descrie de fapt fluxul Work pentru fișiere.
- **Surse citite:** https://help.openai.com/en/articles/20001526-chatgpt-for-word · https://help.openai.com/en/articles/20001063-chatgpt-for-excel-and-google-sheets · https://help.openai.com/en/articles/20001242-chatgpt-for-powerpoint · https://help.openai.com/en/articles/20001278-creating-and-editing-documents-spreadsheets-and-presentations-with-chatgpt-work · https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers · https://chatgpt.com/pricing
- **Verificare adversarială:** CORRECTED (corectat: planRequired (https://help.openai.com/en/articles/20001526-chatgpt-for-word ; https://help.openai.com/en/articles/20001063-chatgpt-for-excel-and-google-sheets ; https://help.openai.com/en/articles/20001242-chatgpt-for-powerpoint), sharedUsage (https://help.openai.com/en/articles/11369540 ; https://help.openai.com/en/articles/20001526 ; https://help.openai.com/en/articles/20001242 ; https://learn.chatgpt.com/docs/pricing.md ; https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers)) — Confirmat prin browserul integrat: un singur add-in Microsoft pentru Word, Excel și PowerPoint; Word fără pluginuri, fără memorie și fără transfer de skills; Excel și Sheets cu skills implicite de modelare financiară și apps; Codex din desktop lucrează cu registrul Excel deschis prin @Microsoft Excel. Mai sunt confirmate: exemplul PowerPoint de 10–50 credite per mesaj cu GPT-5.5, prețul pe token la tarif API pentru Word, termenii Marketplace (Microsoft poate citi conținutul), logurile păstrate 30 de zile și activarea implicită a Word de la 1 octombrie 2026. Status DOCUMENTED, ASSISTED și apiBillingRisk low rămân valabile. Formularea „Pro extins” nu a putut fi verificată pe coloanele din pagina de prețuri.

## scheduling

### Scheduled tasks (automatizări locale în desktop și pe web) (`oa-codex-scheduled-tasks`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/automations
- **Documentație tehnică:** https://learn.chatgpt.com/docs/automations
- **Ce face:** Taskuri recurente (RRULE, intervale de minute, zilnic, săptămânal), independente sau în interiorul unui chat; în desktop lucrează pe proiecte locale în directorul proiectului sau pe worktree dedicat, cu setările implicite de sandbox; rezultatele apar în Scheduled.
- **Plan necesar:** Toate planurile din tabel (Project and standalone scheduled tasks).
- **Platformă:** Desktop și web
- **Rollout:** Disponibil
- **Eligibilitate cont:** Flag local in_app_local_automation=true.
- **Autentificare:** ChatGPT
- **Allowance:** Fiecare rulare consumă din plan.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Rulări nesupravegheate pot consuma alocarea și creditele existente.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Documentat: CLI-ul și IDE-ul nu oferă interfața Scheduled; nicio metodă app-server documentată; crearea se face din chat sau din UI.
- **Suprafață nativă:** Scheduled în bara laterală a desktopului.
- **Cerințe locale:** Computer pornit și aplicația deschisă pentru taskurile de proiect.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Rutine native ale proprietarului; planificatorul Hub rămâne canonic pentru misiuni.
- **Suprafață de execuție:** openai.codex_desktop
- **Echivalent la celălalt ecosistem:** anthropic.claude_scheduled_desktop (MCP scheduled-tasks cu list/create/update — mai programatic).
- **Ce face unic / mai bine:** Rulare pe worktree dedicat și inbox de rezultate.
- **Securitate:** Rulează nesupravegheat; modul local poate modifica fișiere aflate în lucru.
- **Cale de implementare:** Hub-ul pregătește promptul sau skill-ul și înregistrează manual rezultatul; nu creează taskuri native.
- **Test necesar:** Niciunul.
- **Status:** AVAILABLE
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** GPT-5.5 se retrage pe 14.10.2026; taskurile programate care îl folosesc trebuie actualizate.
- **Surse citite:** https://learn.chatgpt.com/docs/automations · https://learn.chatgpt.com/docs/pricing · local: sources-openai-devday.md secțiunea E
- **Verificare adversarială:** CONFIRMED — Pagina Scheduled tasks confirmă rularea în directorul proiectului sau pe worktree dedicat, setările implicite de sandbox, RRULE și intervalele pe minute în chat, lipsa interfeței Scheduled în CLI/IDE; pricing confirmă disponibilitatea pe toate planurile din tabel.

### Taskuri declanșate de evenimente Gmail/Slack/GitHub (`oa-codex-event-triggered-tasks`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/automations
- **Documentație tehnică:** https://learn.chatgpt.com/docs/automations (Trigger tasks from app events)
- **Ce face:** Rulează un task salvat la un e-mail nou, un mesaj Slack sau activitate pe PR GitHub; disponibil doar în ChatGPT web și mobil.
- **Plan necesar:** Planuri eligibile (nespecificate în detaliu)
- **Platformă:** Web și mobil (nu desktop, CLI, IDE)
- **Rollout:** Disponibil din 25.08.2026
- **Eligibilitate cont:** Neverificată
- **Autentificare:** ChatGPT + conectori
- **Allowance:** Fiecare rulare consumă din plan.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** Evenimente frecvente pot genera multe rulări.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Creare doar prin chat; nicio interfață programatică.
- **Suprafață nativă:** ChatGPT web/mobil, Scheduled.
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul.
- **Suprafață de execuție:** openai.chatgpt_work
- **Echivalent la celălalt ecosistem:** anthropic.claude_routines_cloud (referință).
- **Ce face unic / mai bine:** Declanșare pe evenimente fără polling.
- **Securitate:** Necesită conectarea conturilor externe.
- **Cale de implementare:** Nicio integrare.
- **Test necesar:** Niciunul.
- **Status:** ELIGIBILITY_UNKNOWN
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** medium
- **Note:** Nu poate combina triggeri de eveniment cu program orar.
- **Surse citite:** https://learn.chatgpt.com/docs/automations · https://learn.chatgpt.com/docs/whats-new
- **Verificare adversarială:** CONFIRMED — Pagina Scheduled tasks și changelog-ul din 25.08.2026 confirmă triggerii Gmail, Slack și GitHub doar pe web și mobil, pe planuri eligibile, fără combinare cu program orar.

### Scheduled tasks în ChatGPT (unice, recurente, monitorizare) (`oa-scheduled-tasks`)

- **Sursă oficială:** https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt
- **Documentație tehnică:** https://learn.chatgpt.com/docs/automations.md
- **Ce face:** Sarcini unice, recurente (RRULE) sau de monitorizare, cu notificări push/e-mail, link-uri de partajare, pe web (cloud) sau desktop (local, cu calculatorul pornit); Codex are automatizări separate.
- **Plan necesar:** Free, Go, Plus, Pro, Business, Enterprise, Edu; sarcini active: 3 Free/Go, 5 Plus, 10 Business/Edu, 15 Pro/Enterprise; orar și ore exacte doar pe planuri plătite
- **Platformă:** ChatGPT web, mobil, desktop (pagina Scheduled după versiune)
- **Rollout:** GA
- **Eligibilitate cont:** Probabil disponibil; neverificat
- **Autentificare:** Cont ChatGPT
- **Allowance:** Rulările consumă limitele modelului/planului
- **Utilizare partajată:** Chat/Work
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Sarcinile în Work pot consuma credite dacă există sold
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Niciun API; creare prin chat, UI Scheduled sau de către skills în ChatGPT; Codex CLI nu oferă interfața Scheduled. Sarcinile sunt în Compliance API (Enterprise), dar nu în exportul de date.
- **Suprafață nativă:** Scheduled; Settings > Notifications
- **Cerințe locale:** Pentru sarcini locale: calculator pornit și aplicația deschisă
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Proprietarul creează sarcini native când vrea; Hub-ul le înregistrează ca referință; planificatorul Hub-ului rămâne separat și canonic pentru misiuni.
- **Suprafață de execuție:** openai.chatgpt_scheduled
- **Echivalent la celălalt ecosistem:** Anthropic: scheduled tasks în Claude desktop (anthropic.claude_scheduled_desktop; MCP local disponibil, 0 sarcini) și rutine cloud (anthropic.claude_routines_cloud)
- **Ce face unic / mai bine:** Monitorizare cu condiție de oprire; partajare de sarcini ca șablon
- **Securitate:** Instrucțiunile din linkurile partajate sunt publice pentru cine are linkul; acțiunile cu aprobare pun sarcina pe pauză.
- **Cale de implementare:** Registru ASSISTED în Hub (titlu, program, scop), fără creare automată
- **Test necesar:** n/a
- **Status:** DOCUMENTED
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** GPT-5.5 se retrage pe 14.10.2026 — sarcinile vechi trebuie migrate (learn automations).
- **Surse citite:** https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt · https://learn.chatgpt.com/docs/automations.md · https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex
- **Verificare adversarială:** CORRECTED (corectat: programmaticIntegration (https://learn.chatgpt.com/docs/automations.md)) — Help 10291617 și learn automations confirmă: limite de 3/5/10/15 sarcini active, RRULE în desktop, lipsa interfeței Scheduled în Codex CLI, excluderea din exportul de date, includerea în Compliance API și retragerea GPT-5.5 pe 14.10.2026. Enum-ul este acum consecvent cu oa-event-triggered-tasks: sarcinile se creează doar interactiv.

### Sarcini Work declanșate de evenimente (Gmail, Slack, GitHub PR) (`oa-event-triggered-tasks`)

- **Sursă oficială:** https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt
- **Documentație tehnică:** https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex
- **Ce face:** Sarcini bazate pe webhook care rulează în Work la mesaje Gmail noi, mesaje în canale Slack sau activitate pe pull request-uri GitHub autorizate, cu Trigger/Condition/Prompt revizuibile.
- **Plan necesar:** Plus, Pro, Business, Enterprise, Edu, Healthcare; nu Free/Go/FedRAMP
- **Platformă:** Creare pe web și mobil; desktop doar afișare
- **Rollout:** Disponibil
- **Eligibilitate cont:** Probabil eligibil pe Pro; neverificat
- **Autentificare:** Cont ChatGPT + aplicația conectată
- **Allowance:** Maximum 30 rulări/oră și 720/zi pentru toate sarcinile de acest tip
- **Utilizare partajată:** Work + Codex
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Credite doar dacă există sold
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Niciun API; pluginurile cu MCP Events pot adăuga alte tipuri de evenimente.
- **Suprafață nativă:** Work + Scheduled
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Opțional: proprietarul configurează notificări GitHub PR în ChatGPT; Hub-ul nu depinde de ele.
- **Suprafață de execuție:** openai.chatgpt_scheduled
- **Echivalent la celălalt ecosistem:** Anthropic: rutine cloud (anthropic.claude_routines_cloud), declanșatori neverificați
- **Ce face unic / mai bine:** Reacție la evenimente reale din aplicații uzuale
- **Securitate:** Conținutul e-mailurilor/mesajelor devine intrare pentru agent (prompt injection); acțiunile de trimitere cer aprobare.
- **Cale de implementare:** Niciuna în Hub
- **Test necesar:** n/a
- **Status:** ELIGIBILITY_UNKNOWN
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Pentru Slack, @ChatGPT trebuie adăugat în fiecare canal monitorizat.
- **Surse citite:** https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt · https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex · https://learn.chatgpt.com/docs/automations.md
- **Verificare adversarială:** CONFIRMED — Help 10291617/20001275 și learn automations confirmă: disponibil pe Plus, Pro, Business, Enterprise, Edu și Healthcare, nu pe Free/Go sau FedRAMP; declanșatori Gmail, Slack și GitHub PR; maximum 30 de rulări/oră și 720/zi; creare doar pe web și mobil. O sarcină nu poate combina declanșatori pe evenimente cu un program orar.

## collaboration

### Delegare cloud: @codex în GitHub issues/PR, Slack, Linear (`oa-codex-cloud-integrations`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/pricing
- **Documentație tehnică:** https://learn.chatgpt.com/docs/third-party/github
- **Ce face:** Pornește taskuri cloud din comentarii @codex pe GitHub și din integrările Slack și Linear.
- **Plan necesar:** GitHub @codex și Linear: planuri plătite (Plus, Pro, Business, Enterprise; nu API key). Slack: documentația curentă descrie @ChatGPT în Slack cu Cloud delegation configurată de un owner sau admin de workspace ChatGPT și un mediu publicat partajat cu workspace-ul (recapul DevDay: Business, Enterprise), în conflict cu tabelul pricing, care listează integrarea Slack și la Plus și Pro.
- **Platformă:** GitHub, Slack, Linear
- **Rollout:** Disponibil
- **Eligibilitate cont:** Neconfigurat
- **Autentificare:** ChatGPT + conectori
- **Allowance:** Consum pe plan.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul suplimentar.
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Comentariu @codex în issue/PR; conectare din setările Codex.
- **Suprafață nativă:** GitHub, Slack, Linear
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Doar uz direct al proprietarului.
- **Suprafață de execuție:** openai.codex_cloud
- **Echivalent la celălalt ecosistem:** Nicio echivalență verificată.
- **Ce face unic / mai bine:** Delegare din instrumentele echipei.
- **Securitate:** Postarea de comentarii sau mesaje externe cere aprobarea proprietarului.
- **Cale de implementare:** Nicio integrare.
- **Test necesar:** Niciunul.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Hub-ul nu trimite mesaje externe. Comentariile @codex altele decât review și sarcinile din Linear pornesc chaturi cloud legacy, bazate pe medii Codex Cloud (Legacy), a căror depreciere este planificată.
- **Surse citite:** https://learn.chatgpt.com/docs/pricing · https://learn.chatgpt.com/docs/third-party/github
- **Verificare adversarială:** CORRECTED (corectat: planRequired (https://learn.chatgpt.com/docs/pricing ; https://learn.chatgpt.com/docs/third-party/slack ; https://learn.chatgpt.com/docs/third-party/linear), notes (https://learn.chatgpt.com/docs/third-party/github ; https://learn.chatgpt.com/docs/environments/cloud-environments)) — Delegarea din GitHub și Linear este confirmată; corectate cerințele pentru Slack (deployment de workspace) și adăugată dependența de mediile Legacy.

### ChatGPT Space (spații, pagini, fișiere; înlocuiește Library) (`oa-space`)

- **Sursă oficială:** https://help.openai.com/en/articles/20001549-getting-started-with-space-in-chatgpt
- **Documentație tehnică:** https://learn.chatgpt.com/docs/space.md
- **Ce face:** Spațiu personal și spații pe teme/echipe cu pagini editabile, subpagini, foldere și fișiere; ChatGPT creează și editează pagini din conversații; comentarii, @ChatGPT și @dot, partajare view/comment/edit cu moștenire; fiecare colaborator lucrează cu propriul ChatGPT.
- **Plan necesar:** Pro, Business, Enterprise
- **Platformă:** Editare pe web și desktop; mobil doar citire și partajare
- **Rollout:** Rollout gradual după DevDay; indisponibil încă pentru rezidența datelor în Canada/Emiratele Arabe Unite
- **Eligibilitate cont:** Eligibil dacă planul este Pro; nevăzut în cont
- **Autentificare:** Cont ChatGPT
- **Allowance:** Asistența ChatGPT consumă limitele Chat/Work
- **Utilizare partajată:** Chat/Work
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul identificat
- **Risc de facturare API:** none
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Niciun API sau MCP documentat pentru pagini; Compliance API (Enterprise) acoperă fișierele Library.
- **Suprafață nativă:** Space în ChatGPT web și desktop
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Hub-ul exportă briefuri, decizii și rapoarte în Markdown pentru import manual într-o pagină; Hub-ul rămâne sursa canonică.
- **Suprafață de execuție:** openai.space_pages
- **Echivalent la celălalt ecosistem:** Anthropic: Claude Projects (anthropic.claude_projects) și conectorul local Claude Docs
- **Ce face unic / mai bine:** Colaborare în timp real cu agenți și colegi pe aceeași pagină; pagini cu grafice și instrumente interactive.
- **Securitate:** Informații din Memory pot ajunge pe pagini partajate; setările de antrenare ale colaboratorilor se aplică și conținutului tău.
- **Cale de implementare:** Export Markdown (testat local) → import manual de către proprietar
- **Test necesar:** Test de export Markdown local
- **Status:** ELIGIBILITY_UNKNOWN
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Proiectele rămân separate de Space. „Keep updated” nu este disponibil la lansare.
- **Surse citite:** https://help.openai.com/en/articles/20001549-getting-started-with-space-in-chatgpt · https://learn.chatgpt.com/docs/space.md · https://learn.chatgpt.com/docs/space/getting-started.md · https://learn.chatgpt.com/docs/space/pages.md · https://learn.chatgpt.com/docs/space/agents.md · https://learn.chatgpt.com/docs/space/collaboration.md · https://learn.chatgpt.com/docs/enterprise/chatgpt-space.md
- **Verificare adversarială:** CORRECTED (corectat: programmaticIntegration (https://help.openai.com/en/articles/20001549-getting-started-with-space-in-chatgpt)) — Help 20001549 și learn space confirmă: Pro/Business/Enterprise, editare pe web și desktop, mobil doar pentru citire și partajare, @ChatGPT/@dot, moștenirea accesului și nicio interfață programatică. „Keep updated”, Slides și Sheets lipsesc la lansare; rezidența Canada/EAU vine în curând. Am corectat doar enum-ul, pentru că funcția se folosește exclusiv interactiv în UI.

### Teams în ChatGPT și team tasks (sarcini recurente sau declanșate de evenimente) (`oa-teams-team-tasks`)

- **Sursă oficială:** https://help.openai.com/en/articles/20001541-teams-in-chatgpt
- **Documentație tehnică:** https://learn.chatgpt.com/docs/enterprise/teams.md
- **Ce face:** Echipe de colegi dintr-un workspace care partajează pagini, spații, pluginuri și sarcini; team tasks rulează în cloud cu contul de serviciu al echipei și conexiunile de workspace, pe program sau la evenimente (de ex. mesaj nou în Slack).
- **Plan necesar:** Business și Enterprise
- **Platformă:** ChatGPT web/desktop, cloud
- **Rollout:** Rollout gradual după DevDay
- **Eligibilitate cont:** Neeligibil pe un plan individual
- **Autentificare:** Workspace ChatGPT; cont de serviciu al echipei
- **Allowance:** Team tasks folosesc credite de workspace, cu limite de cheltuieli separate de ale utilizatorilor
- **Utilizare partajată:** Credite de workspace
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** Credite de workspace consumate de sarcini; ar cere și upgrade de plan (interzis automat).
- **Risc de facturare API:** low
- **Integrare programatică:** NONE
- **Detaliu integrare:** Activitatea poate fi revizuită prin Compliance API și Admin API (Enterprise); nu există API pentru crearea sarcinilor.
- **Suprafață nativă:** Teams în ChatGPT; Scheduled
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul pentru un proprietar unic
- **Suprafață de execuție:** openai.chatgpt_teams
- **Echivalent la celălalt ecosistem:** Anthropic: rutine cloud (anthropic.claude_routines_cloud) — paritatea nu a fost verificată
- **Ce face unic / mai bine:** Sarcini de echipă care supraviețuiesc plecării creatorului
- **Securitate:** Conexiuni partajate de workspace; linkurile de alăturare nu cer aprobarea proprietarului echipei.
- **Cale de implementare:** Niciuna
- **Test necesar:** n/a
- **Status:** PLAN_RESTRICTED
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** high
- **Note:** Echipele sunt separate de grupurile de workspace și de canalele Slack/Teams.
- **Surse citite:** https://help.openai.com/en/articles/20001541-teams-in-chatgpt · https://learn.chatgpt.com/docs/enterprise/teams.md · https://openai.com/index/devday-2026-recap/ (captură locală)
- **Verificare adversarială:** CONFIRMED — Help 20001541 și learn enterprise/teams confirmă: Business și Enterprise, cont de serviciu al echipei, rulare în cloud, linkuri de alăturare fără aprobarea proprietarului. Team Tasks folosesc credite de workspace, cu limite de cheltuieli separate de cele ale utilizatorilor.

### @ChatGPT în Slack și Microsoft Teams (`oa-chatgpt-slack-teams`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/enterprise/chatgpt-slack-and-teams.md
- **Documentație tehnică:** https://learn.chatgpt.com/docs/third-party/slack.md
- **Ce face:** Mențiunea @ChatGPT în canale, fire și DM-uri pentru rezumate, ciorne sau acțiuni cu uneltele conectate de admin; opțional task-uri Codex Cloud din Slack.
- **Plan necesar:** Business și Enterprise; instalare de către adminii ChatGPT și Slack/Teams
- **Platformă:** Slack, Microsoft Teams
- **Rollout:** Disponibil pentru workspace-uri
- **Eligibilitate cont:** Neeligibil pe un plan individual
- **Autentificare:** Suprafețe configurate în admin.openai.com cu permisiunile unui cont de serviciu
- **Allowance:** Nedocumentat în sursele citite
- **Utilizare partajată:** Workspace
- **Inclus în abonament?:** unknown
- **Risc de facturare suplimentară (credite/extra usage):** Ar cere plan de workspace
- **Risc de facturare API:** unknown
- **Integrare programatică:** NONE
- **Detaliu integrare:** Niciun API; configurare doar prin consola de admin.
- **Suprafață nativă:** Slack/Teams
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul; Hub-ul nu trimite mesaje externe fără cerere explicită.
- **Suprafață de execuție:** openai.chatgpt_slack_teams
- **Echivalent la celălalt ecosistem:** Anthropic: neverificat în această sesiune
- **Ce face unic / mai bine:** Asistent în instrumentele de chat ale echipei
- **Securitate:** Răspunsurile sunt vizibile participanților; nu moștenește accesul personal; Slack Connect nesuportat.
- **Cale de implementare:** Niciuna
- **Test necesar:** n/a
- **Status:** PLAN_RESTRICTED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Separat de canalele Slack/Teams ale unui dot.
- **Surse citite:** https://learn.chatgpt.com/docs/enterprise/chatgpt-slack-and-teams.md · https://learn.chatgpt.com/docs/third-party/slack.md · https://openai.com/index/devday-2026-recap/ (captură locală)
- **Verificare adversarială:** CONFIRMED — Learn enterprise/chatgpt-slack-and-teams și third-party/slack confirmă: configurare de către adminul workspace-ului în admin.openai.com, cont de serviciu, fără moștenirea accesului personal, delegare opțională către Codex Cloud. Recap-ul limitează funcția la Business și Enterprise.

### Meetings plugin / ChatGPT Record (înregistrare, transcriere și rezumat de ședințe) (`oa-meetings-record`)

- **Sursă oficială:** https://help.openai.com/en/articles/11487532-chatgpt-record
- **Documentație tehnică:** n/a
- **Ce face:** Înregistrează audio de ședință, transcrie cu separarea vorbitorilor, generează note, decizii și pași următori salvate în ChatGPT (Space); poate intra automat în ședințe Google Meet din calendar; opțiunea Reference record history reutilizează notele.
- **Plan necesar:** Meetings plugin: beta pe Mac pentru Pro și Business; Windows și Enterprise „în curând”. Record: aplicația macOS pentru Plus, Pro, Business, Enterprise, Edu.
- **Platformă:** ChatGPT desktop macOS
- **Rollout:** Beta; Windows în curând
- **Eligibilitate cont:** Indisponibil pe mașina proprietarului (Windows 11) până la lansarea pentru Windows
- **Autentificare:** Cont ChatGPT; permisiuni microfon/audio sistem
- **Allowance:** Inclus fără cost suplimentar la lansare; sesiuni de maximum 4 ore
- **Utilizare partajată:** Nedocumentat
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Inclus fără cost suplimentar la lansare; limitele și prețurile se pot schimba (menționat explicit).
- **Risc de facturare API:** none
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Niciun API; notele se pot exporta manual din conversație/canvas.
- **Suprafață nativă:** Butonul Record / Meetings în aplicația macOS
- **Cerințe locale:** macOS; Windows neacceptat încă
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Ulterior: proprietarul importă manual notele de ședință, iar Hub-ul înregistrează deciziile și sarcinile cu proveniență.
- **Suprafață de execuție:** openai.chatgpt_meetings
- **Echivalent la celălalt ecosistem:** Anthropic: neverificat
- **Ce face unic / mai bine:** Transcriere cu mai mulți vorbitori și auto-join Google Meet
- **Securitate:** Consimțământul participanților este responsabilitatea utilizatorului; pe planuri personale transcrierile pot fi folosite la antrenare dacă „Improve the model for everyone” este activ.
- **Cale de implementare:** Reevaluare la lansarea pentru Windows
- **Test necesar:** n/a
- **Status:** ROLLOUT_PENDING
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Audio-ul este șters după transcriere; transcrierile și canvas-urile urmează retenția conversațiilor.
- **Surse citite:** https://help.openai.com/en/articles/11487532-chatgpt-record · https://openai.com/index/devday-2026-recap/ (captură locală)
- **Verificare adversarială:** CORRECTED (corectat: extraBillingRisk (https://help.openai.com/en/articles/11487532-chatgpt-record), programmaticIntegration (https://help.openai.com/en/articles/11487532-chatgpt-record)) — Help 11487532 confirmă: pluginul Meetings în beta pe Mac pentru Pro și Business, cu Windows și Enterprise „în curând”; Record pe macOS pentru Plus/Pro/Business/Enterprise/Edu; 4 ore pe sesiune; audio șters după transcriere; auto-join doar pentru Google Meet. Am corectat gramatica („pot se schimbe”) și enum-ul.

### Shareable profiles (profil ChatGPT cu activitate și vitrină de Sites) (`oa-shareable-profiles`)

- **Sursă oficială:** https://help.openai.com/en/articles/20001539-shareable-profiles-in-chatgpt
- **Documentație tehnică:** n/a
- **Ce face:** Profil la chatgpt.com/profile cu nume, poză, bio, activitate (mesaje Chat, tokeni Work/Codex, streak-uri), top pluginuri și până la 12 Sites; personal privat implicit, public doar pentru utilizatori autentificați.
- **Plan necesar:** Toate planurile non-Enterprise; Enterprise în curând
- **Platformă:** Web și desktop (vitrina nu pe mobil)
- **Rollout:** Rollout gradual; disponibil în toate țările
- **Eligibilitate cont:** Probabil disponibil; neverificat
- **Autentificare:** Cont ChatGPT
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul
- **Risc de facturare API:** none
- **Integrare programatică:** NONE
- **Detaliu integrare:** Niciun API
- **Suprafață nativă:** chatgpt.com/profile
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul
- **Suprafață de execuție:** openai.chatgpt_profiles
- **Echivalent la celălalt ecosistem:** Anthropic: neverificat
- **Ce face unic / mai bine:** Vitrină publică pentru Sites
- **Securitate:** Un profil public expune volumul de utilizare Work/Codex; skills nu pot fi partajate pe profilul personal.
- **Cale de implementare:** Niciuna
- **Test necesar:** n/a
- **Status:** DOCUMENTED
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** high
- **Note:** Recomandare: profilul personal rămâne privat.
- **Surse citite:** https://help.openai.com/en/articles/20001539-shareable-profiles-in-chatgpt · https://openai.com/index/devday-2026-recap/ (captură locală)
- **Verificare adversarială:** CONFIRMED — Help 20001539 confirmă: toate țările, Enterprise „în curând”, profil personal privat implicit și vizibil doar pentru utilizatori autentificați, activitate Chat/Work/Codex, până la 12 Sites, fără partajarea skill-urilor pe profilul personal.

## review

### Code review local: codex review, /review, review/start (`oa-codex-review-local`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/cli/reference
- **Documentație tehnică:** https://learn.chatgpt.com/docs/app-server (review/start) ; https://learn.chatgpt.com/docs/code-review
- **Ce face:** Revizuire fără modificarea arborelui de lucru: modificări necomise, diff față de o ramură, un commit sau instrucțiuni custom; constatări prioritizate.
- **Plan necesar:** Toate planurile (tabel: Local code review with /review)
- **Platformă:** CLI, desktop, app-server
- **Rollout:** Stable
- **Eligibilitate cont:** Comanda codex review există local.
- **Autentificare:** ChatGPT
- **Allowance:** Review-urile locale se contorizează în limitele generale.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul suplimentar.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** codex review --uncommitted \| --base BR \| --commit SHA [--title] \| PROMPT; app-server review/start {target, delivery inline\|detached} → itemi enteredReviewMode/exitedReviewMode, reviewThreadId la detached.
- **Suprafață nativă:** /review în TUI; panoul de review din desktop.
- **Cerințe locale:** Repo Git.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Etapa Reviewer a misiunilor Hub pe ruta OpenAI.
- **Suprafață de execuție:** openai.codex_review
- **Echivalent la celălalt ecosistem:** Claude Code: review prin claude -p; claude ultrareview (cloud, facturat separat — refuzat).
- **Ce face unic / mai bine:** Mod dedicat de review cu livrare într-un fir separat.
- **Securitate:** Read-only; rulează sub sandbox readOnly.
- **Cale de implementare:** Reviewer-ul Hub apelează review/start pe un fir readOnly; constatările intră în Hub ca findings.
- **Test necesar:** Un review live pe diff mic, doar sub grant.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** --uncommitted, --base, --commit și PROMPT sunt mutual exclusive.
- **Surse citite:** https://learn.chatgpt.com/docs/cli/reference · https://learn.chatgpt.com/docs/app-server · https://learn.chatgpt.com/docs/code-review · https://learn.chatgpt.com/docs/pricing
- **Verificare adversarială:** CONFIRMED — Referința CLI confirmă codex review cu --uncommitted, --base, --commit (--title) sau PROMPT, mutual exclusive; app-server.md confirmă review/start cu țintele și delivery inline\|detached; pricing confirmă că review-urile locale intră în limitele generale.

### Experiența Code Review în desktop (plugin Code Review) (`oa-codex-review-desktop`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/code-review
- **Documentație tehnică:** https://learn.chatgpt.com/docs/code-review
- **Ce face:** Afișează descrierea, fișierele modificate, comentariile și check-urile unui PR (Summary, Changes cu diff și comentarii inline), inbox personal (Assigned to me/team, Authored by me) și întrebări către Codex despre probleme; GitHub GA, GitLab MR în preview.
- **Plan necesar:** Toate planurile (recap DevDay); pluginul Code Review funcționează în desktop și pe web, cu un cont GitHub (GA) sau GitLab (preview) conectat.
- **Platformă:** Desktop și web (pluginul Code Review); inbox-ul personal, Review with Codex și fixarea în bara laterală sunt descrise doar pentru desktop
- **Rollout:** GitHub GA; GitLab în preview
- **Eligibilitate cont:** Neconfigurat (cont GitHub neconectat în ChatGPT).
- **Autentificare:** ChatGPT + cont GitHub/GitLab
- **Allowance:** Întrebările către Codex consumă din plan.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul suplimentar.
- **Risc de facturare API:** low
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Nicio interfață programatică; pluginul se poate fixa în bara laterală.
- **Suprafață nativă:** Code Review în bara laterală a desktopului.
- **Cerințe locale:** Desktop app, cont GitHub conectat.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Revizuirea umană a PR-urilor de către proprietar.
- **Suprafață de execuție:** openai.codex_desktop
- **Echivalent la celălalt ecosistem:** Nicio echivalență desktop Claude verificată.
- **Ce face unic / mai bine:** Inbox de PR-uri cu context Codex.
- **Securitate:** Conectarea contului GitHub la ChatGPT; comentariile postate din Summary sau Changes ajung imediat la furnizorul sursă, fără Submit review.
- **Cale de implementare:** Nicio integrare; Hub-ul poate lega PR-ul de misiune.
- **Test necesar:** Niciunul.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** n/a
- **Surse citite:** https://learn.chatgpt.com/docs/code-review · local: sources-openai-devday.md
- **Verificare adversarială:** CORRECTED (corectat: platform (https://learn.chatgpt.com/docs/code-review), planRequired (https://learn.chatgpt.com/docs/code-review), securityConcerns (https://learn.chatgpt.com/docs/code-review)) — Summary/Changes, inbox-ul, întrebările către Codex și statutul GitHub GA/GitLab preview sunt confirmate; corectat faptul că pluginul nu este exclusiv desktop.

### Review-uri automate în cloud pentru PR-uri GitHub (@codex review) (`oa-codex-review-github-auto`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/third-party/github
- **Documentație tehnică:** https://learn.chatgpt.com/docs/third-party/github ; https://learn.chatgpt.com/docs/pricing (Code Review usage)
- **Ce face:** Codex postează un review GitHub standard concentrat pe probleme P0/P1, la cerere (@codex review) sau automat per repository (Review trigger), urmând secțiunea Code Review Rules din AGENTS.md.
- **Plan necesar:** Plus, Pro, Business, Enterprise (nu API key)
- **Platformă:** GitHub
- **Rollout:** Disponibil
- **Eligibilitate cont:** Neconfigurat
- **Autentificare:** ChatGPT + chatgpt-codex-connector pe GitHub
- **Allowance:** Contorizat ca Code Review usage când rulează prin GitHub.
- **Utilizare partajată:** Categorie distinctă în pricing; relația exactă cu limitele generale nu este detaliată.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Review automat pe fiecare PR crește consumul.
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Activare în setările Codex code review; comentariu @codex review; rezultatele apar în GitHub și în Code Review.
- **Suprafață nativă:** GitHub, setările Codex
- **Cerințe locale:** Repo GitHub conectat la Codex (ChatGPT Codex connector cu permisiunile necesare), drept push sau admin pentru setări și Automatic review activat; review-ul automat în cloud nu cere un mediu cloud, dar @codex fix și alte comenzi @codex pornesc chaturi cloud legacy.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Prima trecere automată pe PR-uri, cu reguli întreținute de Hub în AGENTS.md.
- **Suprafață de execuție:** openai.codex_cloud
- **Echivalent la celălalt ecosistem:** claude ultrareview (cloud, facturat) — nu este echivalent inclus.
- **Ce face unic / mai bine:** Review automat inclus în abonament.
- **Securitate:** Codul PR-ului este analizat în cloudul OpenAI; conectorul primește acces la repo.
- **Cale de implementare:** Hub-ul întreține regulile de review prin fluxul normal de commit aprobat; activarea pe repo o face proprietarul.
- **Test necesar:** Niciunul automat.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** REUSE_NATIVE
- **Încredere:** high
- **Note:** Hub-ul nu postează comentarii @codex în numele proprietarului.
- **Surse citite:** https://learn.chatgpt.com/docs/third-party/github · https://learn.chatgpt.com/docs/pricing · https://learn.chatgpt.com/docs/code-review
- **Verificare adversarială:** CORRECTED (corectat: localRequirements (https://learn.chatgpt.com/docs/third-party/github ; https://learn.chatgpt.com/docs/code-review)) — Confirmate: @codex review, doar probleme P0/P1 pe GitHub, Automatic review cu Review trigger, secțiunea Code Review Rules din AGENTS.md și contorizarea separată ca Code Review usage; completate cerințele locale.

### Review și taskuri pentru GitLab (merge requests) (`oa-codex-review-gitlab`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/third-party/gitlab
- **Documentație tehnică:** https://learn.chatgpt.com/docs/third-party/gitlab
- **Ce face:** Conectare proiect GitLab, mediu cloud, taskuri din issues/MR cu @codex și review-uri unice sau automate; self-managed/Dedicated cer admin și webhook-uri GitLab 19.0+.
- **Plan necesar:** Beta pe toate planurile ChatGPT
- **Platformă:** GitLab
- **Rollout:** Beta
- **Eligibilitate cont:** Nefolosit (proiectul este pe GitHub)
- **Autentificare:** ChatGPT + GitLab
- **Allowance:** Consum pe plan.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul suplimentar.
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Webhook de proiect/grup către Codex; @codex review.
- **Suprafață nativă:** GitLab
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul.
- **Suprafață de execuție:** openai.codex_cloud
- **Echivalent la celălalt ecosistem:** Nicio echivalență verificată.
- **Ce face unic / mai bine:** n/a
- **Securitate:** Webhook-uri și cont de serviciu.
- **Cale de implementare:** Nicio integrare.
- **Test necesar:** Niciunul.
- **Status:** DOCUMENTED
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** high
- **Note:** n/a
- **Surse citite:** https://learn.chatgpt.com/docs/third-party/gitlab · https://learn.chatgpt.com/docs/whats-new
- **Verificare adversarială:** CONFIRMED — Pagina GitLab confirmă beta pe toate planurile ChatGPT, rularea în Codex cloud, contul de serviciu pentru instanțe self-managed/Dedicated și cerința de mediu de proiect pentru review-uri pe GitLab.com.

## plugins

### Pluginuri Codex (instalare, utilizare, inventar) (`oa-codex-plugins-runtime`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/plugins
- **Documentație tehnică:** https://learn.chatgpt.com/docs/cli/reference (codex plugin) ; https://learn.chatgpt.com/docs/app-server (plugin/*, app/*)
- **Ce face:** Pachete reutilizabile care combină skills, aplicații/conectori, servere MCP, hooks și extensii de browser; disponibile în desktop, web, mobil, Codex desktop și CLI (nu în extensia IDE).
- **Plan necesar:** Plugins pe toate planurile (API key: limitat); plugin sharing și connectors pe Plus, Pro, Business, Enterprise.
- **Platformă:** Desktop, web, mobil, CLI
- **Rollout:** Stable în CLI; metodele app-server plugin/* în dezvoltare
- **Eligibilitate cont:** Instalate local: documents, pdf, spreadsheets, presentations, template-creator, codex-app-tools, browser, unified-computer-use, chrome, computer-use, visualize.
- **Autentificare:** ChatGPT + autorizare per plugin/conector
- **Allowance:** Inventarul nu consumă; folosirea pluginurilor consumă ca orice turn.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul la inventar.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** codex plugin list --json (installed, available); codex plugin add\|remove --json; /plugins în TUI; app-server plugin/list, plugin/read (în dezvoltare), plugin/install\|uninstall (a nu se apela din clienți de producție), plugin/skill/read, app/list, app/installed, app/read.
- **Suprafață nativă:** Plugins în desktop/web; /plugins în TUI.
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Inventar și detectare de derivă a capabilităților native instalate.
- **Suprafață de execuție:** openai.plugins
- **Echivalent la celălalt ecosistem:** anthropic.claude_plugins: claude plugin list/install/marketplace.
- **Ce face unic / mai bine:** Catalog mare curatat (gmail, google-drive, github, slack, notion etc.).
- **Securitate:** Conectorii dau acces la conturi externe; instalarea/activarea modifică configurația — doar cu aprobare.
- **Cale de implementare:** Observator: codex plugin list --json periodic; orice instalare doar cu aprobare explicită.
- **Test necesar:** codex plugin list --json (fără inferență).
- **Status:** AVAILABLE
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** high
- **Note:** plugin_sharing și remote_plugin sunt active local.
- **Surse citite:** https://learn.chatgpt.com/docs/plugins · https://learn.chatgpt.com/docs/cli/reference · https://learn.chatgpt.com/docs/app-server · https://learn.chatgpt.com/docs/pricing · local: sources-openai-devday.md secțiunea E
- **Verificare adversarială:** CONFIRMED — Pagina Plugins confirmă componentele (skills, servere MCP, extensii de browser, hooks), suprafețele (fără extensia IDE) și /plugins în CLI; referința CLI confirmă codex plugin list --json cu installed și available; app-server.md marchează plugin/* ca în dezvoltare; pricing confirmă sharing și connectors fără API key.

### Marketplace-uri de pluginuri și formatul portabil Agent Plugins (`oa-codex-plugin-marketplaces`)

- **Sursă oficială:** https://developers.openai.com/plugins/build/plugins
- **Documentație tehnică:** https://developers.openai.com/plugins/build/plugins ; https://learn.chatgpt.com/docs/cli/reference (codex plugin marketplace)
- **Ce face:** Surse de pluginuri din GitHub, Git sau foldere locale; format portabil cu plugin.json la rădăcină (schema Agent Plugins), skills/, mcp.json cu tip de transport și hooks; layoutul .codex-plugin/plugin.json + .mcp.json + .app.json rămâne suportat.
- **Plan necesar:** Toate planurile
- **Platformă:** CLI, desktop
- **Rollout:** Stable
- **Eligibilitate cont:** Marketplace-urile locale: openai-primary-runtime și openai-bundled.
- **Autentificare:** n/a
- **Allowance:** Nu consumă.
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** codex plugin marketplace add owner/repo[@ref] \| URL git [--sparse path] \| ./folder; list\|upgrade\|remove --json; fișiere: $REPO_ROOT/.agents/plugins/marketplace.json, ~/.agents/plugins/marketplace.json și, compatibil, $REPO_ROOT/.claude-plugin/marketplace.json; app-server marketplace/add\|remove\|upgrade.
- **Suprafață nativă:** /plugins, Plugins în desktop
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Distribuția skills-urilor Hub către ambele ecosisteme dintr-un singur repo.
- **Suprafață de execuție:** openai.plugins
- **Echivalent la celălalt ecosistem:** Claude Code plugin marketplaces (.claude-plugin/marketplace.json, claude plugin marketplace).
- **Ce face unic / mai bine:** Aplicația desktop citește și un marketplace legacy-compatibil $REPO_ROOT/.claude-plugin/marketplace.json, iar OpenAI acceptă manifeste compatibile Claude; un singur catalog în repo poate servi ambele ecosisteme, cu verificare separată pentru Codex CLI.
- **Securitate:** Marketplace-urile Git aduc cod extern; upgrade automat de conținut.
- **Cale de implementare:** Hub-ul publică skills proprii ca plugin portabil într-un marketplace repo-scoped; adăugarea sursei în Codex/Claude doar cu aprobare.
- **Test necesar:** codex plugin marketplace list --json (fără inferență).
- **Status:** AVAILABLE
- **Decizie Hub:** REUSE_NATIVE
- **Încredere:** medium
- **Note:** Scaffold-ul @plugin-creator folosește layoutul de compatibilitate, nu cel portabil; skill-ul plugin-creator a fost scos din bundle în 0.159.0.
- **Surse citite:** https://developers.openai.com/plugins/build/plugins · https://learn.chatgpt.com/docs/build-plugins · https://learn.chatgpt.com/docs/cli/reference · https://learn.chatgpt.com/docs/app-server
- **Verificare adversarială:** CORRECTED (corectat: status (local: sources-openai-devday.md secțiunea E (marketplace-urile openai-primary-runtime și openai-bundled) ; https://learn.chatgpt.com/docs/cli/reference (codex plugin marketplace, Stable)), uniqueStrengths (https://developers.openai.com/plugins/build/plugins)) — Formatul portabil (plugin.json cu schema Agent Plugins, skills/, mcp.json cu tip de transport), layoutul de compatibilitate .codex-plugin și locațiile marketplace-urilor sunt confirmate; eliminarea skill-ului plugin-creator din bundle este confirmată în changelog 0.159.0.

### Plugin extensions: sidebar apps, conversation panels, file viewers/editors, plugin settings, forms, composer mentions (`oa-plugin-extensions`)

- **Sursă oficială:** https://developers.openai.com/plugins/build/extensions
- **Documentație tehnică:** https://github.com/openai/mcp-extensions (docs/spec.md; SDK @openai/mcp-extensions și openai-mcp-extensions, Apache-2.0)
- **Ce face:** Extinde un plugin MCP cu suprafețe native în ChatGPT: aplicație în bara laterală deschisă pe tot ecranul, panou lângă conversație, setări structurate, vizualizator/editor de fișiere cu actualizări live și salvare, moduri de afișare, deep links, context bidirecțional model–aplicație și @mentions în composer.
- **Plan necesar:** Recap DevDay: toate abonamentele. Documentația: pe web extensiile vin „în curând” pentru Free și Go; @mentions în composer doar în ChatGPT desktop.
- **Platformă:** ChatGPT desktop (macOS, Windows): toate extensiile. Web (ChatGPT Work în browser; ChatGPT Classic exclus) și mobil iOS/Android: entrypoint-uri globale și de conversație, setări structurate, moduri de afișare, context model–aplicație. Vizualizatorul/editorul de fișiere, deschiderea fișierelor locale și @mentions în composer: doar desktop. Pe web, extensiile vin „în curând” pentru Free și Go.
- **Rollout:** Anunțat 29.09.2026; desktop disponibil, web pentru Free/Go în curând
- **Eligibilitate cont:** Neverificată pe contul ChatGPT al proprietarului (planul nu este confirmat în V2); nicio extensie testată.
- **Autentificare:** Cont ChatGPT pentru utilizator; serverul MCP al pluginului folosește OAuth 2.1 (CIMD, DCR sau client predefinit) sau noauth
- **Allowance:** Fără cotă separată documentată; conversațiile consumă limitele Chat/Work
- **Utilizare partajată:** Aceleași limite ca Chat și Work (Work partajează utilizarea cu Codex)
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nicio taxă documentată. Un server MCP public ar însemna găzduire nouă (serviciu nou plătit, interzis fără aprobare).
- **Risc de facturare API:** none
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Direcție inversă: Hub-ul ar fi serverul MCP care declară entrypoint-uri (global, thread, file-extension), setări structurate, @mentions, moduri de afișare, deep links și ui/update-model-context, cu resurse UI text/html;profile=mcp-app. ChatGPT le randează. Pe această cale, Hub-ul nu poate porni și nu poate conduce conversații ChatGPT. Spec-ul prevede iconița unui „Local MCP Server” ca rezervă pentru entrypoint-uri, deci serverele locale din desktop par anticipate. Suportul lor nu este însă declarat explicit și trebuie testat. Formularele extinse cer MRTR pentru serverele înregistrate la OpenAI.
- **Suprafață nativă:** ChatGPT desktop: pictogramă în bara laterală, panou lângă chat, deschiderea fișierelor, @ în composer
- **Cerințe locale:** Server MCP accesibil din ChatGPT (plugin local pe desktop sau HTTPS public/Secure MCP Tunnel); SDK-ul nu este instalat, iar instalarea cere aprobare
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Opțional, mai târziu: un panou read-only „Hub Companion” în ChatGPT desktop (misiuni, aprobări în așteptare, stare), fără unelte de scriere.
- **Suprafață de execuție:** openai.plugins
- **Echivalent la celălalt ecosistem:** Anthropic: aplicații MCP/UI prin conectorii Claude (anthropic.claude_connectors) și Artifacts (anthropic.claude_artifacts); paritatea entrypoint-urilor nu a fost verificată.
- **Ce face unic / mai bine:** UI nativă în ChatGPT (sidebar, file viewer cu salvare, @mentions) peste standardul MCP Apps; spec și SDK open source.
- **Securitate:** Starea Hub-ului ar intra în contextul modelului (cloud OpenAI); prompt injection prin conținutul afișat; orice scriere trebuie să treacă prin coada de aprobări a Hub-ului; expunerea publică nu este autorizată.
- **Cale de implementare:** 1) Decizie de expunere (preferabil plugin local pe desktop, fără tunel). 2) Server MCP read-only separat de API-ul Hub-ului. 3) UI portabilă MCP Apps, extensiile doar prin feature detection. 4) Activare manuală de către proprietar.
- **Test necesar:** MCP Inspector local, fără model; apoi un singur test manual în ChatGPT desktop aprobat explicit; verificare că nu există unelte de scriere.
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Auditul anterior (H-extensions) le marca BLOCKED din cauza loopback-ului; help 20001256 arată că pluginurile cu aplicații MCP locale rulează în ChatGPT Desktop, deci blocajul ține de decizie, nu neapărat de imposibilitate tehnică.
- **Surse citite:** https://developers.openai.com/plugins/build/extensions · https://github.com/openai/mcp-extensions · https://help.openai.com/en/articles/20001256-plugins-in-chatgpt · https://learn.chatgpt.com/docs/whats-new/september-28-october-2-2026.md · https://openai.com/index/devday-2026-recap/ (captură locală sources-openai-devday.md)
- **Verificare adversarială:** CORRECTED (corectat: platform (https://github.com/openai/mcp-extensions/blob/main/docs/spec.md (Platform Support); https://developers.openai.com/plugins/build/extensions), programmaticDetail (https://github.com/openai/mcp-extensions/blob/main/docs/spec.md; https://developers.openai.com/plugins/build/extensions)) — Am citit pagina developer, spec-ul și README-urile SDK. Sunt confirmate: planurile (pe web, „în curând” pentru Free/Go; @mentions doar în desktop), SDK-urile @openai/mcp-extensions și openai-mcp-extensions (Apache-2.0, repo public creat pe 29.09.2026) și valorile ASSISTED/DOCUMENTED/REFERENCE. Am corectat doar platformele (lipsea mobilul) și nuanța despre serverele locale.

### Plugin Creator, încărcare ZIP, trimitere la review, publicare și descoperire în directorul universal ChatGPT + Codex (`oa-plugin-builder-submission`)

- **Sursă oficială:** https://developers.openai.com/plugins/deploy/submission
- **Documentație tehnică:** https://developers.openai.com/plugins/build/plugins (plugin.json, schema https://agent-plugins.org/schemas/1.0.0/plugin.schema.json)
- **Ce face:** Creare conversațională cu @plugin-creator sau manuală (skills + MCP + UI opțională). Încărcare ZIP pe platform.openai.com/plugins, cu verificări automate, verificare de domeniu /.well-known/openai-apps-challenge, cont de test fără MFA, 5 cazuri pozitive, 3 negative și video. Urmează publicarea în directorul comun ChatGPT și Codex, apoi scanarea zilnică a serverului MCP. Insigna OpenAI Verified nu se acordă automat la publicare: o primesc doar pluginurile din programul OpenAI cu dezvoltatori selectați. Utilizatorii aprobă accesul per plugin.
- **Plan necesar:** Creare: toate abonamentele (recap); trimitere publică: organizație pe platformă cu verificare de identitate (individ sau firmă) și permisiune Apps Management Write; partajare/publicare în workspace doar Business/Enterprise.
- **Platformă:** ChatGPT web/desktop, Codex desktop/CLI; portal platform.openai.com/plugins
- **Rollout:** Disponibil; îmbunătățiri anunțate 29.09.2026
- **Eligibilitate cont:** Crearea personală este probabil disponibilă; nicio organizație de platformă verificată pentru publicare (și nu trebuie creată fără aprobare).
- **Autentificare:** Cont ChatGPT pentru creare; cont de platformă OpenAI verificat pentru trimitere
- **Allowance:** Fără taxă de trimitere menționată
- **Utilizare partajată:** Crearea prin chat consumă limitele Chat/Work
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Nicio taxă documentată; publicarea cu MCP cere server HTTPS public (găzduire nouă, interzisă fără aprobare).
- **Risc de facturare API:** none
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Pachetul este fișier local: plugin.json (sau .codex-plugin/plugin.json compatibil), skills/, mcp.json, assets/; instalare locală în Codex prin marketplace $REPO_ROOT/.agents/plugins/marketplace.json sau ~/.agents/plugins/marketplace.json; comanda `codex plugin` există local. Trimiterea publică se face doar prin portalul web; nu există API de submission documentat.
- **Suprafață nativă:** @plugin-creator în ChatGPT; Plugins > Add (+); platform.openai.com/plugins
- **Cerințe locale:** Pentru uz personal: doar Codex/ChatGPT Desktop; pentru public: MCP Streamable HTTP public, politică de confidențialitate, termeni, suport, cont de test
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Hub-ul poate genera un pachet de plugin privat (skills + server MCP read-only) pe care proprietarul îl revizuiește și îl instalează manual; publicarea publică este respinsă.
- **Suprafață de execuție:** openai.plugins
- **Echivalent la celălalt ecosistem:** Anthropic: pluginuri Claude Code/claude.ai (anthropic.claude_plugins). Ghidul OpenAI de migrare acceptă .claude-plugin/plugin.json + SKILL.md, dar listările și aprobările Claude nu se transferă.
- **Ce face unic / mai bine:** Un singur director pentru ChatGPT și Codex; manifest portabil agent-plugins.org; ghid oficial de conversie a pluginurilor Claude.
- **Securitate:** Publicarea ar expune Hub-ul; pachetele pot conține hooks și scripturi; review-ul OpenAI nu înlocuiește auditul propriu.
- **Cale de implementare:** Doar pachet privat generat în workspace-ul Hub-ului, validat offline și instalat manual de proprietar; fără trimitere publică.
- **Test necesar:** Validare offline a plugin.json față de schemă; test manual de instalare locală, cu aprobare.
- **Status:** DOCUMENTED
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Ghidul submit-claude-plugin: fără .mcpb, fără MCP local la trimitere (decât cu aprobarea OpenAI), MCP obligatoriu Streamable HTTP. Workspace-urile Business/Enterprise pot importa marketplace-uri din GitHub cu sincronizare zilnică.
- **Surse citite:** https://developers.openai.com/plugins/deploy/submission · https://developers.openai.com/plugins/build/plugins · https://developers.openai.com/plugins/concepts/plugins · https://developers.openai.com/plugins/guides/submit-claude-plugin · https://learn.chatgpt.com/docs/build-plugins.md · https://help.openai.com/en/articles/20001256-plugins-in-chatgpt · https://openai.com/index/devday-2026-recap/ (captură locală)
- **Verificare adversarială:** CORRECTED (corectat: whatItDoes (https://help.openai.com/en/articles/20001256-plugins-in-chatgpt; https://developers.openai.com/plugins/deploy/submission.md)) — Sunt confirmate: organizația verificată, Apps Management Write, exact un server MCP remote streamable-http, trimiterea doar prin portal (fără API) și regulile de conversie a pluginurilor Claude. Un rezumat automat sugera că MCP local ar fi acceptat la trimitere; textul brut al paginii îl contrazice.

### Utilizarea pluginurilor din directorul universal (instalare, conectarea aplicațiilor, aprobare per plugin) și oglindirea stării în Hub (`oa-plugins-directory-install`)

- **Sursă oficială:** https://help.openai.com/en/articles/20001256-plugins-in-chatgpt
- **Documentație tehnică:** https://learn.chatgpt.com/docs/app-server.md (plugin/list, plugin/read, app/list, app/installed, app/read, skills/list)
- **Ce face:** Directorul de pluginuri (Public, workspace, Personal, Installed) există pe toate planurile; pluginurile aduc skills, aplicații conectate, șabloane de aplicații și extensii; ChatGPT le folosește automat sau prin @mention; unele sunt marcate Desktop only.
- **Plan necesar:** Directorul pe toate planurile; fiecare plugin depinde de plan, regiune, workspace, rol
- **Platformă:** ChatGPT web/desktop/mobil; Codex desktop și CLI (nu extensia IDE)
- **Rollout:** GA
- **Eligibilitate cont:** Verificat parțial local: `codex plugin list` arată instalate și activate documents, pdf, spreadsheets, presentations, template-creator, browser, chrome, computer-use, unified-computer-use, visualize, codex-app-tools; catalogul remote (gmail, google-drive, github, slack, notion etc.) nu este instalat.
- **Autentificare:** Login ChatGPT („Logged in using ChatGPT”); aplicațiile conectate cer OAuth separat per cont
- **Allowance:** Folosirea consumă limitele Chat/Work/Codex
- **Utilizare partajată:** Work și Codex partajează utilizarea
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Dacă există sold de credite, utilizarea Work/Codex continuă din credite după epuizarea planului; unele aplicații terțe au abonamente proprii.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Citire fără inferență: `codex plugin list` (verificat local) și metodele app-server app/list, app/installed, app/read și skills/list. plugin/list și plugin/read sunt marcate „under development”, iar documentația cere să nu fie apelate din clienți de producție. plugin/install, plugin/uninstall și marketplace/* modifică starea și rămân interzise fără aprobare.
- **Suprafață nativă:** Plugins în bara laterală ChatGPT; @mention; Sources > Use plugins în Codex
- **Cerințe locale:** codex.exe 0.158 din bundle-ul desktop; atenție: Hub-ul rulează cu CODEX_HOME gol, deci vede altă stare decât profilul real al proprietarului
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Hub-ul oglindește read-only lista de pluginuri/aplicații pentru a ști ce capabilități native pot fi cerute într-un turn Codex; nu instalează și nu conectează nimic.
- **Suprafață de execuție:** openai.plugins
- **Echivalent la celălalt ecosistem:** Anthropic: `claude plugin list` (0 pluginuri) și ListPlugins claude.ai (niciunul activ); conectori claude.ai (anthropic.claude_connectors).
- **Ce face unic / mai bine:** Director comun ChatGPT + Codex; pluginuri first-party pentru documente, prezentări și foi de calcul deja instalate local.
- **Securitate:** Citirea din profilul real al proprietarului trebuie limitată la metadate (niciodată auth.json); pluginurile cu hooks rulează cod local.
- **Cale de implementare:** Oglindire read-only prin `codex plugin list` și app/list, app/installed, skills/list. plugin/list și plugin/read se folosesc doar în spatele unui flag experimental, până devin stabile. Snapshot-ul se salvează în registrul de capabilități; nicio instalare.
- **Test necesar:** Test simulat al parsării; o rulare reală read-only fără inferență, aprobată de proprietar.
- **Status:** AVAILABLE
- **Decizie Hub:** MIRROR_STATE
- **Încredere:** high
- **Note:** Directorul Codex se reîmprospătează în până la 6 ore. Instalarea unui plugin nu ocolește autorizarea aplicațiilor sau permisiunile workspace-ului.
- **Surse citite:** https://help.openai.com/en/articles/20001256-plugins-in-chatgpt · https://learn.chatgpt.com/docs/plugins.md · https://learn.chatgpt.com/docs/app-server.md · sources-openai-devday.md secțiunea E (codex plugin list local)
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://learn.chatgpt.com/docs/app-server.md), implementationPath (https://learn.chatgpt.com/docs/app-server.md)) — Sunt confirmate (help 20001256, learn plugins.md): directorul disponibil pe toate planurile, lipsa suportului în extensia IDE, eticheta Desktop only, reîmprospătarea Codex în până la 6 ore și riscul de credite. Statusul AVAILABLE se sprijină pe dovezile locale.

### Apps SDK / UI MCP Apps în ChatGPT (componente iframe, bridge window.openai) (`oa-mcp-apps-ui`)

- **Sursă oficială:** https://developers.openai.com/plugins/build/chatgpt-ui
- **Documentație tehnică:** https://modelcontextprotocol.io/docs/extensions/apps ; https://developers.openai.com/plugins/reference
- **Ce face:** Uneltele MCP returnează resurse UI (_meta.ui.resourceUri, MIME text/html;profile=mcp-app) randate ca card, carusel, ecran complet sau picture-in-picture; comunicare JSON-RPC prin postMessage; extensii opționale window.openai (checkout, fișiere, modale, stare widget).
- **Plan necesar:** Folosire: planurile cu pluginuri. Dezvoltare și testare în developer mode: FAQ-ul Help spune că utilizatorii Pro pot construi aplicații cu Apps SDK și pot conecta servere MCP doar cu permisiuni read/fetch. MCP complet (cu scrieri) este doar pentru Business și Enterprise/Edu, iar aplicațiile MCP din developer mode rulează doar pe web.
- **Platformă:** ChatGPT web, desktop, mobil; alte gazde compatibile MCP Apps
- **Rollout:** Apps SDK marcat „preview” în Help Center (actualizat luna trecută); documentația nouă îl integrează în Plugins
- **Eligibilitate cont:** Neverificată. Dacă planul este Pro, testarea ar fi posibilă doar cu unelte read/fetch în developer mode.
- **Autentificare:** OAuth 2.1 pentru serverul MCP; cont ChatGPT pentru utilizator
- **Allowance:** n/a (consumă limitele conversației)
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Găzduirea unui server MCP public ar fi serviciu nou; checkout doar pentru bunuri fizice.
- **Risc de facturare API:** none
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Hub-ul poate fi doar furnizor MCP cu UI portabilă (ui/notifications/tool-result, tools/call, CSP connectDomains/resourceDomains/frameDomains); nu există API prin care Hub-ul să pornească conversații ChatGPT.
- **Suprafață nativă:** Carduri și vizualizări în conversațiile ChatGPT
- **Cerințe locale:** Server MCP accesibil din ChatGPT; build al componentei (esbuild) — nimic instalat acum
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Referință pentru o singură UI portabilă (ChatGPT + Claude) peste un viitor server MCP read-only al Hub-ului.
- **Suprafață de execuție:** openai.plugins
- **Echivalent la celălalt ecosistem:** Anthropic: MCP Apps prin conectori Claude (anthropic.claude_connectors); Artifacts (anthropic.claude_artifacts)
- **Ce face unic / mai bine:** Standard deschis MCP Apps, portabil între gazde; bibliotecă oficială @openai/apps-sdk-ui și exemple openai/openai-apps-sdk-examples.
- **Securitate:** iframe cu CSP declarat; datele Hub-ului ajung în cloud; prompt injection prin rezultatele uneltelor.
- **Cale de implementare:** Doar după decizia de expunere; UI fără dependență obligatorie de window.openai (feature detection).
- **Test necesar:** MCP Inspector local, fără model
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Documentația recomandă separarea uneltelor de date (structuredContent) de uneltele de randare și păstrarea datelor de business pe server — compatibil cu principiul Hub-ului ca sursă canonică.
- **Surse citite:** https://developers.openai.com/plugins/build/chatgpt-ui · https://developers.openai.com/plugins · https://developers.openai.com/apps-sdk · https://help.openai.com/en/articles/12515353-build-with-the-apps-sdk
- **Verificare adversarială:** CORRECTED (corectat: planRequired (https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt), accountEligibility (https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt)) — Sunt confirmate mecanismul (_meta.ui.resourceUri, bridge ui/* prin postMessage, window.openai opțional, moduri inline/carusel/fullscreen/PiP) și statusul „preview” al Apps SDK (help 12515353).

### Sites cu pluginuri/aplicații conectate (date per vizitator) (`oa-sites-connected-plugins`)

- **Sursă oficială:** https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites
- **Documentație tehnică:** https://learn.chatgpt.com/docs/enterprise/sites.md
- **Ce face:** Site-uri private de workspace care încarcă date din aplicațiile conectate ale fiecărui vizitator (de ex. un dashboard de issue-uri). Adminul setează per plugin „Allow site visitors to use this plugin” (implicit permis în Business/Education, oprit în Enterprise), iar vizitatorul își dă consimțământul. Help Center descrie accesul ca doar de citire, însă ghidul learn permite acțiuni de scriere dacă sunt activate și configurate, cu consimțământ și acțiune explicită a vizitatorului. Accesul nu rulează în fundal.
- **Plan necesar:** Business și Enterprise (recap: și Healthcare, Education)
- **Platformă:** ChatGPT web/desktop
- **Rollout:** Disponibil pentru workspace-uri
- **Eligibilitate cont:** Neeligibil pe un plan individual
- **Autentificare:** Sign in with ChatGPT al vizitatorului + conturile sale conectate
- **Allowance:** Limitele Sites ale workspace-ului
- **Utilizare partajată:** Workspace
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Ar cere plan Business (upgrade interzis automat).
- **Risc de facturare API:** none
- **Integrare programatică:** NONE
- **Detaliu integrare:** Niciun API; configurare doar în UI și setările de admin.
- **Suprafață nativă:** Sites + Workspace settings
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul
- **Suprafață de execuție:** openai.sites
- **Echivalent la celălalt ecosistem:** Anthropic: neverificat
- **Ce face unic / mai bine:** Fiecare vizitator își folosește propriile permisiuni
- **Securitate:** Delegarea accesului la date către un Site publicat
- **Cale de implementare:** Niciuna
- **Test necesar:** n/a
- **Status:** PLAN_RESTRICTED
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** high
- **Note:** În Enterprise, pluginurile sunt oprite implicit pentru Sites; în Business și Edu sunt permise implicit.
- **Surse citite:** https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites · https://learn.chatgpt.com/docs/enterprise/sites.md · https://openai.com/index/devday-2026-recap/ (captură locală)
- **Verificare adversarială:** CORRECTED (corectat: whatItDoes (https://learn.chatgpt.com/docs/sites.md; https://learn.chatgpt.com/docs/enterprise/sites.md; https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites)) — PLAN_RESTRICTED/NOT_APPLICABLE sunt corecte: funcția cere un workspace Business/Enterprise/Edu și un Site privat de workspace.

### Găzduirea unui plugin (server MCP) pe ChatGPT Sites (`oa-sites-hosted-plugin`)

- **Sursă oficială:** https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites
- **Documentație tehnică:** https://help.openai.com/en/articles/20001256-plugins-in-chatgpt
- **Ce face:** ChatGPT sau Codex adaugă un server MCP într-un Site; la publicarea de către proprietar se creează un plugin personal instalabil în ChatGPT/Codex, cu unelte de citire și, opțional, de scriere asupra datelor Site-ului.
- **Plan necesar:** Help-urile despre găzduire și despre pluginuri spun „toate planurile”, dar help-ul Sites precizează că Sites nu este disponibil pe Free sau Go. Practic, funcția este pe Plus, Pro și workspace-uri. Partajarea pluginului: doar în Business/Enterprise; utilizatorii Pro și conturile personale nu îl pot partaja direct.
- **Platformă:** ChatGPT web/desktop, Codex
- **Rollout:** Rollout gradual după DevDay
- **Eligibilitate cont:** Probabil eligibil; neverificat
- **Autentificare:** Cont ChatGPT; flux de conectare al pluginului
- **Allowance:** Limitele Sites + Work/Codex
- **Utilizare partajată:** Work + Codex
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** Inclus pe durata beta Sites
- **Risc de facturare API:** none
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Creat doar prin prompt; niciun API; Sites nu acceptă rețele private, deci nu poate face proxy către Hub-ul local.
- **Suprafață nativă:** Sites + Plugins > Personal > Created by you
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Nu se folosește pentru datele Hub-ului (ar muta date în cloud); referință pentru materiale publice.
- **Suprafață de execuție:** openai.sites
- **Echivalent la celălalt ecosistem:** Anthropic: neverificat
- **Ce face unic / mai bine:** MCP găzduit fără infrastructură proprie
- **Securitate:** Datele trebuie urcate în Site (cloud OpenAI); uneltele de scriere modifică Site-ul fără aprobarea Hub-ului.
- **Cale de implementare:** Niciuna
- **Test necesar:** n/a
- **Status:** DOCUMENTED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** În workspace-uri necesită Use plugins, Upload plugins și Create plugins with MCPs.
- **Surse citite:** https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites · https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites · https://help.openai.com/en/articles/20001256-plugins-in-chatgpt
- **Verificare adversarială:** CORRECTED (corectat: planRequired (https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites; https://help.openai.com/en/articles/20001256-plugins-in-chatgpt; https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites)) — Sunt confirmate rollout-ul gradual după DevDay, uneltele opționale de scriere și permisiunile de workspace. REJECT este consecvent: datele Hub-ului ar trebui urcate în cloud.

### Apps (conectori) în ChatGPT: conexiuni de cont per furnizor, permisiuni pentru acțiuni, sync și workspace connections (`oa-gap-chatgpt-apps-connections`)

- **Sursă oficială:** https://help.openai.com/en/articles/11487775-connected-apps-in-chatgpt
- **Documentație tehnică:** https://learn.chatgpt.com/docs/enterprise/shared-connections ; https://learn.chatgpt.com/docs/config-file/config-reference.md (apps.*) ; https://learn.chatgpt.com/docs/app-server (app/list, app/installed)
- **Ce face:** Apps conectează ChatGPT la servicii (Google Drive, Slack, GitHub, Gmail, SharePoint, Notion etc.) cu autorizare per cont de furnizor, din Settings > Plugins. Pot căuta și cita informații, pot fi surse în deep research, pot sincroniza conținut (sync gestionat de admin), oferă UI interactiv și acțiuni suportate. Permisiuni per aplicație: Always ask, Allow read actions, Allow low-risk actions, Allow all actions (risc ridicat; acțiunile pot rula fără confirmare). Suportă taskuri declanșate de evenimente și abonamente la actualizări. Pluginurile pot include apps, dar instalarea unui plugin nu ocolește autorizarea. Workspace connections (Business/Enterprise): conturi de companie autorizate de admin pentru Team Tasks și @ChatGPT în Slack/Teams. În Codex, features.apps este stable și activ, iar traficul apps nu trece prin proxy-ul de rețea al sandbox-ului.
- **Plan necesar:** Apps personale: depind de aplicație, plan, regiune și model. Workspace connections și company knowledge: doar Business/Enterprise.
- **Platformă:** ChatGPT web, desktop, mobil; Codex (apps în fire)
- **Rollout:** GA; conectorii individuali au disponibilitate proprie.
- **Eligibilitate cont:** Local: flagul apps este true și catalogul curat de pluginuri (gmail, google-drive, github etc.) este vizibil; workspace connections nu se aplică unui cont personal.
- **Autentificare:** OAuth per furnizor, gestionat de ChatGPT; conexiuni admin în workspace.
- **Allowance:** Utilizarea apps poate consuma limitele planului, alocări specifice și limitele furnizorului.
- **Utilizare partajată:** Limitele Chat, Work și Codex, după suprafață.
- **Inclus în abonament?:** partial
- **Risc de facturare suplimentară (credite/extra usage):** Furnizorul aplicației poate avea costuri proprii.
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Citire în Codex: app/list, app/installed {threadId}, app/read (deja acoperite de oa-plugins-directory-install). Garduri per fir Hub: codex app-server --disable apps sau -c apps._default.enabled=false; activare punctuală cu -c apps.<id>.enabled=true, apps.<id>.destructive_enabled=false și default_tools_approval_mode="prompt". Conectarea conturilor și permisiunile ChatGPT se fac doar de proprietar în UI.
- **Suprafață nativă:** Settings > Plugins; @mențiuni în composer; Admin Console pentru workspace connections
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Proprietarul gestionează conexiunile; firele Hub rulează implicit fără apps, iar o aplicație se activează per misiune, cu aprobare Hub și fără acțiuni destructive.
- **Suprafață de execuție:** openai.chatgpt_chat
- **Echivalent la celălalt ecosistem:** an-connectors-directory și an-claudeai-connectors-in-claude-code
- **Ce face unic / mai bine:** Permisiuni granulare pe tipuri de acțiuni; evenimente și abonamente din aplicațiile conectate.
- **Securitate:** Aplicațiile primesc context din conversație și din memorie; pe planurile personale, datele accesate pot fi folosite la antrenare dacă setarea Improve the model este activă; Allow all actions elimină confirmările; acțiunile externe (email, Slack) cer aprobarea Hub.
- **Cale de implementare:** 1) --disable apps în lansarea standard. 2) Profil de misiune cu listă de apps permise. 3) Recomandare scrisă pentru proprietar: fără Allow all actions.
- **Test necesar:** Fără model: app/installed pe un fir Hub pornit cu garduri trebuie să arate aplicații necallable.
- **Status:** AVAILABLE
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** Suprapuneri parțiale cu oa-plugins-directory-install, oa-teams-team-tasks, oa-chatgpt-slack-teams și oa-event-triggered-tasks; aici este acoperit stratul apps propriu-zis. Firele Hub au acum apps active implicit dacă adaptorul nu le dezactivează.
- **Surse citite:** https://help.openai.com/en/articles/11487775-connected-apps-in-chatgpt · https://learn.chatgpt.com/docs/enterprise/shared-connections.md · https://learn.chatgpt.com/docs/config-file/config-reference.md · https://learn.chatgpt.com/docs/app-server · https://learn.chatgpt.com/docs/migrate-custom-gpts.md
- **Verificare adversarială:** CONFIRMED — Help 11487775 (actualizat azi, citit prin browserul integrat) confirmă conectarea din Settings > Plugins și opțiunile de permisiune Always ask, Allow read actions, Allow low-risk actions, Allow all actions (risc ridicat, lipsă din selectoarele la nivel de cont sau workspace). Mai confirmă taskurile declanșate de evenimente (Gmail, Slack, GitHub), abonamentele la actualizări, sync gestionat de admin, contextul și memoria partajate cu aplicațiile și antrenarea pe planurile personale dacă Improve the model este activ. Cheile de config sunt documentate: features.apps, apps._default.enabled, apps.<id>.enabled, apps.<id>.destructive_enabled și apps.<id>.default_tools_approval_mode (auto \| prompt \| writes \| approve). Există și apps._default.open_world_enabled și apps.<id>.open_world_enabled, utile de setat pe false. Config reference confirmă că traficul apps nu trece prin proxy-ul de rețea al sandbox-ului. Workspace connections sunt documentate în secțiunea enterprise.

## skills

### Skills Codex (SKILL.md, standardul Agent Skills) (`oa-codex-skills`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/build-skills
- **Documentație tehnică:** https://learn.chatgpt.com/docs/build-skills ; https://learn.chatgpt.com/docs/app-server (skills/*)
- **Ce face:** Pachete de instrucțiuni, scripturi, referințe și resurse invocate explicit ($skill, /skills) sau implicit pe baza descrierii.
- **Plan necesar:** Toate planurile
- **Platformă:** CLI, desktop, IDE, ChatGPT
- **Rollout:** Stable
- **Eligibilitate cont:** Flaguri locale skill_search și skill_mcp_dependency_install active.
- **Autentificare:** n/a
- **Allowance:** Skills nu consumă separat; folosirea lor consumă ca turnul.
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** SKILL.md cu frontmatter name și description; opțional scripts/, references/, assets/, agents/openai.yaml (afișare, allow_implicit_invocation, dependențe MCP). Locații: $CWD/.agents/skills până la $REPO_ROOT, $HOME/.agents/skills, /etc/codex/skills, skills de sistem; symlinkuri urmate; [[skills.config]] pentru dezactivare. App-server: skills/list{cwds, forceReload, perCwdExtraUserRoots}, skills/extraRoots/set (fără persistare), skills/config/write, notificarea skills/changed.
- **Suprafață nativă:** $skill, /skills, $skill-creator, $skill-installer
- **Cerințe locale:** Folder .agents/skills în repo.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Format comun pentru procedurile companiei: aceleași skills pentru Codex și Claude.
- **Suprafață de execuție:** openai.codex_cli
- **Echivalent la celălalt ecosistem:** anthropic.claude_skills (SKILL.md, Agent Skills).
- **Ce face unic / mai bine:** Construit pe standardul deschis Agent Skills (agentskills.io); rădăcini suplimentare injectabile per proces fără scriere de config.
- **Securitate:** Skills pot conține scripturi executabile; review înainte de includere.
- **Cale de implementare:** Skills canonice ale Hub-ului în .agents/skills din repo; pentru firele Hub se adaugă rădăcini prin skills/extraRoots/set; pentru Claude, oglindire în .claude/skills sau plugin.
- **Test necesar:** skills/list pe cwd-ul proiectului (fără inferență).
- **Status:** AVAILABLE
- **Decizie Hub:** REUSE_NATIVE
- **Încredere:** high
- **Note:** Două skills cu același nume nu se combină; ambele apar în selectoare.
- **Surse citite:** https://learn.chatgpt.com/docs/build-skills · https://learn.chatgpt.com/docs/app-server · https://learn.chatgpt.com/docs/developer-commands?surface=cli
- **Verificare adversarială:** CONFIRMED — Pagina Build skills confirmă standardul agentskills.io, SKILL.md cu name și description, agents/openai.yaml cu allow_implicit_invocation, locațiile REPO/USER/ADMIN/SYSTEM, symlinkurile și [[skills.config]]; app-server.md confirmă skills/list, skills/extraRoots/set fără persistare și skills/changed.

### Skills în ChatGPT (creare, încărcare, partajare) (`oa-chatgpt-skills`)

- **Sursă oficială:** https://help.openai.com/en/articles/20001066-skills-in-chatgpt
- **Documentație tehnică:** https://learn.chatgpt.com/docs/build-skills.md
- **Ce face:** Fluxuri reutilizabile (instrucțiuni, exemple, cod) folosite automat de ChatGPT; skill-creator implicit; încărcare cu scanare (Needs Review/Blocked); partajare în workspace.
- **Plan necesar:** Biblioteca Skills din ChatGPT (creare, încărcare cu scanare, partajare în workspace): Business, Enterprise, Healthcare, Edu. Skill-urile standalone rulează în ChatGPT desktop, Codex CLI și extensia IDE, iar skill-urile incluse în pluginuri funcționează în Chat și Work pe web, desktop și mobil.
- **Platformă:** ChatGPT web/desktop; Codex separat
- **Rollout:** GA pe planurile eligibile
- **Eligibilitate cont:** Pe un plan individual, biblioteca Skills din ChatGPT web nu este disponibilă. Sunt însă disponibile skill-urile locale (ChatGPT desktop/Codex) și cele împachetate în pluginuri (inclusiv create cu @plugin-creator). Contul nu a fost verificat.
- **Autentificare:** Cont ChatGPT
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** n/a
- **Risc de facturare API:** none
- **Integrare programatică:** NONE
- **Detaliu integrare:** Pentru Codex: app-server skills/list, skills/config/write (scriere interzisă fără aprobare).
- **Suprafață nativă:** Plugins > Skills
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Hub-ul folosește skills prin Codex, nu prin ChatGPT chat.
- **Suprafață de execuție:** openai.chatgpt_skills
- **Echivalent la celălalt ecosistem:** Anthropic: skills claude.ai (anthropic.claude_skills; 13 skills active local)
- **Ce face unic / mai bine:** Scanare automată la încărcare
- **Securitate:** Skills externe pot conține cod
- **Cale de implementare:** Niciuna în ChatGPT
- **Test necesar:** n/a
- **Status:** PLAN_RESTRICTED
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Profilul personal nu poate partaja skills.
- **Surse citite:** https://help.openai.com/en/articles/20001066-skills-in-chatgpt · https://help.openai.com/en/articles/20001256-plugins-in-chatgpt · https://learn.chatgpt.com/docs/skills-and-plugins.md
- **Verificare adversarială:** CORRECTED (corectat: planRequired (https://help.openai.com/en/articles/20001066-skills-in-chatgpt; https://learn.chatgpt.com/docs/build-skills.md), accountEligibility (https://learn.chatgpt.com/docs/build-skills.md; https://help.openai.com/en/articles/20001256-plugins-in-chatgpt)) — PLAN_RESTRICTED rămâne valabil doar pentru biblioteca Skills de workspace. REFERENCE este consecvent cu folosirea skill-urilor prin Codex.

### Izolarea skill-urilor native în firele Codex lansate de Hub ([[skills.config]], skills/config/write, skills/extraRoots/set, skill_mcp_dependency_install) (`oa-gap-codex-skills-isolation`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/build-skills
- **Documentație tehnică:** https://learn.chatgpt.com/docs/app-server (skills/list, skills/config/write, skills/extraRoots/set) ; https://learn.chatgpt.com/docs/config-file/config-reference.md
- **Ce face:** Codex descoperă skills din REPO (.agents/skills de la CWD până la rădăcina depozitului), USER ($HOME/.agents/skills), ADMIN (/etc/codex/skills), SYSTEM (incluse în binar) și din pluginurile instalate. Scope-ul USER depinde de HOME, nu de CODEX_HOME, deci un CODEX_HOME gol nu izolează cele 14 skill-uri locale. Mecanisme: intrări [[skills.config]] cu path și enabled = false în config.toml (persistente, cer restart); skills/config/write (după path sau name, scrie config); skills/extraRoots/set (rădăcini suplimentare la nivel de proces, nepersistente); skills/list (cwds, forceReload, perCwdExtraUserRoots) pentru audit; allow_implicit_invocation: false în agents/openai.yaml; skills.max_context_tokens. skip_host_skill_discovery este under development (false) și nedocumentat. skill_mcp_dependency_install (stable, true) permite prompt și instalarea dependențelor MCP declarate de skills.
- **Plan necesar:** Toate planurile
- **Platformă:** Codex CLI, app-server, desktop
- **Rollout:** Mecanismele config și app-server sunt stabile; skip_host_skill_discovery nu este gata.
- **Eligibilitate cont:** Local: 14 intrări în ~/.agents/skills și pluginuri OpenAI instalate (documents, pdf, spreadsheets, presentations, visualize etc.) care pot aduce skills.
- **Autentificare:** n/a
- **Allowance:** Catalogul de skills consumă context (implicit 2% din fereastră, maxim 10000 tokeni).
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Indirect: skills implicite pot declanșa unelte costisitoare (imagini, subagenți).
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Per proces copil, fără schimbare globală: codex app-server --disable skill_mcp_dependency_install și -c 'skills.config=[{path="...\\SKILL.md",enabled=false}]' (sintaxă TOML inline, netestată), sau un CODEX_HOME dedicat Hub-ului cu propriul config.toml. Audit obligatoriu: skills/list {cwds:[workspace], forceReload:true} la pornirea firului; refuz dacă apare un skill neaprobat. skills/config/write rămâne interzis (scrie config).
- **Suprafață nativă:** Setările de skills din desktop; $skill în composer.
- **Cerințe locale:** Listă aprobată de skills Hub (format Agent Skills).
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Firele Hub rulează doar cu skill-urile companiei aprobate; skill-urile terțe din profilul proprietarului sunt dezactivate sau refuzate.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** an-cc-safe-mode-isolation (--setting-sources, --safe-mode) și std-agent-skills-discovery-paths
- **Ce face unic / mai bine:** skills/list oferă un inventar verificabil per cwd, cu erori și dependențe.
- **Securitate:** Skill-urile terțe pot conține instrucțiuni sau scripturi neverificate; instalarea automată a dependențelor MCP ar modifica configurația, lucru interzis în BUILD_SAFE.
- **Cale de implementare:** 1) Decizie CODEX_HOME dedicat versus -c per proces. 2) --disable skill_mcp_dependency_install implicit. 3) Gate de audit skills/list înainte de prima tură. 4) Skill-urile Hub livrate prin extraRoots sau în repo (.agents/skills).
- **Test necesar:** Fără model: pornire app-server cu garduri, apoi skills/list care nu trebuie să conțină skill-uri terțe.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** WRAP
- **Încredere:** medium
- **Note:** oa-codex-skills acoperă formatul; acest record acoperă izolarea. Contradicție cu handshake-ul V2: CODEX_HOME gol nu oprește descoperirea din $HOME/.agents/skills.
- **Surse citite:** https://learn.chatgpt.com/docs/llms-full.txt (Build skills, locații) · https://learn.chatgpt.com/docs/app-server · https://learn.chatgpt.com/docs/config-file/config-reference.md · local: codex features list (0.159.0) · local: ~/.agents/skills (14 intrări)
- **Verificare adversarială:** CONFIRMED — build-skills.md confirmă locațiile REPO ($CWD/.agents/skills până la rădăcina depozitului), USER ($HOME/.agents/skills), ADMIN (/etc/codex/skills) și SYSTEM, plus [[skills.config]] cu enabled = false (cere restart) și allow_implicit_invocation: false. Bugetul catalogului: 2% din fereastra de context sau 8.000 de caractere când fereastra e necunoscută. Config reference: skills.max_context_tokens are implicit 2%, cu plafon de 10000 tokeni. App-server documentează skills/list (cwds, forceReload, perCwdExtraUserRoots), skills/extraRoots/set (nepersistent, la nivel de proces) și skills/config/write (după path). features.skill_mcp_dependency_install este documentat (stable, activ implicit). skip_host_skill_discovery nu apare în documentație. Documentația e inconsistentă: config reference descrie skills.config.<index>.path ca dosar cu SKILL.md, iar exemplul din build-skills folosește calea către SKILL.md; forma din -c trebuie testată. Local există 14 intrări în ~/.agents/skills.

## mcp

### Codex ca client MCP (`oa-codex-mcp-client`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/extend/mcp
- **Documentație tehnică:** https://learn.chatgpt.com/docs/extend/mcp ; https://learn.chatgpt.com/docs/app-server (mcpServer*)
- **Ce face:** Conectează Codex la servere MCP stdio sau streamable HTTP, cu configurație partajată între desktop, CLI și IDE.
- **Plan necesar:** Toate planurile (tabel: MCP)
- **Platformă:** CLI, desktop, IDE
- **Rollout:** Stable
- **Eligibilitate cont:** Comanda codex mcp există local.
- **Autentificare:** Bearer, OAuth (CIMD, DCR, client secret), sesiune ChatGPT pentru servere first-party
- **Allowance:** Fiecare server adaugă context și consumă mai mult din limită.
- **Utilizare partajată:** Alocarea comună a planului.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Context suplimentar per server.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** config.toml [mcp_servers.<nume>]: command/args/env/cwd sau url; enabled_tools/disabled_tools; default_tools_approval_mode și tools.<tool>.approval_mode; startup_timeout_sec (10), tool_timeout_sec (60); experimental_environment=remote. CLI: codex mcp add\|list\|get\|remove\|login\|logout (--oauth-client-secret din 0.158). App-server: mcpServerStatus/list, mcpServer/tool/call, mcpServer/resource/read, config/mcpServer/reload, mcpServer/oauth/login, elicitation.
- **Suprafață nativă:** Setări MCP în desktop, /mcp în TUI.
- **Cerințe locale:** Server MCP local al Hub-ului (de construit).
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Canal prin care Codex citește starea Hub (misiuni, taskuri, memorie) fără vendor lock-in.
- **Suprafață de execuție:** openai.codex_cli
- **Echivalent la celălalt ecosistem:** claude --mcp-config/--strict-mcp-config, claude mcp add/list.
- **Ce face unic / mai bine:** Aprobare per unealtă și liste allow/deny.
- **Securitate:** Serverele MCP rulează cu drepturile utilizatorului; secretele din env nu se scriu în config.
- **Cale de implementare:** Hub-ul oferă un server MCP local read-only doar firelor proprii, prin override-uri de proces, fără a modifica ~/.codex/config.toml; alternativ dynamicTools (experimental).
- **Test necesar:** mcpServerStatus/list după override (fără inferență).
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Același server MCP poate fi dat și lui Claude prin --mcp-config.
- **Surse citite:** https://learn.chatgpt.com/docs/extend/mcp · https://learn.chatgpt.com/docs/app-server · https://learn.chatgpt.com/docs/changelog
- **Verificare adversarială:** CONFIRMED — Pagina MCP confirmă serverele stdio și streamable HTTP, OAuth cu CIMD/DCR, enabled_tools/disabled_tools, modurile de aprobare, timeout-urile implicite 10 și 60 de secunde și experimental_environment; changelog-ul 0.158.0 confirmă --oauth-client-secret.

### Codex ca server MCP (codex mcp-server) — eliminat (`oa-codex-mcp-server-removed`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/changelog
- **Documentație tehnică:** https://learn.chatgpt.com/docs/cli/reference (codex mcp-server) ; https://learn.chatgpt.com/docs/codex-sdk
- **Ce face:** Comanda codex mcp-server și binarul codex-mcp-server au fost eliminate pe 05.09.2026, după deprecierea din 24.08.2026; integrările trebuie mutate pe app-server.
- **Plan necesar:** n/a
- **Platformă:** n/a
- **Rollout:** Eliminat
- **Eligibilitate cont:** n/a
- **Autentificare:** n/a
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** n/a
- **Risc de facturare API:** none
- **Integrare programatică:** NONE
- **Detaliu integrare:** Înlocuitor oficial: codex app-server.
- **Suprafață nativă:** n/a
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul.
- **Suprafață de execuție:** none
- **Echivalent la celălalt ecosistem:** claude mcp serve (Claude Code ca server MCP).
- **Ce face unic / mai bine:** n/a
- **Securitate:** n/a
- **Cale de implementare:** Nu se construiește nimic pe această rută.
- **Test necesar:** Niciunul.
- **Status:** NOT_APPLICABLE
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Un rezumat automat al paginii MCP a afirmat eronat că comanda există; textul brut nu o menționează.
- **Surse citite:** https://learn.chatgpt.com/docs/changelog · https://learn.chatgpt.com/docs/cli/reference · https://learn.chatgpt.com/docs/codex-sdk · https://learn.chatgpt.com/docs/extend/mcp
- **Verificare adversarială:** CONFIRMED — Changelog-ul (depreciere 24.08.2026, eliminare 05.09.2026), pagina de migrare și referința CLI confirmă eliminarea codex mcp-server și înlocuirea cu app-server; app-server nu este un server MCP drop-in.

### Developer mode și aplicații MCP personalizate în ChatGPT (web) (`oa-developer-mode-custom-mcp`)

- **Sursă oficială:** https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
- **Documentație tehnică:** https://developers.openai.com/plugins/deploy/connect-chatgpt
- **Ce face:** Conectează un server MCP propriu (HTTPS public la /mcp sau Secure MCP Tunnel), scanează uneltele și permite testarea, inclusiv a acțiunilor de scriere cu confirmare; în workspace-uri adminii publică aplicațiile și controlează acțiunile.
- **Plan necesar:** MCP complet (inclusiv scrieri), în beta: Business și Enterprise/Edu, doar pe web. Pro: developer mode cu servere MCP read/fetch (FAQ Help). Documentația developer: activare din Settings > Security and login, în funcție de cont și de politica workspace-ului.
- **Platformă:** ChatGPT web
- **Rollout:** Beta
- **Eligibilitate cont:** Planul contului nu este verificat. Dacă este Pro, developer mode ar permite doar MCP read/fetch. Setarea nu a fost verificată.
- **Autentificare:** OAuth 2.1 (CIMD preferat, DCR, client predefinit) sau fără autentificare; mTLS cu lanțul de certificate OpenAI
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Expunerea publică sau tunelul ar fi servicii noi.
- **Risc de facturare API:** none
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Hub-ul ar fi server MCP; înregistrarea conexiunii se face manual în UI; localhost nu este acceptat direct.
- **Suprafață nativă:** Settings > Security and login > Developer mode; Plugins > conexiune nouă
- **Cerințe locale:** Endpoint HTTPS public sau Secure MCP Tunnel
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Nu acum; se preferă varianta locală pe desktop (oa-local-mcp-plugin-desktop), fără expunere publică.
- **Suprafață de execuție:** openai.plugins
- **Echivalent la celălalt ecosistem:** Anthropic: conectori personalizați remote în claude.ai (anthropic.claude_connectors)
- **Ce face unic / mai bine:** Acțiuni de scriere cu confirmare; controale RBAC și Action control în Enterprise
- **Securitate:** Expunere publică a Hub-ului; prompt injection; unelte de scriere.
- **Cale de implementare:** Neimplementat; reevaluare doar după o decizie explicită de expunere.
- **Test necesar:** n/a până la aprobare
- **Status:** ELIGIBILITY_UNKNOWN
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** FAQ-ul Help confirmă developer mode pentru Pro, limitat la read/fetch. Contradicția rămasă ține doar de căile din meniu: Help indică Settings → Apps → Advanced settings, iar documentația developer, Settings → Security and login. Serverele locale nu se conectează direct: doar endpoint HTTPS public, tunel de dezvoltare sau Secure MCP Tunnel.
- **Surse citite:** https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt · https://developers.openai.com/plugins/deploy/connect-chatgpt · https://developers.openai.com/plugins/build/auth · https://help.openai.com/en/articles/12515353-build-with-the-apps-sdk
- **Verificare adversarială:** CORRECTED (corectat: planRequired (https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt; https://developers.openai.com/plugins/deploy/connect-chatgpt.md), accountEligibility (https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt), notes (https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt; https://developers.openai.com/plugins/deploy/connect-chatgpt.md)) — Statusul ELIGIBILITY_UNKNOWN și decizia REFERENCE rămân corecte; planul contului rămâne neverificat.

### Aplicații MCP locale în pluginuri personale și servere MCP locale în ChatGPT Desktop/Codex (`oa-local-mcp-plugin-desktop`)

- **Sursă oficială:** https://help.openai.com/en/articles/20001256-plugins-in-chatgpt
- **Documentație tehnică:** https://learn.chatgpt.com/docs/extend/mcp.md
- **Ce face:** Un plugin poate include aplicații MCP care rulează pe calculatorul utilizatorului și se folosesc în ChatGPT Desktop (nu pe web sau mobil). Serverele MCP stdio sau Streamable HTTP se configurează în ~/.codex/config.toml [mcp_servers.*] sau din Settings > MCP servers, cu aprobări per unealtă și liste allow/deny.
- **Plan necesar:** Nespecificat pentru uz personal; în workspace-uri cere permisiunea Create plugins with MCPs
- **Platformă:** ChatGPT desktop (macOS, Windows), Codex CLI și IDE
- **Rollout:** Disponibil
- **Eligibilitate cont:** Probabil disponibil (Codex CLI 0.158 are `codex mcp`); nimic configurat.
- **Autentificare:** Proces local; stdio fără OAuth
- **Allowance:** Apelurile uneltelor consumă limitele Work/Codex ale turnului
- **Utilizare partajată:** Work + Codex
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul identificat
- **Risc de facturare API:** none
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Hub-ul expune un server MCP stdio read-only (de exemplu [mcp_servers.ifrim-hub] cu command/args către un script din v2) sau un plugin personal cu aplicație MCP locală; ChatGPT Desktop/Codex îl apelează. Moduri de aprobare per unealtă auto/prompt/writes/approve.
- **Suprafață nativă:** ChatGPT Desktop Settings > MCP servers; Plugins > Personal
- **Cerințe locale:** ChatGPT desktop pornit; server MCP local; modificarea config.toml a proprietarului (necesită aprobare explicită)
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Calea preferată pentru a aduce starea Hub-ului (misiuni, aprobări, memorie, audit) în ChatGPT fără expunere publică; propunerile venite din ChatGPT intră doar în coada de aprobări.
- **Suprafață de execuție:** openai.chatgpt_desktop_local
- **Echivalent la celălalt ecosistem:** Anthropic: servere MCP locale în Claude Code (`claude mcp add`) și Claude Desktop (anthropic.claude_connectors)
- **Ce face unic / mai bine:** Fără tunel și fără HTTPS public; config partajat între Codex CLI, IDE și desktop.
- **Securitate:** Uneltele de scriere ar permite modelului să modifice Hub-ul — doar read-only sau „propose”; datele citite intră în contextul modelului (cloud OpenAI); secretele nu se expun niciodată prin MCP.
- **Cale de implementare:** 1) Server MCP read-only separat de API. 2) Hub-ul generează o propunere de config pe care proprietarul o aplică manual. 3) Test manual în desktop.
- **Test necesar:** Teste unitare ale serverului MCP fără model; un test manual aprobat în ChatGPT Desktop.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** ASSISTED
- **Încredere:** medium
- **Note:** learn extend/mcp spune că Web/Work nu folosesc MCP local, iar help 20001256 spune că pluginurile cu aplicații MCP locale rulează în ChatGPT Desktop; probabil valabil pentru desktop (Work local și Codex), de verificat.
- **Surse citite:** https://help.openai.com/en/articles/20001256-plugins-in-chatgpt · https://learn.chatgpt.com/docs/extend/mcp.md · https://learn.chatgpt.com/docs/enterprise/plugin-management.md · https://developers.openai.com/plugins/build/plugins
- **Verificare adversarială:** CONFIRMED — Help 20001256 confirmă că pluginurile cu aplicații MCP locale rulează doar în ChatGPT Desktop. Learn extend/mcp confirmă: desktop, Codex CLI și IDE partajează [mcp_servers.*] din config.toml, cu enabled_tools/disabled_tools și default_tools_approval_mode auto/prompt/writes/approve; ChatGPT web nu citește configurația locală. NEEDS_SETUP/ASSISTED sunt consecvente.

### Secure MCP Tunnel (tunnel-client outbound pentru servere MCP private) (`oa-secure-mcp-tunnel`)

- **Sursă oficială:** https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- **Documentație tehnică:** https://github.com/openai/tunnel-client/releases/latest
- **Ce face:** Un binar tunnel-client rulat în rețeaua proprie deschide doar conexiuni HTTPS outbound către api.openai.com, preia prin long-poll cererile JSON-RPC și le trimite serverului MCP privat; funcționează cu aplicații developer-mode din ChatGPT, Responses API și Codex; nu servește distribuției publice.
- **Plan necesar:** Organizație pe platforma API cu permisiuni Tunnels Read + Manage/Use; pentru ChatGPT și o permisiune developer-mode separată
- **Platformă:** tunnel-client (release GitHub); outbound 443 către api.openai.com sau mtls.api.openai.com
- **Rollout:** Documentat, fără etichetă beta
- **Eligibilitate cont:** Necunoscută; Hub-ul nu are organizație API și nu trebuie să creeze una fără aprobare.
- **Autentificare:** Cheie API runtime pentru tunnel-client + tunnel_id
- **Allowance:** Nedocumentat
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** unknown
- **Risc de facturare suplimentară (credite/extra usage):** Cere cont/organizație API și cheie API, contrar politicii INCLUDED_SUBSCRIPTION_ONLY; costul tunelului nu este documentat.
- **Risc de facturare API:** unknown
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** tunnel-client + tunnel_id din platform.openai.com/settings/organization/tunnels; suportă proxy outbound, CA custom, mTLS; nu tunelează serverele OAuth.
- **Suprafață nativă:** Setările de tuneluri ale organizației pe platform.openai.com
- **Cerințe locale:** Binar tunnel-client (neinstalat), cheie API (inexistentă)
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Doar referință; varianta locală pe desktop nu cere cheie API.
- **Suprafață de execuție:** openai.secure_mcp_tunnel
- **Echivalent la celălalt ecosistem:** Anthropic: echivalent neverificat în această sesiune
- **Ce face unic / mai bine:** Fără porturi inbound; potrivit rețelelor enterprise
- **Securitate:** Cheie API stocată local; canal permanent către cloud; traficul tunelului este exclus din logurile de conformitate ale aplicației.
- **Cale de implementare:** Niciuna fără o decizie explicită de billing și securitate.
- **Test necesar:** n/a
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** medium
- **Note:** Relevant doar dacă proprietarul decide vreodată expunerea Hub-ului către ChatGPT web.
- **Surse citite:** https://developers.openai.com/api/docs/guides/secure-mcp-tunnels · https://developers.openai.com/plugins/deploy/connect-chatgpt
- **Verificare adversarială:** CONFIRMED — Confirmat în ghidul Secure MCP Tunnel: tunnel-client face doar conexiuni outbound către api.openai.com:443 sau mtls.api.openai.com și cere tunnel_id, cheie API runtime și permisiunile Tunnels Read+Manage/Use. Serverul OAuth nu este tunelat, iar prețul nu este documentat. Nuanțe: conturile personale folosesc organizația Platform personală. Traficul de transport al tunelului nu apare ca evenimente de conformitate, dar logarea la nivel de aplicație se aplică în continuare.

### MCP Events pentru automatizări de pluginuri (events/list, events/subscribe, webhook) (`oa-mcp-events`)

- **Sursă oficială:** https://developers.openai.com/plugins/build/mcp-events
- **Documentație tehnică:** https://github.com/modelcontextprotocol/experimental-ext-triggers-events ; https://modelcontextprotocol.io/community/working-groups/triggers-events
- **Ce face:** ChatGPT se abonează la evenimente de la servere MCP; serverul livrează prin POST HTTPS semnat Standard Webhooks HMAC (webhook-id, webhook-timestamp, webhook-signature, X-MCP-Subscription-Id), maximum 256 KiB, iar ChatGPT rulează automatizarea descrisă de utilizator.
- **Plan necesar:** Recap: toate abonamentele; sarcinile declanșate de evenimente cer Work pe Plus, Pro, Business, Enterprise, Edu
- **Platformă:** MCP 2.0, protocol 2026-07-28; doar livrare webhook
- **Rollout:** Disponibil în ChatGPT; specificația este încă experimentală (WG Triggers & Events, charter 24.03.2026, SEP în stadiul „Ideating”)
- **Eligibilitate cont:** Neverificată
- **Autentificare:** Endpoint MCP autentificat; secret de semnare per abonament; callback verificat prin challenge
- **Allowance:** Rulările consumă Work; sarcinile event-triggered sunt limitate la 30/oră și 720/zi
- **Utilizare partajată:** Work + Codex
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Creditele se consumă după limită doar dacă există sold/opțiune activă.
- **Risc de facturare API:** low
- **Integrare programatică:** ASSISTED
- **Detaliu integrare:** Hub-ul ar trebui să fie server MCP 2.0 accesibil din ChatGPT, cu stocare persistentă a abonamentelor și HTTPS outbound către callback-ul furnizat de ChatGPT; callback-urile către adrese private/locale sunt interzise, fără redirecturi; fără polling sau streaming. Local, flagul codex mcp_2026_07_28 este încă „under development”.
- **Suprafață nativă:** Utilizatorul descrie în ChatGPT ce se urmărește; gestionare în Scheduled
- **Cerințe locale:** Endpoint MCP public sau tunel; trafic outbound
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Hub-ul păstrează un bus intern canonic cu aceeași semantică (deduplicare, ordine, replay, semnătură HMAC — deja testat) și amână puntea către ChatGPT.
- **Suprafață de execuție:** openai.plugins
- **Echivalent la celălalt ecosistem:** Anthropic co-conduce WG Triggers & Events (Peter Alexander); suportul în produsele Claude nu a fost verificat.
- **Ce face unic / mai bine:** Automatizări pe evenimente reale, fără polling; payload strict de date, fără instrucțiuni pentru model.
- **Securitate:** Webhook-urile outbound sunt efecte externe; semnături și reverificare obligatorii; expunerea publică a Hub-ului neautorizată.
- **Cale de implementare:** Menține formatul intern compatibil cu Standard Webhooks pentru o eventuală punte ulterioară aprobată.
- **Test necesar:** Testele interne existente (deduplicare, ordine, replay)
- **Status:** BLOCKED
- **Decizie Hub:** REIMPLEMENT
- **Încredere:** high
- **Note:** Recap-ul vorbește de specificație „propusă”; OpenAI o implementează înaintea finalizării standardului.
- **Surse citite:** https://developers.openai.com/plugins/build/mcp-events · https://modelcontextprotocol.io/community/working-groups/triggers-events · https://github.com/modelcontextprotocol/experimental-ext-triggers-events · https://help.openai.com/en/articles/20001256-plugins-in-chatgpt · https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt
- **Verificare adversarială:** CONFIRMED — Confirmat din trei surse. Pagina developer: MCP 2.0 (2026-07-28), doar livrare webhook, Standard Webhooks, 256 KiB, callback HTTPS fără adrese private și fără redirecturi, stocare persistentă a abonamentelor. Charter-ul WG: 24.03.2026, lideri Clare Liguori (AWS) și Peter Alexander (Anthropic), SEP „Ideating”. Help: 30 rulări/oră și 720/zi. Documentația nu cere explicit un server public, dar sarcinile rulează în cloud, deci BLOCKED/REIMPLEMENT rămân justificate.

## knowledge

### Projects în ChatGPT (chaturi, fișiere, instrucțiuni, surse partajate) (`oa-chatgpt-projects`)

- **Sursă oficială:** https://help.openai.com/en/articles/10169521-projects-in-chatgpt
- **Documentație tehnică:** https://learn.chatgpt.com/docs/projects.md
- **Ce face:** Grupează chaturi, fișiere și instrucțiuni; surse din Google Drive și Slack; salvarea răspunsurilor ca surse; memorie de proiect; partajare de proiect. În desktop, proiectele locale sunt foldere cu AGENTS.md și config.toml.
- **Plan necesar:** Toți utilizatorii autentificați; partajarea pe Free, Go, Plus, Pro, Business, Enterprise, Edu
- **Platformă:** Web, mobil, desktop; CLI folosește directorul curent
- **Rollout:** GA
- **Eligibilitate cont:** Probabil disponibil; neverificat
- **Autentificare:** Cont ChatGPT
- **Allowance:** Numărul de fișiere depinde de plan
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul
- **Risc de facturare API:** none
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Proiectele cloud nu au API. Proiectele locale din desktop sunt foldere; ghidajul durabil stă în AGENTS.md (felia Codex).
- **Suprafață nativă:** New project în bara laterală
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Hub-ul generează pachete de context (Markdown) pentru un proiect ChatGPT, încărcate manual de proprietar.
- **Suprafață de execuție:** openai.chatgpt_chat
- **Echivalent la celălalt ecosistem:** Anthropic: Claude Projects (anthropic.claude_projects)
- **Ce face unic / mai bine:** Proiecte partajate ca „hub” de context viu pentru grup
- **Securitate:** Într-un proiect partajat, ștergerea unui fișier îl elimină pentru toți; datele încărcate stau în cloud.
- **Cale de implementare:** Export context pack din Hub → încărcare manuală
- **Test necesar:** n/a
- **Status:** DOCUMENTED
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Sarcinile programate create într-un proiect nu pot accesa fișierele proiectului.
- **Surse citite:** https://help.openai.com/en/articles/10169521-projects-in-chatgpt · https://learn.chatgpt.com/docs/projects.md
- **Verificare adversarială:** CORRECTED (corectat: programmaticIntegration (https://help.openai.com/en/articles/10169521-projects-in-chatgpt)) — Help 10169521 confirmă: planurile, sursele Google Drive/Slack, memoria de proiect, limitele de fișiere (Free 5, Go/Plus 25, Pro/Business/Enterprise/Edu 40) și faptul că sarcinile programate din proiect nu văd fișierele proiectului. Compliance API este doar pentru Enterprise. Am corectat doar enum-ul.

## research

### Deep research în ChatGPT (`oa-deep-research`)

- **Sursă oficială:** https://help.openai.com/en/articles/10500283-deep-research-in-chatgpt
- **Documentație tehnică:** n/a
- **Ce face:** Plan de cercetare editabil, cercetare pe web, site-uri alese, fișiere și aplicații conectate (doar acțiuni de citire), raport cu citări, cuprins și istoric; descărcare în Markdown, Word sau PDF.
- **Plan necesar:** Variază după plan și țară; inclus în Pro
- **Platformă:** ChatGPT web/desktop/mobil
- **Rollout:** GA
- **Eligibilitate cont:** Probabil disponibil pe Pro; contorul din produs arată sarcinile rămase
- **Autentificare:** Cont ChatGPT
- **Allowance:** Contor în produs; alocarea lunară se resetează la 30 de zile de la prima utilizare
- **Utilizare partajată:** Alocare separată de deep research
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul identificat
- **Risc de facturare API:** none
- **Integrare programatică:** NATIVE_INTERACTIVE
- **Detaliu integrare:** Niciun API cu autentificare de plan; varianta API este facturată separat (oa-deep-research-api).
- **Suprafață nativă:** /Deepresearch sau meniul de unelte
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Hub-ul pregătește brieful (întrebări, surse, constrângeri); proprietarul rulează cercetarea; Hub-ul importă raportul Markdown cu proveniență și citări.
- **Suprafață de execuție:** openai.chatgpt_deep_research
- **Echivalent la celălalt ecosistem:** Anthropic: Research (anthropic.claude_research) și skill-ul local deep-research
- **Ce face unic / mai bine:** Control explicit al surselor și plan revizuibil înainte de rulare
- **Securitate:** Aplicațiile conectate pot aduce date private în raport; raportul urmează retenția conversației.
- **Cale de implementare:** Șablon de brief + import manual al raportului descărcat
- **Test necesar:** Test de import Markdown local
- **Status:** ELIGIBILITY_UNKNOWN
- **Decizie Hub:** ASSISTED
- **Încredere:** high
- **Note:** Activitatea deep research apare în Conversation/Compliance API doar pentru Enterprise.
- **Surse citite:** https://help.openai.com/en/articles/10500283-deep-research-in-chatgpt · https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers
- **Verificare adversarială:** CORRECTED (corectat: programmaticIntegration (https://help.openai.com/en/articles/10500283-deep-research-in-chatgpt)) — Help 10500283 confirmă: /Deepresearch, plan de cercetare editabil, doar acțiuni de citire în aplicații, rapoarte descărcabile în Markdown/Word/PDF, contor în produs cu resetare la 30 de zile și disponibilitate dependentă de plan și țară. Pro include deep research (help 9793128). Am corectat doar enum-ul.

### Deep research prin API (Responses API, background mode) (`oa-deep-research-api`)

- **Sursă oficială:** https://developers.openai.com/api/docs/guides/deep-research
- **Documentație tehnică:** https://developers.openai.com/api/docs/guides/deep-research
- **Ce face:** Cercetare în Responses API cu background mode și cel puțin o sursă (web search, MCP remote, file search); modelele o3-deep-research și o4-mini-deep-research au oprire la 23.07.2026, înlocuite de gpt-5.6-sol.
- **Plan necesar:** Cont API
- **Platformă:** API
- **Rollout:** GA (modele vechi retrase)
- **Eligibilitate cont:** Nu există cont API
- **Autentificare:** Cheie API
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Tokeni și unelte la prețuri API
- **Risc de facturare API:** high
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Ruta SIWC nu suportă background mode, file search, MCP găzduit sau code interpreter. Suportă web search (după model și politică) cu stream=true, deci doar o cercetare simplificată ar fi tehnic posibilă, iar eligibilitatea Hub-ului pentru SIWC este neclară. Modelele o3-deep-research și o4-mini-deep-research sunt oprite din 23.07.2026. Background mode este recomandat, nu obligatoriu, și păstrează datele circa 10 minute.
- **Suprafață nativă:** n/a
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Niciunul
- **Suprafață de execuție:** openai.responses_api
- **Echivalent la celălalt ecosistem:** Anthropic: API de cercetare neverificat
- **Ce face unic / mai bine:** Automatizabil
- **Securitate:** Background mode păstrează datele circa 10 minute (incompatibil ZDR).
- **Cale de implementare:** Niciuna
- **Test necesar:** BillingPolicy trebuie să refuze ruta
- **Status:** BLOCKED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** Folosește oa-deep-research (ASSISTED).
- **Surse citite:** https://developers.openai.com/api/docs/guides/deep-research · https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://developers.openai.com/api/docs/guides/deep-research.md; https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)) — BLOCKED/REJECT rămân corecte pentru ruta cu cheie API; înlocuitorul indicat al modelelor oprite este gpt-5.6-sol.

### Căutarea web în Codex (web_search: disabled \| cached \| indexed \| live) (`oa-gap-codex-web-search`)

- **Sursă oficială:** https://learn.chatgpt.com/docs/web-search
- **Documentație tehnică:** https://learn.chatgpt.com/docs/config-file/config-reference.md (web_search, tools.web_search, allowed_web_search_modes) ; https://learn.chatgpt.com/docs/hooks.md
- **Ce face:** Unealtă găzduită first-party. Pentru firele locale, modul implicit este cached (index întreținut de OpenAI, fără acces extern la pagini), ceea ce reduce, dar nu elimină riscul de prompt injection; live aduce rezultate la zi (flagul --search sau web_search = "live"); indexed permite acces extern doar când indexul aprobă; în full access modul implicit devine live; disabled elimină unealta. tools.web_search acceptă context_size, allowed_domains și location. Fiind unealtă găzduită, nu trece prin hook-urile locale PreToolUse/PostToolUse și nici prin proxy-ul de rețea al sandbox-ului, deci rămâne disponibilă și când rețeaua comenzilor este oprită. Căutările apar ca item webSearch {id, query, action: search \| openPage \| findInPage}. Documentația cere tratarea rezultatelor ca input neîncrezător.
- **Plan necesar:** Toate planurile cu Codex
- **Platformă:** Codex CLI, app-server, desktop, IDE
- **Rollout:** GA; căutarea standalone pentru provideri custom este under development.
- **Eligibilitate cont:** Implicit activă (cached) în firele Codex, inclusiv în cele ale Hub-ului, dacă nu este dezactivată.
- **Autentificare:** ChatGPT OAuth
- **Allowance:** Documentația de pricing nu listează un tarif separat pentru căutare; rezultatele adaugă context și consum.
- **Utilizare partajată:** Alocarea comună Codex/Work.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Consum suplimentar de context; credite după limite.
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Per proces copil: codex app-server -c web_search="disabled" (implicit în Hub); pentru o misiune aprobată, proces separat cu -c web_search="cached" și opțional -c 'tools.web_search={allowed_domains=[...]}'; live doar cu aprobare explicită. Parametrul config din thread/start există în schemă, dar suportul pentru web_search nu este documentat. Global: allowed_web_search_modes în requirements.toml.
- **Suprafață nativă:** Transcriptul desktop/CLI arată căutările.
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Politică explicită: căutare dezactivată implicit, permisă per misiune (cached sau live) cu aprobare Hub, fiecare item webSearch intră în audit.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** Uneltele WebSearch/WebFetch din Claude Code, controlate prin --tools și reguli de permisiune (an-cc-file-tools, an-cc-permission-rules)
- **Ce face unic / mai bine:** Modul cached oferă informație fără acces live la pagini arbitrare; filtre de domeniu.
- **Securitate:** Context neîncrezător (prompt injection); ocolește hook-urile și proxy-ul de rețea; poate scurge interogări cu date interne către serviciul de căutare.
- **Cale de implementare:** 1) -c web_search="disabled" în lansarea standard. 2) Câmp de misiune search_mode cu aprobare. 3) Audit al itemelor webSearch. 4) Test la fiecare versiune nouă a binarului.
- **Test necesar:** Fără model: config/read sau experimentalFeature/list pentru confirmarea valorii efective; LIVE_VALIDATION aprobat pentru confirmarea absenței itemelor webSearch.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Contradicție potențială: adaptorul V2 nu menționează setarea web_search, deci firele Hub ar rula acum cu căutare cached activă implicit.
- **Surse citite:** https://learn.chatgpt.com/docs/web-search.md · https://learn.chatgpt.com/docs/config-file/config-reference.md · https://learn.chatgpt.com/docs/hooks.md · https://learn.chatgpt.com/docs/enterprise/managed-configuration.md · https://learn.chatgpt.com/docs/app-server (item webSearch) · local: codex --help (--search)
- **Verificare adversarială:** CONFIRMED — web-search.md și config reference confirmă: web_search = disabled \| cached \| indexed \| live, implicit cached, live implicit în full access (--yolo), --search pentru live și tools.web_search cu context_size, allowed_domains și location. Căutarea este unealtă găzduită, separată de proxy-ul de rețea al sandbox-ului, și rămâne disponibilă când rețeaua comenzilor e oprită. Tabelul din hooks.md arată că uneltele găzduite (WebSearch) nu trec prin hook-urile locale. allowed_web_search_modes este documentat în requirements. App-server documentează itemul webSearch {id, query, action} cu acțiunile search, openPage și findInPage. Căutarea standalone pentru provideri custom este încă under development.

## Întrebări deschise

- Care este planul real al contului în V2? Este nevoie de un account/read read-only pe CODEX_HOME real (fără turn) pentru a confirma planType (V1: prolite).
- Maparea prolite → Pro 100, pro → Pro 200, promax → Pro 500 este dedusă din numele afișate în Codex (commit #47971) și din articolul Pro tiers. Nu există documentație oficială care să lege ID-urile de prețuri.
- Are contul sold de credite sau automatic reload activ? Documentația spune că, după epuizarea alocării, consumul trece automat pe soldul existent. Starea se vede doar în Settings → Usage / Usage & Billing; app-server expune soldul, dar nu setarea de reload.
- Există un comutator oficial care să împiedice Codex să folosească un sold de credite existent după atingerea limitelor, în afară de a ține soldul la zero? Nu am găsit unul în paginile citite.
- Când un turn activ atinge limita și continuă „sub fair use”, consumul trage din credite dacă soldul este pozitiv? Nu este documentat.
- Codex local 0.158.0-alpha.2.1 expune câmpurile citite din sursa main (serviceTiers, serviceTierForTurn, ordinaryUsageAllowed, rateLimitResetCredits, planType promax)? Se verifică cu schema binarului local; generarea schemei scrie fișiere, deci cere aprobare.
- Ce ID are service tier-ul Ultrafast în model/list pentru Codex pe Pro 500? Nu a fost verificat; în API valoarea este ultrafast.
- Documentația API Ultrafast menționează preview pentru GPT-5.6 Sol, în timp ce DevDay și documentația Codex spun că Ultrafast pentru GPT-6.1 Sol vine mai târziu. Care formulare este actuală?
- Ce este experimentul Luna Reserve (supportsLunaReserve)? Poate schimba automat modelul pe GPT-6 Luna după blocarea uzajului obișnuit și nu este documentat public.
- Valorile numerice ale alocărilor Pro 100/200/500 și ale limitelor săptămânale nu sunt publicate. Documentația spune doar că Pro nu are, în prezent, limită de 5 ore.
- Proprietarul se află în SEE (România)? Dacă da, dots nu sunt disponibile pe planurile Pro, iar Sites nu este disponibil în SEE.
- Politica V2 billing.mjs nu conține promax și acceptă enterprise_cbp_automation, care este probabil bazat pe credite. Trebuie decis explicit ce tipuri de plan sunt INCLUDED_SUBSCRIPTION_ONLY.
- Business Premium nu are preț sau pagină de plan găsită. Decisions API și Private Inference nu au documentație tehnică publică.
- GPT-6.1 Sol, GPT-6 Sol și GPT-6 Luna nu sunt încă disponibile în Chat. Nu există dată anunțată.
- Ce planType raportează account/read pentru contul proprietarului? Valoarea istorică prolite există în enum-ul open-source, dar maparea la Pro 100/200/500 USD nu a putut fi confirmată (help.openai.com 403).
- Codex Security Cloud: recapul DevDay spune toți utilizatorii Codex, tabelul pricing îl bifează doar pentru Enterprise/Edu, iar What's new îl limitează la workspace-uri cu acces. Care este eligibilitatea reală pentru acest cont?
- Firele create în ChatGPT desktop apar în thread/list pe CODEX_HOME implicit? Desktopul folosește pe Windows același daemon partajat ca TUI-ul?
- Skill-urile pluginurilor bundled (documents, spreadsheets, presentations, pdf, computer-use) sunt vizibile și utilizabile în firele unui app-server pornit de Hub, în afara runtime-ului desktop?
- Proprietarul are credite ChatGPT cumpărate care s-ar consuma automat după limită? account/rateLimits/read arată resetări câștigate, dar documentația citită nu arată un câmp explicit pentru soldul de credite.
- Code Review usage prin GitHub este un bucket separat de limitele generale sau doar o categorie de raportare? (rateLimitsByLimitId ar putea arăta bucket-uri distincte.)
- Numele exact al parametrului app-server pentru nivelul Fast/serviceTier și cum se forțează dezactivarea lui pentru firele Hub când proprietarul l-a persistat.
- Cât consumă generarea de memories și reviewerul auto-review din alocarea planului? Paginile citite nu cuantifică.
- Tariful de voce (echivalent 0,05 USD/minut din buget) se aplică identic vocii din CLI?
- codex agents și codex queue lipsesc din referința publică CLI: sunt considerate stabile sau interne/experimentale?
- Pluginul local Codex Security cere acces beta ca Security CLI sau este disponibil tuturor planurilor?
- Care este exact planul ChatGPT al contului? V1 a raportat „prolite” (posibil Pro 100); trebuie confirmat în V2 prin account/read, fără inferență.
- În ce țară este înregistrat contul ChatGPT? Dacă este România (SEE), dots nu este disponibil pe planurile Pro 100/200/500; poate influența și computer use („supported regions”).
- Sunt dezactivate în ChatGPT Settings > Usage opțiunea „allow apps to use credits” și cumpărarea automată de credite, iar soldul de credite este zero? Altfel, utilizarea Work/Codex poate continua din credite după epuizarea planului.
- Este developer mode (conectori MCP personalizați) disponibil acum pentru un cont Pro personal? Help Center îl descrie doar pentru Business/Enterprise/Edu, iar developers.openai.com îl plasează în setările contului.
- Funcționează plugin extensions (sidebar, panouri, file viewers) cu aplicații MCP locale în ChatGPT Desktop sau cer server remote?
- Folosește Work local din ChatGPT Desktop serverele MCP locale sau pluginurile cu aplicații MCP locale? learn/extend/mcp și help 20001256 par să se contrazică.
- Collaborative Slides: recap-ul le prezintă ca disponibile, iar Help Center spune că Slides și Sheets vin „în curând”. Care este starea reală?
- Decisions API: nu am găsit documentație publică. Care sunt endpointul, autentificarea și prețul?
- Poate o aplicație privată, closed-source și locală, cu un singur utilizator, să folosească înregistrarea dinamică SIWC pentru plan usage, sau este nevoie de aprobare prin formularul de interes?
- Secure MCP Tunnel: are cost propriu și este disponibil pentru un cont ChatGPT personal în developer mode?
- MCP Events: ce parte din MCP 2.0 (protocol 2026-07-28) este finală și ce parte rămâne extensie experimentală? Când vor exista SDK-uri de referință?
- Când va fi disponibil pluginul Meetings/Record pe Windows?
- Team tasks și Workspace Agents: consumul se facturează din credite de workspace? Sursele citite nu precizează asta pentru rulările prin API.
- Acoperire: niciunul dintre cele 22 de itemi nu era complet acoperit de inventar. Suprapuneri parțiale: itemul 5 cu oa-model-daybreak-cyber (model/rerouted) și oa-luna-reserve-fallback; itemul 13 cu oa-codex-cloud-environments, oa-codex-cloud-integrations și oa-codex-review-github-auto; itemul 17 cu oa-plugins-directory-install, oa-teams-team-tasks și oa-chatgpt-slack-teams; itemul 22 (unealta Plugins) extinde oa-agents-api. Itemii 2 și 3 au fost reorganizați: requirements.toml de sistem este în oa-gap-codex-requirements-toml, iar forced_login_method per proces este în oa-gap-codex-auth-precedence-env.
- Contradicție cu V2: bundle-ul Codex local raportează acum codex-cli 0.159.0 (actualizat pe 2026-09-30 la 03:01), nu 0.158. Allowlist-ul JSON-RPC și handshake-ul trebuie revalidate pe schema 0.159, iar adaptorul ar trebui să verifice versiunea binarului înainte de fiecare lansare.
- Contradicție cu V2: handshake-ul a folosit un CODEX_HOME gol, dar skill-urile din $HOME/.agents/skills (14 intrări) sunt descoperite pe baza HOME, nu a CODEX_HOME. În plus, cu secret_auth_storage activ, nu este clar dacă un CODEX_HOME gol mai vede loginul ChatGPT. Trebuie decis dacă firele reale folosesc CODEX_HOME-ul proprietarului sau unul dedicat, cu login separat făcut de proprietar.
- Contradicție probabilă cu V2: dacă adaptorul nu setează explicit web_search, image_generation, apps și skill_mcp_dependency_install, firele Hub rulează acum cu căutare web cached, generare de imagini, apps apelabile și instalare de dependențe MCP pentru skills activate implicit (flaguri true în 0.159). Propunere: -c web_search="disabled" --disable image_generation --disable apps --disable skill_mcp_dependency_install în lansarea standard.
- Contradicție potențială cu V2: V2 respinge auto-review, dar approvalsReviewer nu este fixat explicit. Dacă config.toml-ul proprietarului setează approvals_reviewer = auto_review, firele Hub l-ar moșteni. Propunere: approvalsReviewer: "user" în fiecare thread/start și verificarea în ThreadStartResponse.
- Neverificat: este onorată cheia forced_login_method prin codex app-server -c? Acceptă parametrul config din thread/start (prezent în schemă, nedocumentat) chei precum web_search, features.* sau skills.config? Necesită test fără model într-un CODEX_HOME izolat.
- Neverificat: semantica exactă a thread/start.allowProviderModelFallback (experimental, nedocumentat) și dacă modelul ascuns codex-auto-review, precum și modelele interne pentru memorii și subagenți, consumă din alocarea inclusă.
- Politica app-server: rămâne de clarificat dacă un instrument intern al unei firme (Ifrim Digital), rulat local pentru un singur proprietar, intră sub interdicția pentru servicii comerciale. Formularea despre continuarea utilizării pare să vizeze aplicații existente. Terms of Use nu au fost citite. Dacă Hub-ul devine multi-utilizator, ruta Codex trebuie reevaluată.
- requirements.toml: este necesar drept de administrator pentru crearea %ProgramData%\OpenAI\Codex? Ce ACL are directorul după creare? Un fișier scris de alt proces local ar putea impune politici.
- codex doctor și codex debug prompt-input: descrierea din PR spune că doctor nu pornește daemonul sau serverele MCP; pentru prompt-input documentația nu spune nimic. Ambele necesită o primă rulare aprobată, cu monitorizarea proceselor și a rețelei.
- Modele Pro: help center nu menționează explicit Pro 500 pentru GPT-6 Pro; pagina de prețuri (ro-RO) arată GPT-5.6 Sol Pro și pentru Plus (Extins), contrar tabelului din help. Nivelul real al contului (planType prolite, posibil Pro $100) rămâne neverificat în V2.
- Custom GPTs: pagina de prețuri afișează încă crearea de GPT-uri pentru Go, Plus și Pro, în timp ce help center (actualizat pe 2026-09-29) spune că nu mai este disponibilă pe conturile personale.
- OSS local: Ollama este instalat; nu s-a verificat dacă app-server cere login pentru modelProvider ollama și nici dacă modelele Ollama disponibile sunt strict locale, fără variante găzduite în cloud.
- Transparență: în această cercetare s-a rulat codex debug models --bundled (offline) și ieșirea a fost scrisă temporar într-un fișier din scratchpad, șters imediat. Alte comenzi rulate: doar --help, --version și codex features list, fără inferență și fără citirea fișierelor de autentificare.

## Surse inaccesibile

- https://openai.com/index/gpt-6-astra/ – WebFetch 403; în browserul integrat (panou ascuns) pagina s-a blocat, conținutul nu a fost citit
- https://openai.com/index/devday-2026-recap/ – linkurile per anunț nu au putut fi extrase în această sesiune (pagina s-a blocat); s-au folosit notele capturate anterior în scratchpad/sources-openai-devday.md și ancorele de secțiune verificate
- https://chatgpt.com/pricing – WebFetch 403; textul citit în browserul integrat nu conținea prețurile randate
- https://help.openai.com/* – WebFetch 403; articolele 9793128, 12642688, 20001542 și 11369540 au fost citite prin browserul integrat
- https://help.openai.com/en/articles/11481834 (rate card), https://help.openai.com/en/articles/20001155 (credite Business), https://help.openai.com/en/articles/20001001 (Enterprise overages) – necitite
- https://learn.chatgpt.com/docs/changelog.md – 404; versiunea HTML a fost citită doar prin rezumatul WebFetch (intrări 0.158/0.159 și GPT-6.1 Sol)
- https://openai.com/index/previewing-ultrafast/ – necitit
- https://aws.amazon.com/bedrock/managed-agents-openai/ – necitit
- Decisions API și Private Inference – nicio pagină tehnică publică găsită în developers.openai.com (llms.txt și llms-full.txt)
- https://openaiassets.blob.core.windows.net/.../psp-whitepaper.pdf – necitit
- https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers (HTTP 403 la curl și WebFetch)
- https://help.openai.com/en/articles/11369540-codex-in-chatgpt (HTTP 403)
- openai.com/index/* (HTTP 403 la fetch automat; folosite notițele capturate în sources-openai-devday.md)
- https://developers.openai.com/codex redirecționează 308 către https://learn.chatgpt.com/docs (accesibil; nu este o sursă indisponibilă)
- https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md este accesibil, dar conține doar note de schimbări recente, nu specificația completă a protocolului
- help.openai.com prin WebFetch: HTTP 403 (paginile au fost citite prin panoul de browser integrat)
- openai.com (HTTP 403 la fetch automat): am folosit captura locală sources-openai-devday.md
- https://developers.openai.com/siwc/preview-limitations: HTTP 404
- https://developers.openai.com/api/docs/guides/agents-api: HTTP 404 (am citit overview.md)
- https://developers.openai.com/api/docs/guides/decisions și https://developers.openai.com/api/docs/guides/decisions-api: HTTP 404; Decisions API lipsește din developers.openai.com/api/docs/llms.txt
- https://help.openai.com/en/articles/6825453-chatgpt-release-notes: timeout în browser (pagină prea mare)
- Nu există o pagină oficială dedicată pentru „Dynamic Pages” sau „Collaborative Slides”; am folosit recap-ul și documentația Space
- https://learn.chatgpt.com/docs/enterprise/compliance-api.md și analytics-api.md: necitite în detaliu
- https://openai.com/form/sign-in-with-chatgpt-interest/: formular, necitit
- https://openai.com/index/gpt-6-astra/ (openai.com răspunde cu 403 la fetch automat; nu a fost citită, disponibilitatea GPT-6 Pro provine din help 20001354)
- https://developers.openai.com/api/docs/models/gpt-rosalind-research.md și .../gpt-rosalind.md (404); nu am găsit o pagină dedicată modelului
- Documentație oficială pentru thread/start.allowProviderModelFallback și pentru parametrul config din thread/start: inexistentă pe learn.chatgpt.com (doar în binar și în schemă)
- Documentație oficială pentru flagul skip_host_skill_discovery: inexistentă (doar în codex features list, under development)
