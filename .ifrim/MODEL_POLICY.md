# Active Model Policy - Ifrim Agent Hub

## Current override - 2026-09-28

Final safety state: controlled Gateway STOPPED and subscription gate SUSPENDED. Actual logs exposed ambient setup-inference probes on the historical OpenAI API route (403), outside pinned Hub execution. No verified native Hub result exists after three session-create failures. The subscription-only policy is not operationally proven for ambient Gateway activity; independently audit that path before restart. Stored credentials/history are preserved. OAuth login was cancelled and billing outcome is unverified.

Catalin approved global OpenClaw integration and native Claude subscription use for Hub conversations. The official global patch is applied: 6 role defaults Luna/max, 13 Sol/high, 4 Astra/xhigh; fallback lists are empty. Directory columns show role defaults; routine task routing remains Luna/max with risk-based model and adaptive effort. Sol/Astra max/ultra still need an explicit task request. All 23 role identities are configured, but this is not proof that every provider/model has completed a live turn.

OpenClaw is 2026.9.6. Conversation execution uses OpenClaw sessions, strict local-subscription auth, verified process/config/source fingerprints and Hub-only scope. Claude native auth/preflight passed; live turn acceptance remains pending. OpenAI OAuth reauthentication is required after 401. Packet routing remains OpenAI-only; Claude is explicit in conversations, not automatic across all agents. No API billing or provider fallback is approved. Controlled Gateway cron is disabled in its process environment; existing schedules are preserved. Restart invalidates certification. Older runtime/default/Claude-disabled statements below are historical, except the packet-route restrictions.

## Addendum - 2026-09-27

Catalin approved a separate unified-conversation Codex + Claude Code runtime for this Hub. The OpenAI-only rules below still govern the existing OpenClaw agent packets and their validation tests; they do not prohibit Claude in the newly approved conversation runtime. Do not change global OpenClaw defaults or add Anthropic API billing. Provider execution remains confirmation-, backup- and lease-gated.

Updated: 2026-09-27. User-approved scope: this Hub only, OpenAI only.

## Routing

- Source of truth: `apps/api/src/model-policy.mjs`, policy `gpt6-openai-adaptive-v3`.
- Routine implementation, review and QA: `openai/gpt-6-luna`, reasoning `max`.
- Complex tasks normally use `openai/gpt-6-sol` with `high`; demanding critical/security/architecture/migration work normally uses `openai/gpt-6-astra` with `xhigh`.
- Model choice and reasoning effort are separate decisions. Sol/Astra use the full adaptive scale: `low` for routine work, `medium` for moderate/bounded validation or local fixes, `high` for complex work, and `xhigh` for demanding risk. Selecting a stronger model does not itself raise reasoning. High priority alone does not require high reasoning. Explicitly simple specialist work can use low; complex or destructive operations retain higher effort.
- Every role defaults to Luna Max for routine tasks. Escalation depends on task risk, not the agent's name or compiler actor metadata.
- Sol/Astra `max` or `ultra` require an explicit standalone task directive, e.g. `Reasoning: max` or `Rationament: ultra`, in the title/goal. A bare word in prose or compiler-generated metadata does not authorize extra effort. `Model: gpt-6-astra` is an independent optional model directive.
- Explicit Ultra is supported only for Sol/Astra in the Codex runtime. Luna stays at Max and records the limit; effort alone does not escalate its model. All 23 directory rows show the routine Luna/max default, not a fixed effort for every task.
- No automatic model/provider fallback. No claim that Max has low usage; actual usage must be observed.
- Claude diagnostics, generated Claude commands and the local Claude review wrapper are disabled. Historical reports/scripts are preserved.

## Boundaries

- The central agent registry still supplies the 23 role identities. Its GPT-5.6 model settings and July probes are historical, not the active Hub routing policy.
- Global OpenClaw settings and other project files were not changed. Hub invocations pass explicit model/reasoning for owner, reviewer, QA and Prompt Architect.
- Keep the existing OpenAI OAuth + Codex harness route. Do not introduce API-key billing or switch harnesses implicitly.
- Old packets require a new packet and approval. A policy/provider/model/effort mismatch fails closed.
- Runner and compiler validate reported provider, model, Codex harness, reasoning and fallback evidence before accepting a result.
- Approval and explicit launch confirmation are still required. Reading the directory or previewing routing never starts a model call.

## Runtime Evidence

- Local OpenClaw: 2026.7.1; Node: 24.16.0.
- Configured Codex executable exists at `C:\Users\mihai\AppData\Local\OpenAI\Codex\bin\faa963e871dd422c\codex.exe` (0.158.0-alpha.2.1).
- Global defaults remain GPT-5.6 with GPT-5.5 fallback. The installed resolver honors an explicit empty fallback override; Hub always passes an explicit model.
- GPT-6 Luna Max subagents were used successfully through Codex for this task. This is not proof of GPT-6 execution through the separate OpenClaw bridge.
- No GPT-6 OpenClaw model call has been approved/run by this upgrade. The directory deliberately reports runtime verification as missing instead of reusing old entitlement claims.

Official model reference: https://developers.openai.com/api/docs/guides/latest-model
