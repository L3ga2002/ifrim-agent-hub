# Politica de abonamente și facturare (V2)

Implementare: `v2/server/policy/billing.mjs` (reguli), `v2/server/policy/gate.mjs` (aplicare), `v2/server/providers/*` (verificări la runtime).

## BillingPolicy (concept intern Hub, nu o setare a providerilor)

```
mode: included_subscription_only
paid_api_inference: deny
purchased_credits_consumption: deny
automatic_topups: deny
paid_fallback: deny
new_paid_services: deny
automatic_plan_upgrade: deny
```

## Ce verifică Hub-ul, separat

| Verificare | Codex | Claude Code |
|---|---|---|
| Instalare | `codex.exe --version` (bundle Codex desktop 0.158.0-alpha.2.1) | binar npm real 2.1.175 |
| Identitate / metodă | `account/read`: `type` trebuie să fie `chatgpt`; `apiKey` → refuzat (facturare API) | `claude auth status --json`: `authMethod=claude.ai`, `apiProvider=firstParty` |
| Plan | `planType` raportat; `prolite` (Pro 100) și `promax` (Pro 500) sunt planuri incluse; planurile pe credite/consum (`self_serve_business_usage_based`, `enterprise_cbp_usage_based`, `enterprise_cbp_automation`) sunt refuzate; un tip nou rămâne neverificat | `subscriptionType` ∈ pro/max/team/enterprise |
| Configurație | `~/.codex/config.toml`: fără `model_provider` personalizat, fără preferință API key | settings utilizator/proiect: fără `apiKeyHelper`, fără variabile de facturare în `env` (nume comparate fără diferență de majuscule) |
| Credite (Milestone 01) | `creditsReported` din `account/rateLimits/read`: sold > 0 sau credite nelimitate → **refuzat** (după epuizarea alocării, Codex/Work consumă automat soldul existent; nu există comutator); sold neraportat → neverificat, afișat | nu se poate citi din CLI; usage credits sunt confirmate prin atestare |
| Setare cost la provider | nu poate fi citită → confirmarea ta, valabilă 30 de zile | nu poate fi citită → confirmarea ta, valabilă 30 de zile |
| Allowance | `account/rateLimits/read` înainte de turn + `account/rateLimits/updated` în timpul turnului | necunoscut; `system/api_retry` cu `billing_error` oprește imediat execuția |
| Evenimentul `init` (ultima verificare înainte de model) | — | `apiKeySource` diferit de `none` sau un model Fable rezolvat → procesul este oprit înainte de orice apel de model (`preInference: true`, categoria `billing`) |

Orice verificare `failed` sau `unverified` (în afară de allowance și de soldul de credite neraportat, care pot fi necunoscute înainte de primul turn) blochează ruta. Ce este necunoscut rămâne necunoscut. Un sold `null` este necunoscut, nu 0.

## Textul atestărilor (ce verifici tu, la provider)

Textele descriu controalele care există efectiv (auditul Milestone 01):

- **Codex:** „Am verificat în ChatGPT Settings → Usage că soldul de credite este 0 și că reîncărcarea automată (automatic reload) este oprită.” Nu există un comutator care să oprească consumul unui sold existent; singurul control real este sold 0 + reîncărcare automată oprită.
- **Claude:** „Am verificat în claude.ai Settings → Usage că usage credits (fostul extra usage) sunt dezactivate și că auto-reload este oprit.”

Hub-ul nu înregistrează niciodată o atestare în numele tău. Constatare 2026-09-30 (conector claude.ai, doar citire): plan Max, usage credits dezactivate. Atestarea formală rămâne a ta.

## Claude Code în `-p`: protecții adăugate în Milestone 01

- **Fable refuzat.** Aliasurile `fable`/`best` și orice `claude-fable-*` sunt refuzate înainte de pornirea procesului (`CLAUDE_REFUSED_MODELS`). Motiv: Fable folosește o alocare săptămânală separată, iar în `-p` o cerere care ar factura usage credits este facturată fără dialog de confirmare. Politica de modele a proiectului („Fable doar pentru investigațiile cele mai grele”) rămâne valabilă pentru sesiunile interactive pe care le pornești tu, nu pentru execuțiile Hub.
- **`--setting-sources user`.** În `-p` nu apare dialogul de încredere, deci un `.claude/settings.json` din repository ar putea seta `env`/`apiKeyHelper` și ar muta sesiunea pe facturare API. Hub-ul încarcă doar setările utilizatorului (inspectate de adaptor). Consecință: `fallbackModel` sau alte setări de proiect nu se aplică execuțiilor Hub.
- **Gărzi de mediu pentru orice proces Claude Code pornit de Hub** (`CLAUDE_GUARD_ENV`, folosit la `-p`, `auth status`, `--version`, `agents --json`; nume verificate în referința oficială de variabile):
  - `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1`: unealta advisor poate apela Fable.
  - `CLAUDE_CODE_DISABLE_FAST_MODE=1`: pe abonamente, fast mode se plătește doar din usage credits, chiar dacă planul mai are cotă (`an-cc-fast-mode`).
  - `CLAUDE_CODE_DISABLE_1M_CONTEXT=1`: variantele `[1m]` pot factura credite.
  - `CLAUDE_CODE_DISABLE_WORKFLOWS=1`: workflow-urile multi-agent multiplică consumul.
  - `DISABLE_EXTRA_USAGE_COMMAND`, `DISABLE_UPGRADE_COMMAND`, `DISABLE_LOGIN_COMMAND`, `DISABLE_LOGOUT_COMMAND`.
  - `DISABLE_AUTOUPDATER=1`: o execuție Hub nu actualizează CLI-ul global.
  - `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`: memoria Hub este canonică; auto memory rămâne a sesiunilor tale.
  - `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`: nimic nu supraviețuiește execuției Hub care deține taskul.
  - `CLAUDE_CODE_DISABLE_CRON=1`: programările native le creezi tu.

  O versiune mai veche ignoră numele necunoscute. Nimic nu se scrie în setările tale. În plus, `-p` primește `--no-chrome` (flag prezent în 2.1.175): Claude in Chrome nu acționează niciodată din Hub.
- **Neadoptat încă:** `--settings` cu `availableModels`/`disableAllHooks` și `--restricted` (≥ 2.1.248). Suportul pe 2.1.175 nu este verificat; se reevaluează după actualizarea aprobată a CLI-ului.
- **Variantele `[1m]` refuzate.** Pe CLI-ul local 2.1.175, aliasul `sonnet` = Sonnet 4.6, iar `sonnet[1m]` facturează usage credits pe Max. Orice model cu sufixul `[1m]` este refuzat înainte de proces sau la `init`. Opus 5.5 cere Claude Code ≥ 2.1.280 și Sonnet 5.5 ≥ 2.1.284; actualizarea CLI-ului global este decizia ta.

## Codex: override-uri per proces (Milestone 01)

Fiecare `app-server` pornit de Hub primește `CODEX_APP_SERVER_OVERRIDES`. Funcțiile sunt stable și active implicit pe 0.159.0 (`codex features list`). Override-urile au fost verificate pe binarul real, cu handshake `initialize` și `CODEX_HOME` gol. `config.toml` nu este modificat.

| Override | Motiv |
|---|---|
| `-c features.fast_mode=false` | o selecție Fast salvată (`service_tier = "fast"`) consumă alocarea de ~2,5 ori mai repede; Ultrafast cere Pro 500. Inspecția raportează informativ `fastTierPersisted` |
| `-c features.image_generation=false` | generarea de imagini consumă de 3–5 ori mai repede, apoi credite |
| `-c features.skill_mcp_dependency_install=false` | poate instala pachete pentru skill-uri (instalările cer aprobare) |
| `-c features.apps=false` | conectorii ChatGPT pot acționa pe conturi externe (`connector.write` = ALWAYS_ASK) |
| `-c features.computer_use=false`, `browser_use`, `browser_use_external`, `browser_use_full_cdp_access`, `in_app_browser` (toate `=false`) | controlul vizual și browserul aparțin computer runtime-ului Hub (`computer.visual_control`, `browser.native` = ALWAYS_ASK, blocate) |
| `-c features.memories=false` | memoria Hub este canonică; memoriile Codex rămân ale tale |
| `-c features.multi_agent=false` | subagenții multiplică consumul peste plafonul de concurență Hub |
| `-c web_search="disabled"` | căutarea web este o unealtă găzduită care ocolește setarea de rețea a sandbox-ului; o misiune o va putea activa doar cu aprobare (PLANNED) |

În plus, pe `thread/start` și `turn/start` Hub-ul trimite `approvalsReviewer: "user"`, ca aprobările să vină la Hub, nu la un subagent `auto_review` ales în configurația ta. Dacă firul raportează alt reviewer sau un alt model decât cel cerut, rularea se oprește înainte de turn (`policy`, `preInference`).

**Neadoptat:** `-c forced_login_method="chatgpt"`. Conform documentației, la nepotrivire Codex face logout și iese, ceea ce ar fi o schimbare a autentificării tale. Hub-ul refuză în schimb conturile non-ChatGPT prin `account/read`. `requirements.toml` (`allowed_login_methods = ["chatgpt"]`) este o gardă globală, pe care o poți instala tu în `%ProgramData%\OpenAI\Codex\`; Hub-ul nu o scrie.

**Conformitate:** autentificarea prin app-server este permisă pentru aplicații locale, nu pentru servicii comerciale sau găzduite oferite altora (learn.chatgpt.com/docs/app-server). Hub-ul rămâne local (127.0.0.1), pentru un singur proprietar și contul lui.
- **`apiKeySource` din `init`** este verificat, dar este o condiție necesară, nu suficientă: absența unei chei API sau OAuth nu dovedesc singure folosirea abonamentului; de aceea rămân verificările de identitate, plan, configurație și atestarea.

## Mediul proceselor copil

Doar variabile din allowlist (`SystemRoot`, `PATH`, `USERPROFILE`, `APPDATA`, `TEMP`, …). Pe Windows numele variabilelor nu țin cont de majuscule: `buildChildEnv` refuză orice extra al cărui nume, comparat fără majuscule, este riscant (`openai_api_key` = `OPENAI_API_KEY`). Sunt eliminate mereu: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `CODEX_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_PROFILE`, variabilele de federație, `CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY`, `CLAUDE_CODE_OAUTH_TOKEN`, proxy-urile, `NODE_OPTIONS`. Verificarea autentificării rulează cu exact același mediu ca execuțiile.

Constatare 2026-09-29: procesul Hub pornit din sesiunea Claude avea `ANTHROPIC_BASE_URL` în mediu (moștenit din sesiune). Numele este raportat în UI, valoarea nu este citită, iar variabila nu ajunge la niciun provider.

## Plafon și rezervă

`usageReservePercent` (implicit 20%): Hub-ul nu pornește și întrerupe un turn Codex când orice fereastră raportată atinge `100 - rezervă`. Dacă providerul raportează `ordinaryUsageAllowed=false`, `rateLimitReachedType` sau `spendControlReached`, turnul nu pornește. La cotă: checkpoint → task `WAITING_PROVIDER`; nu se trece automat pe alt provider.

## Metode Codex blocate în client

Tot ce nu este în allowlist, inclusiv `account/rateLimitResetCredit/consume`, `account/sendAddCreditsNudgeEmail`, `account/login/*`, `account/logout`, `config/value/write`, `config/batchWrite`, `plugin/install`, `marketplace/*`, `thread/delete`, `feedback/upload`.

## Flaguri Claude interzise

`--bare` (nu folosește abonamentul), `--fallback-model`, `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, `--max-budget-usd`. Modelele `fable`/`best` (vezi mai sus).

## Suprafețe refuzate din motive de facturare (auditul Milestone 01)

Agents API, Decisions API, Claude Agent SDK (cere API key; OAuth claude.ai este permis doar binarului oficial), Console/API Anthropic, Bedrock/Vertex/Foundry, cumpărarea de credite, auto-reload, upgrade de plan. Un SDK sau un framework (Paperclip, Hermes, Agent Zero, OpenClaw) nu primește niciodată chei plătite de la Hub.

## Risc rezidual (nu se promite cost zero)

- Dacă o limită este depășită în timpul unui turn Codex și contul are un sold de credite, providerul consumă creditele automat. Hub-ul refuză ruta când soldul raportat este > 0, dar soldul poate să nu fie raportat; atestarea (sold 0, auto-reload oprit) și plafonul Hub reduc riscul, fără să îl elimine.
- Pentru Claude Code, setarea usage credits de pe claude.ai nu poate fi citită din CLI.
- `total_cost_usd` din Claude este o estimare client, nu o sumă facturată.

## Uz

Hub-ul este pentru uzul tău personal/profesional autorizat, cu propriile conturi, nu pentru revânzarea abonamentelor sau găzduirea altor utilizatori.
