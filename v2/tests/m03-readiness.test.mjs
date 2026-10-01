// Milestone 03-A — runtime readiness: explicit model/effort, the run timeline, R2/R3 isolation, the factory building blocks
// (spec, plan, integrity, review validation, diff, runner parsing). Pure functions first, then a few fixture-hub checks.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { resolveRunPlan, EFFORT_PROFILES } from "../server/policy/run-plan.mjs";
import { createTimeline, summarizeTimeline } from "../server/runtime/timeline.mjs";
import { effortArgs } from "../server/providers/codex.mjs";
import { codexProfileToml, codexDeniedEntries, denyListFingerprint, evaluateHostIsolation, R2_ACCEPT_TEXT, PROTECTED_CODEX_HOME_ENTRIES } from "../server/policy/isolation.mjs";
import { checkSpec, normalizeSpec, isAllowedCommand } from "../server/factory/spec.mjs";
import { buildPlan, validatePlan, normalizeLimits } from "../server/factory/plan.mjs";
import { integrityFindings } from "../server/factory/integrity.mjs";
import { parseReview, buildReviewBrief } from "../server/factory/review.mjs";
import { unifiedDiff } from "../server/factory/diff.mjs";
import { diffManifests } from "../server/factory/snapshot.mjs";
import { parseTestOutput, testStatus, commandArgv, portInUse } from "../server/factory/runner.mjs";
import net from "node:net";
import { MISSION_TEMPLATES } from "../server/domain/missions.mjs";
import { makeTestHub, enableLive } from "./helpers.mjs";

const codexState = { models: [{ id: "gpt-a", model: "gpt-a", isDefault: true, efforts: ["low", "medium", "high"] }, { id: "gpt-b", model: "gpt-b", isDefault: false, efforts: ["medium", "max"] }] };

test("M03-RP-01 run plan: no effort means the profile's effort is SENT (never the config's max); the default model comes from model/list", () => {
  const plan = resolveRunPlan({ provider: "codex", providerState: codexState });
  assert.equal(plan.problem, null);
  assert.equal(plan.model, "gpt-a");
  assert.equal(plan.modelSource, "model/list (implicit al contului)");
  assert.equal(plan.effort, EFFORT_PROFILES.BALANCED.effort.codex);
  assert.equal(plan.effortSource, "profil BALANCED");
  assert.equal(resolveRunPlan({ provider: "codex", profile: "DEEP", providerState: codexState }).effort, "high");
  const owner = resolveRunPlan({ provider: "codex", model: "gpt-b", effort: "max", providerState: codexState });
  assert.deepEqual([owner.model, owner.effort, owner.effortSource], ["gpt-b", "max", "owner"]);
});

test("M03-RP-02 run plan refuses instead of falling back: unsupported effort, unknown model, missing model list, unknown profile", () => {
  assert.match(resolveRunPlan({ provider: "codex", model: "gpt-a", effort: "max", providerState: codexState }).problem, /nu e suportat.*eligibile: low, medium, high/);
  assert.match(resolveRunPlan({ provider: "codex", model: "gpt-z", providerState: codexState }).problem, /nu apare în model\/list/);
  assert.match(resolveRunPlan({ provider: "codex", providerState: {} }).problem, /model\/list/);
  assert.match(resolveRunPlan({ provider: "codex", profile: "TURBO", providerState: codexState }).problem, /Profil/);
  assert.match(resolveRunPlan({ provider: "claude", providerState: { installation: { flags: ["--model"] } } }).problem, /--effort/);
  assert.equal(resolveRunPlan({ provider: "claude", providerState: { installation: { flags: ["--effort"] } } }).effort, "medium");
});

test("M03-RP-03 the effort override is validated before it reaches the command line", () => {
  assert.deepEqual(effortArgs("medium"), ["-c", 'model_reasoning_effort="medium"']);
  assert.deepEqual(effortArgs(""), []);
  assert.throws(() => effortArgs('high" -c x="y'), /Unsupported effort/);
});

test("M03-TL-01 timeline: first observation wins, segments attribute the wait to hub / human / provider / model_or_sandbox", () => {
  let now = Date.parse("2026-10-01T10:00:00Z");
  const clock = () => new Date(now);
  const tl = createTimeline(clock);
  tl.mark("requested", "2026-10-01T09:59:00Z");
  tl.mark("approval_requested", "2026-10-01T09:59:01Z");
  tl.mark("approval_decided", "2026-10-01T09:59:31Z");
  for (const [phase, ms] of [["dispatch", 0], ["gate_checked", 50], ["backup_ready", 2000], ["process_spawned", 100], ["thread_ready", 4000], ["mcp_checked", 300], ["turn_sent", 10], ["first_command_started", 290000], ["first_command_completed", 1500], ["finished", 60000]]) {
    now += ms; tl.mark(phase);
  }
  assert.equal(tl.mark("dispatch"), false, "a phase is recorded once");
  const s = summarizeTimeline(tl.toJSON());
  assert.equal(s.keySpans.humanApprovalMs, 30000);
  assert.equal(s.keySpans.turnToFirstCommandMs, 290000);
  assert.equal(s.keySpans.firstCommandExecutionMs, 1500);
  assert.equal(s.totals.human, 30000);
  assert.equal(s.totals.model_or_sandbox, 290000);
  assert.ok(s.totals.hub > 0 && s.totals.provider > 0);
  assert.ok(!s.phases.some((p) => p.phase === "first_output"), "unobserved phases are not invented");
});

test("M03-ISO-01 R3: config.toml, its backups and history.jsonl are denied to model commands; ~/.codex itself is never denied", () => {
  const home = path.join(path.parse(process.cwd()).root, "Users", "x");
  const hub = path.join(path.parse(process.cwd()).root, "hub");
  const toml = codexProfileToml("read-only", { homeDir: home, hubRoot: hub });
  for (const rel of [".codex/config.toml", ".codex/history.jsonl", ".codex/auth.json"]) assert.ok(toml.includes(JSON.stringify(path.join(home, ...rel.split("/")))), rel);
  assert.ok(toml.includes(JSON.stringify(`${home.split(path.sep).join("/")}/.codex/config.toml.*`)), "config.toml backups by glob");
  assert.ok(!toml.includes(`${JSON.stringify(path.join(home, ".codex"))}="deny"`), "~/.codex as a directory stays readable (sandbox runner)");
  assert.ok(PROTECTED_CODEX_HOME_ENTRIES.includes(".codex/config.toml"));
  const entries = codexDeniedEntries({ homeDir: home, hubRoot: hub });
  const m02 = entries.filter((e) => !/config\.toml|history\.jsonl/.test(e));
  assert.notEqual(denyListFingerprint(entries), denyListFingerprint(m02), "the M02 consent does not cover the M03 list");
});

test("M03-ISO-02 R2: Codex runs only on sanitized test projects unless the owner accepted the open risk for that exact project path, for a limited time", () => {
  const now = new Date("2026-10-01T10:00:00Z");
  const real = { id: "prj_1", name: "ProDelivery", path: "C:\\p\\ProDelivery", source: "registry" };
  assert.equal(evaluateHostIsolation({ provider: "codex", project: { ...real, source: "hub-test" }, now }).ok, true);
  const blocked = evaluateHostIsolation({ provider: "codex", project: real, now });
  assert.equal(blocked.ok, false);
  assert.match(blocked.detail, /R2_OPEN/);
  const acceptance = { confirmedAt: now.toISOString(), expiresAt: "2026-10-02T10:00:00Z", projectPath: real.path, text: R2_ACCEPT_TEXT };
  const accepted = evaluateHostIsolation({ provider: "codex", project: real, acceptance, now });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.level, "owner-accepted-risk");
  assert.match(accepted.detail, /nu este o izolare/);
  assert.equal(evaluateHostIsolation({ provider: "codex", project: { ...real, path: "C:\\p\\Other" }, acceptance, now }).ok, false, "bound to the path");
  assert.equal(evaluateHostIsolation({ provider: "codex", project: real, acceptance, now: new Date("2026-10-03T00:00:00Z") }).ok, false, "expires");
  assert.equal(evaluateHostIsolation({ provider: "claude", project: real, now }).level, "tool");
});

test("M03-SPEC-01 spec: drafts list their problems; only a complete spec (test criteria with files, allowed commands) can be normalized", () => {
  const draft = checkSpec({ workType: "BUGFIX", title: "Bug", objective: "Ceva nu merge bine aici", acceptance: ["Trebuie să meargă"] });
  assert.ok(draft.problems.some((p) => /testRef/.test(p)));
  assert.ok(draft.problems.some((p) => /verification.acceptance/.test(p)));
  assert.throws(() => normalizeSpec({ workType: "BUGFIX", title: "Bug", objective: "Ceva nu merge bine aici", acceptance: [{ text: "Merge corect", testRef: "../x.test.mjs" }],
    verification: { acceptance: ["node --test"] } }), /cale relativă/);
  for (const bad of ["npm test && curl x", "node --test ../other", "rm -rf .", "npx something", "node --test; echo"]) assert.equal(isAllowedCommand(bad), false, bad);
  for (const ok of ["node --test", "node --test test/a.test.mjs", "npm test", "npm run build"]) assert.equal(isAllowedCommand(ok), true, ok);
  const ok = normalizeSpec({ workType: "FEATURE", title: "Formular", objective: "Un formular cu validare completă", acceptance: [{ text: "Trimiterea validă salvează", testRef: "test/a.test.mjs" }],
    verification: { acceptance: ["node --test test/a.test.mjs"] } });
  assert.equal(ok.acceptance[0].id, "AC-1");
  assert.equal(ok.acceptance[0].verify, "test");
});

test("M03-SPEC-02 preview on a Hub port, a non-local URL or a shell command is refused", () => {
  const base = { workType: "FEATURE", title: "Formular", objective: "Un formular cu validare completă", acceptance: [{ text: "Trimiterea validă salvează", testRef: "test/a.test.mjs" }], verification: { acceptance: ["node --test"] } };
  for (const preview of [{ command: "node server.js", url: "http://127.0.0.1:8011/" }, { command: "node server.js", url: "http://example.com:4000/" }, { command: "node server.js && calc", url: "http://127.0.0.1:4000/" }]) {
    assert.ok(checkSpec({ ...base, verification: { ...base.verification, preview } }, { hubPorts: [8011, 8012] }).problems.some((p) => /preview/.test(p)), JSON.stringify(preview));
  }
  // Invalid E2E steps stay in the draft: the problem survives a later revision instead of the steps being dropped silently.
  const withSteps = { ...base, acceptance: [...base.acceptance, { text: "Fluxul în browser", verify: "e2e", steps: [{ click: "button" }, { goto: "/" }] }],
    verification: { ...base.verification, preview: { command: "node server.js", url: "http://127.0.0.1:4610/" } } };
  const draft = checkSpec(withSteps);
  assert.ok(draft.problems.some((p) => /AC-2: .*goto/.test(p)), draft.problems.join("; "));
  assert.deepEqual(draft.spec.acceptance[1].steps, [{ click: "button" }, { goto: "/" }]);
  const revised = checkSpec({ ...draft.spec, objective: "Un formular cu validare completă și listă" });
  assert.ok(revised.problems.some((p) => /AC-2: .*goto/.test(p)), "the revision still reports the invalid steps");
});

test("M03-PLAN-01 plan: one writer (Codex RW), a read-only reviewer on ANOTHER provider, no cycles; limits are bounded (≤ 2 repair cycles)", () => {
  const template = MISSION_TEMPLATES.eng_bugfix;
  const tasks = template.tasks.map((t, i) => ({ id: `task_${i}` }));
  const spec = normalizeSpec({ workType: "BUGFIX", title: "Bug", objective: "Ceva nu merge bine aici", acceptance: [{ text: "Merge corect", testRef: "test/a.test.mjs" }], verification: { acceptance: ["node --test"] } });
  const plan = buildPlan({ template, tasks, spec });
  assert.equal(plan.steps.length, 7);
  assert.ok(plan.sha256);
  const cyclic = { steps: plan.steps.map((s) => (s.key === "spec" ? { ...s, depends: [plan.steps.at(-1).taskId] } : s)) };
  assert.throws(() => validatePlan(cyclic), /ciclu|început/);
  const sameProvider = { steps: plan.steps.map((s) => (s.key === "review" ? { ...s, provider: "codex" } : s)) };
  assert.throws(() => validatePlan(sameProvider), /alt provider/);
  const writableReviewer = { steps: plan.steps.map((s) => (s.key === "review" ? { ...s, access: "workspace-write" } : s)) };
  assert.throws(() => validatePlan(writableReviewer), /doar-citire/);
  assert.throws(() => normalizeLimits({ maxRepairCycles: 3 }), /maxRepairCycles/);
  assert.equal(normalizeLimits({}).maxRepairCycles, 2);
});

test("M03-INT-01 integrity: protected test changed, control file, deleted test, skip/only, empty catch and disabled lint are all findings", () => {
  const changes = diffManifests(
    { "test/acceptance.test.mjs": { sha256: "a" }, "test/old.test.mjs": { sha256: "b" }, "src/a.js": { sha256: "c" } },
    { "test/acceptance.test.mjs": { sha256: "z" }, "src/a.js": { sha256: "d" }, ".codex/config.toml": { sha256: "e" }, ".env": { secretLike: true, size: 3 } });
  const findings = integrityFindings({ changes, protectedRefs: ["test/acceptance.test.mjs"],
    added: [{ path: "src/a.js", line: "  try { x(); } catch (e) {}" }, { path: "test/new.test.mjs", line: 'test.skip("x", () => {})' }, { path: "src/a.js", line: "// eslint-disable-next-line" }, { path: "test/n.test.mjs", line: "it.only('a', f)" }] });
  const codes = findings.map((f) => `${f.severity}:${f.code}`).sort();
  for (const expected of ["critical:protected_test_changed", "critical:control_file_changed", "high:test_deleted", "high:secret_like_changed", "high:skip_added", "medium:empty_catch", "medium:check_disabled"]) {
    assert.ok(codes.includes(expected), `${expected} in ${codes.join(", ")}`);
  }
});

test("M03-REV-01 review validation: exact change set, structured findings with evidence, no PASS with blockers/missing context, every previous finding classified", () => {
  const block = (o) => `Analiză.\n\`\`\`json\n${JSON.stringify(o)}\n\`\`\``;
  const sha = "abcdef0123456789";
  assert.equal(parseReview(block({ changeSet: "abcdef012345", verdict: "PASS", findings: [], missingContext: [] }), { changeSetSha: sha }).verdict, "PASS");
  assert.equal(parseReview("Totul e bine, PASS.", { changeSetSha: sha }).verdict, "INCONCLUSIVE");
  assert.equal(parseReview(block({ changeSet: "000000000000", verdict: "PASS", findings: [] }), { changeSetSha: sha }).verdict, "INCONCLUSIVE");
  const blocker = { severity: "high", file: "a.js", observation: "Eroare gravă aici", evidence: "linia 3" };
  assert.equal(parseReview(block({ changeSet: "abcdef012345", verdict: "PASS", findings: [blocker] }), { changeSetSha: sha }).verdict, "INCONCLUSIVE");
  assert.equal(parseReview(block({ changeSet: "abcdef012345", verdict: "PASS", findings: [], missingContext: ["b.js"] }), { changeSetSha: sha }).verdict, "INCONCLUSIVE");
  assert.equal(parseReview(block({ changeSet: "abcdef012345", verdict: "CHANGES_REQUESTED", findings: [] }), { changeSetSha: sha }).verdict, "INCONCLUSIVE");
  assert.equal(parseReview(block({ changeSet: "abcdef012345", verdict: "CHANGES_REQUESTED", findings: [{ severity: "high", file: "a.js", observation: "Fără dovadă" }] }), { changeSetSha: sha }).verdict, "INCONCLUSIVE");
  const re = parseReview(block({ changeSet: "abcdef012345", verdict: "PASS", findings: [], previousFindings: { "F-001": "resolved" } }), { changeSetSha: sha, openCodes: ["F-001", "F-002"] });
  assert.equal(re.verdict, "INCONCLUSIVE");
  assert.match(re.problems.join(" "), /F-002/);
  const brief = buildReviewBrief({ mission: { title: "M" }, spec: { workType: "BUGFIX", objective: "o", inScope: [], outOfScope: [], constraints: [], acceptance: [{ id: "AC-1", verify: "test", text: "t", testRef: "x" }] },
    specVersion: 1, changeSet: { sha256: sha, seq: 1, changes: [{ status: "modified", path: "a.js" }], diffText: "-a\n+b" } });
  assert.match(brief, /CHANGE_SET abcdef012345/);
  assert.match(brief, /DOAR-CITIRE/);
  // The reviewer fixtures for "missing context" and "still open" (also served by the fake reviewer) are validated the same way.
  const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/factory-reviews/${name}.json`, import.meta.url), "utf8"));
  assert.equal(parseReview(block({ ...fixture("inconclusive-missing"), changeSet: "abcdef012345" }), { changeSetSha: sha }).verdict, "INCONCLUSIVE", "a PASS with missing context is not a PASS");
  const stillOpen = parseReview(block({ ...fixture("still-open"), changeSet: "abcdef012345", previousFindings: { "F-001": "still_open" } }), { changeSetSha: sha, openCodes: ["F-001"] });
  assert.equal(stillOpen.verdict, "CHANGES_REQUESTED");
  assert.equal(stillOpen.previous["F-001"], "still_open");
  // The approved E2E steps reach the reviewer exactly (texts and selectors), read-only.
  const e2eBrief = buildReviewBrief({ mission: { title: "M" }, spec: { workType: "FEATURE", objective: "o", inScope: [], outOfScope: [], constraints: [],
    acceptance: [{ id: "AC-1", verify: "e2e", text: "fluxul complet", steps: [{ goto: "/" }, { expectText: "Gata" }] }] }, specVersion: 1, changeSet: { sha256: sha, seq: 1, changes: [], diffText: "" } });
  assert.match(e2eBrief, /Pașii E2E aprobați/);
  assert.match(e2eBrief, /2\. \{"expectText":"Gata"\}/);
});

test("M03-DIFF-01 the Hub's own diff reports the exact changed lines (no git involved)", () => {
  const d = unifiedDiff("a\nb\nc\n", "a\nB\nc\n", { label: "x.js" });
  assert.match(d, /--- a\/x\.js/);
  assert.match(d, /-b\n\+B/);
});

test("M03-RUN-01 runner parsing: zero tests is never a pass; counts from TAP and spec reporters; only allowed commands map to argv", () => {
  const tap = parseTestOutput(["TAP version 13", "not ok 2 - AC-1: nume", "# tests 3", "# pass 2", "# fail 1", "# skipped 0"]);
  assert.deepEqual(tap.counts, { tests: 3, pass: 2, fail: 1, skipped: 0 });
  assert.deepEqual(tap.failures, ["AC-1: nume"]);
  assert.equal(testStatus({ exitCode: 1, counts: tap.counts }).status, "FAIL");
  assert.equal(testStatus({ exitCode: 0, counts: { tests: 0 } }).status, "INCONCLUSIVE");
  assert.equal(testStatus({ exitCode: 0, counts: {} }).status, "INCONCLUSIVE");
  assert.equal(testStatus({ exitCode: 0, counts: { tests: 2, pass: 2, fail: 0 } }).status, "PASS");
  assert.equal(testStatus({ exitCode: 0, counts: { tests: 2 }, timedOut: true }).status, "FAIL");
  assert.deepEqual(parseTestOutput(["ℹ tests 4", "ℹ pass 4"]).counts, { tests: 4, pass: 4 });
  assert.deepEqual(commandArgv("node --test test/a.test.mjs").slice(1), ["--test", "--test-reporter=tap", "test/a.test.mjs"]);
});

test("M03-HUB-01 gate: missing model list and unaccepted R2 are gate checks (category gate); the effort sent is recorded with its source", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    await enableLive(hub, { provider: "codex", r2Accept: false });
    const project = hub.projects.hub();
    const conv = hub.conversations.create({ projectId: project.id, title: "R2" }, "test");
    hub.conversations.addMessage({ conversationId: conv.id, role: "user", content: "Citește README" }, "test");
    const refused = await hub.runs.start({ conversationId: conv.id, provider: "codex" }).catch((e) => e);
    assert.equal(refused.category, "gate");
    const host = refused.details.checks.find((c) => c.id === "host_isolation");
    assert.equal(host.ok, false);
    assert.match(host.detail, /R2_OPEN/);
    assert.equal(refused.details.checks.find((c) => c.id === "run_plan").ok, true);
    // Without a stored model list the plan check fails too (no silent default model).
    hub.providerState.set("codex", { ...hub.providerState.get("codex"), models: undefined });
    const noModels = await hub.runs.start({ conversationId: conv.id, provider: "codex" }).catch((e) => e);
    assert.equal(noModels.details.checks.find((c) => c.id === "run_plan").ok, false);
    // Accepting R2 is UI-only (voice can only withdraw it) and needs the exact text.
    await assert.rejects(hub.commands.dispatch({ type: "isolation.r2_accept", channel: "voice", payload: { projectId: project.id, confirmText: R2_ACCEPT_TEXT } }), /cannot be issued through voice/);
    await assert.rejects(hub.commands.dispatch({ type: "isolation.r2_accept", channel: "ui", payload: { projectId: project.id, confirmText: "da" } }), /does not match/);
    const ok = await hub.commands.dispatch({ type: "isolation.r2_accept", channel: "ui", payload: { projectId: project.id, confirmText: R2_ACCEPT_TEXT, days: 1 } });
    assert.ok(ok.result.acceptance.expiresAt);
    await hub.commands.dispatch({ type: "isolation.r2_revoke", channel: "voice", payload: { projectId: project.id } });
    assert.equal(hub.settings.get("r2Acceptance")[project.id], undefined);
  } finally { await t.cleanup(); }
});

test("M03-MCP-01 the MCP check also runs when a thread is RESUMED: an active server on the second turn stops it before the model", async () => {
  const t = await makeTestHub({ queues: true });
  try {
    const { hub } = t;
    const { project } = await enableLive(hub, { provider: "codex", attempts: 3 });
    t.queue("codex", "ok", "mcp-active");
    const conv = hub.conversations.create({ projectId: project.id, title: "Reluare" }, "test");
    const runOnce = async (text) => {
      hub.conversations.addMessage({ conversationId: conv.id, role: "user", content: text }, "test");
      const { run } = await hub.runs.start({ conversationId: conv.id, provider: "codex" });
      return new Promise((resolve) => { const iv = setInterval(() => { const r = hub.runs.getRun(run.id); if (!["running", "starting"].includes(r.status)) { clearInterval(iv); resolve(r); } }, 50); });
    };
    const first = await runOnce("Primul turn");
    assert.equal(first.status, "completed");
    const second = await runOnce("Al doilea turn (reluare)");
    assert.equal(second.status, "blocked");
    assert.match(second.errorMessage, /Servere MCP încă active/);
    assert.ok(t.readLog("codex").some((l) => l.method === "thread/resume"), "the second run resumed the thread");
    assert.ok(!second.timeline.turn_sent, "no turn reached the model");
  } finally { await t.cleanup(); }
});

test("M03-HUB-02 a Codex that keeps the config's effort ('max') is stopped before the turn; the grant attempt comes back (no turn was sent)", async () => {
  const t = await makeTestHub({ codex: "effort-ignored" });
  try {
    const { hub } = t;
    const { project, grant } = await enableLive(hub, { provider: "codex", attempts: 2 });
    const conv = hub.conversations.create({ projectId: project.id, title: "Efort" }, "test");
    hub.conversations.addMessage({ conversationId: conv.id, role: "user", content: "Citește README" }, "test");
    const { run } = await hub.runs.start({ conversationId: conv.id, provider: "codex" });
    const done = await new Promise((resolve) => { const iv = setInterval(() => { const r = hub.runs.getRun(run.id); if (!["running", "starting"].includes(r.status)) { clearInterval(iv); resolve(r); } }, 50); });
    assert.equal(done.status, "blocked");
    assert.match(done.errorMessage, /efortul max în loc de medium/);
    assert.equal(done.plan.effort, "medium");
    assert.equal(done.plan.reported.effort, "max");
    assert.ok(!done.timeline.turn_sent, "no turn was sent");
    const launches = t.readLog("codex").filter((l) => l.launchArgs);
    assert.ok(launches.some((l) => l.launchArgs.includes('model_reasoning_effort="medium"')), "the effort was set for the run's process");
    assert.equal(hub.grants.get(grant.id).attemptsUsed, 0, "the attempt was given back");
  } finally { await t.cleanup(); }
});

test("M03-RUN-02 the preview port must be free: any listener (also one that speaks no HTTP or never answers) counts as busy", async () => {
  const silent = net.createServer(() => {});
  await new Promise((r) => silent.listen(0, "127.0.0.1", r));
  const port = silent.address().port;
  assert.equal(await portInUse(`http://127.0.0.1:${port}/`, 500), "acceptă conexiuni");
  await new Promise((r) => silent.close(r));
  assert.equal(await portInUse(`http://127.0.0.1:${port}/`, 500), null, "a refused connection means free");
});
