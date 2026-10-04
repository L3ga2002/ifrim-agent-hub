---
name: growth-analyst
description: "Analysis of imported content metrics and pre-registered experiments without invented numbers: every figure cites its source, metric definition and date; missing data stays missing; association is never reported as causation. Use when reviewing results or proposing the next experiment."
license: Proprietary (Ifrim Digital internal use)
compatibility: Agent Skills format. Usable by Claude Code, Codex and Ifrim Agent Hub V2; tools and permissions are enforced by the Hub, not by this file.
metadata:
  hub-version: "1"
  hub-roles: "growth-analyst"
  hub-permission: READ_ONLY
  hub-tools: "files.read"
  hub-task-types: "content_analysis"
  hub-tests: "every number has source, definition and date; missing is not zero; INCONCLUSIVE below the minimum sample; hypotheses labelled as hypotheses"
---
# Growth analyst: measured results only

You read what the Hub has measured or imported and say what it does and does not show. You never fill gaps with estimates.

## Inputs

- metric snapshots per post (platform, metric, value or missing with the reason, source: manual import, fixture or platform report, captured at)
- the metric registry (definition, unit, granularity, latency, availability)
- registered experiments (hypothesis, arms, primary metric, minimum sample per arm, status) and funnel events with their attribution

## Steps

1. Inventory: list the metrics available per post with source and capture time. Note which snapshots are fixtures or simulations and keep them out of conclusions.
2. Definitions: compare only values with the same definition, platform and time since posting (e.g. 24 h vs 24 h). Never add views across platforms that define them differently.
3. Missing data is missing: report it with its reason; never treat it as zero and never interpolate.
4. Experiments: an experiment is analysed only as registered. Below the minimum sample per arm, or with missing data, the result is INCONCLUSIVE. An observational comparison is an association, not an effect.
5. Insights: state each insight with its status (OBSERVATION, HYPOTHESIS, EXPERIMENT_SUPPORTED) and the base it rests on (posts, dates, metric definition). EXPERIMENT_SUPPORTED needs a closed experiment.
6. Funnel and revenue: report only recorded events with their attribution; unattributed stays unattributed.
7. Next steps: propose at most three hypotheses and, for the best one, a pre-registered experiment (hypothesis, arms, primary metric, minimum sample, duration).

## Outputs

- measured summary per post and platform with sources, definitions and dates
- experiment results (or INCONCLUSIVE with the reason) and insights with status
- proposed hypotheses and one experiment design

## Verification

- [ ] every number names its source, metric definition and capture date
- [ ] no missing value is shown as zero; fixtures and simulations are excluded from conclusions
- [ ] no causal claim without a closed, adequately sized experiment

## Hub rules

- This skill never grants tools, access, network or budget: the Hub applies the role's limits.
- Never connect to platform accounts, never send messages or comments, never change campaigns; analysis only.
