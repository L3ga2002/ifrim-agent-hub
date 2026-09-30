# Protocolul de handoff Codex ↔ Claude (V2)

Implementare: `v2/server/runtime/handoff.mjs`, `v2/server/runtime/prompt.mjs`. Teste: `v2/tests/runs-handoff.test.mjs` (T11).

## Cei 9 pași

| # | Pas | Implementare | Starea salvată |
|---|---|---|---|
| 1 | Oprește programarea acțiunilor noi | `begin()`: conversația intră în `handoff`; doar providerul țintă poate porni, și doar după pasul 6 | `handoffs.step = frozen` |
| 2 | Punct sigur | dacă există un run activ pe conversație → `waiting` (utilizatorul așteaptă sau întrerupe) | `safe_point` |
| 3 | Reconciliere | lease reținut pe workspace sau efecte de tool cu rezultat necunoscut → `waiting` | `reconciled` |
| 4 | Checkpoint | checkpoint Hub cross-provider (`runtime/checkpoints.mjs`): git real, misiuni/taskuri, aprobări, lock-uri, sesiuni, teste, artefacte, efecte externe, următoarea acțiune + **referințe** la sesiunile/checkpointurile native (Claude `/rewind` este local sesiunii; firul Codex) | `checkpoints` + `checkpointed` |
| 5 | Pachet | `HandoffPackage` complet, redactat, cu SHA-256 canonic | `package_json`, `package_sha256`, `packaged` |
| 6 | Transfer exclusivitate | `conversations.writer_provider = țintă` (lease-ul workspace e liber la pasul 3) | `writer_transferred` → `ready` |
| 7 | Pornire țintă | **doar** prin poarta normală (mod, grant, BillingPolicy, backup) | `agent_runs` |
| 8 | Verificarea preluării | primul răspuns al țintei trebuie să înceapă cu `HANDOFF_ACK <id> <sha12>` | `acknowledged` sau rămâne `ready` cu motiv |
| 9 | Continuare | aceeași conversație vizibilă, același worktree | `continued` / `completed` |

La eșec, checkpoint-ul și pachetul rămân recuperabile; nu pornește un al doilea writer și nu se repetă o operație externă cu rezultat necunoscut.

## HandoffPackage (schema_version 1)

`schema_version, conversation_id, task_id, objective, acceptance_criteria, user_constraints, decisions_with_sources, completed_work, remaining_work, blockers, next_safe_action, repo, worktree, branch, commit, dirty_diff (+dirty_diff_truncated), untracked_manifest, test_results, running_processes, unresolved_side_effects, pending_approvals, artifacts, source_session (provider, **surface**, native_session_id, last_run_id), target_provider, **target_surface**, **native_checkpoint_refs**, context_references, created_at`

Milestone 01: rândul `handoffs` păstrează `from_surface` / `to_surface` (ex.: `openai.codex_app_server` → `anthropic.claude_code_headless`), iar tranzițiile de stare sunt validate de mașina `handoff` din `runtime/lifecycles.mjs`.

- `context_references` indică intervalul de mesaje, checkpoint-ul și rezumatele; mesajele originale rămân în Hub.
- Pachetul este trecut prin redaction (chei, tokenuri, parole) înainte de salvare și înainte de prompt.
- Nu se transferă raționament intern ascuns și nu se promite identitate între stările interne ale modelelor.
- În prompt, diff-ul este limitat la 12 000 de caractere; ținta este instruită să inspecteze repository-ul local.

## Garanții testate (PASS_SIMULATED)

- Round-trip Codex → Claude → Codex păstrează obiectivul, restricțiile, diff-ul real și worktree-ul; o singură conversație vizibilă.
- Un handoff nu poate fi deschis de două ori; providerul sursă nu poate porni în timpul handoff-ului.
- Punctul sigur așteaptă un run activ și continuă după întreruperea lui.
- Secretele din diff sunt redactate din pachet.
