// 2.15.2: one regression test (or more) per defect of the 13 verified on 3d9b3e8 (the conversation freeze first). Each test fails on
// 3d9b3e8 and passes on the fix. Synthetic only: pure functions, or a test hub in its own temp root; no model, no network.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseMarkdown } from "../web/src/lib/markdown.js";
import { parseCriteriaLines, mergeCriteria, criterionLine, retryRunBody, runRequestBody } from "../web/src/lib/uiLogic.js";
import { lastJsonBlock, parseReview } from "../server/factory/review.mjs";
import { redactText, redactDeep } from "../server/security/redact.mjs";
import { resolveIntent, stopTalkAnswer } from "../server/owner/intents.mjs";
import { searchFiles } from "../server/tools/registry.mjs";
import { makeTestHub, makeProject, enableLive } from "./helpers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = (rel) => fs.readFileSync(path.join(here, "..", rel), "utf8");
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra }).then((r) => r.result ?? r);
/** A synthetic test project (the marker the Hub's test script writes), registered like the test script does. */
async function testProject(t, folder, name) {
  const dir = path.join(t.dataDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".ifrim-hub-test.json"), `${JSON.stringify({ createdBy: "ifrim-agent-hub", purpose: "live-validation", name })}\n`);
  makeProject(dir);
  return { dir, ...(await dispatch(t.hub, "project.register_test", { path: dir, name })) };
}

// ---------------------------------------------------------------- B2: the conversation freeze
test("FIX-B2 a fence with an info string („```js title”) never freezes the Markdown parser; every input ends", () => {
  // Run in a child with a time limit: on 3d9b3e8 this input never returns (the tab froze on every open of that conversation).
  const url = pathToFileURL(path.join(here, "..", "web", "src", "lib", "markdown.js")).href;
  const inputs = ["```js title\nconst a = 1;\n```", "```js title=\"app.js\"\nx\n```\ndupă", "``` js {1,3}\ncod\n```", "a\n```x```\nb", "```x```", "```\nsimplu\n```", "```js title"];
  const code = `import { parseMarkdown } from ${JSON.stringify(url)}; const out = ${JSON.stringify(inputs)}.map((s) => parseMarkdown(s)); process.stdout.write(JSON.stringify(out));`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", code], { timeout: 15000, encoding: "utf8" });
  assert.equal(child.error?.code, undefined, "the parser returned (no infinite loop)");
  assert.equal(child.status, 0, child.stderr);
  const [titled, titledAttr, spaced, inline, lone, plain, open] = JSON.parse(child.stdout);
  assert.deepEqual(titled, [{ t: "code", lang: "js", v: "const a = 1;", open: false }]);
  assert.deepEqual(titledAttr.map((b) => b.t), ["code", "p"]); assert.equal(titledAttr[0].lang, "js");
  assert.deepEqual(spaced, [{ t: "code", lang: "js", v: "cod", open: false }]);
  assert.ok(inline.every((b) => b.t === "p"), "„```x```” on one line is text, not a fence");
  assert.ok(lone.length >= 1 && lone.every((b) => b.t === "p"));
  assert.deepEqual(plain, [{ t: "code", lang: "", v: "simplu", open: false }]);
  assert.deepEqual(open, [{ t: "code", lang: "js", v: "", open: true }]);
  // The same parser in this process, for the usual blocks (unchanged).
  assert.deepEqual(parseMarkdown("# Titlu\n- a\n- b\n> citat\ntext").map((b) => b.t), ["heading", "list", "quote", "p"]);
});

// ---------------------------------------------------------------- B9 + B22: the Factory spec editor
test("FIX-B9 deleting a criterion line never moves its E2E steps or expected failure to the next criterion; a new line inherits nothing", () => {
  const previous = [
    { id: "AC-1", text: "Numele gol e refuzat", verify: "test", testRef: "test/a.test.mjs", expectFailure: "nume obligatoriu" },
    { id: "AC-2", text: "Fluxul de rezervare în browser", verify: "e2e", steps: [{ goto: "/rezervari" }] },
    { id: "AC-3", text: "Fluxul de anulare în browser", verify: "e2e", steps: [{ goto: "/anulare" }] },
  ];
  const lines = previous.map(criterionLine);
  assert.equal(lines[1], "AC-2: Fluxul de rezervare în browser | e2e");
  // The owner deletes the AC-2 line and adds a new e2e criterion at the end (what the editor shows, edited).
  const edited = [lines[0], lines[2], "Fluxul de plată în browser | e2e"].join("\n");
  const merged = mergeCriteria(parseCriteriaLines(edited, previous), previous);
  assert.deepEqual(merged.map((a) => a.id), ["AC-1", "AC-3", "AC-4"]);
  assert.equal(merged[0].expectFailure, "nume obligatoriu");
  assert.deepEqual(merged[1].steps, [{ goto: "/anulare" }], "AC-3 keeps its own steps");
  assert.equal(merged[2].steps, undefined, "the new criterion does not inherit the deleted AC-2's steps");
  assert.ok(!JSON.stringify(merged).includes("/rezervari"), "the deleted criterion's steps are gone, not moved");
  // Text edited on a line that keeps its id keeps the steps; a repeated id is a new criterion.
  const retyped = mergeCriteria(parseCriteriaLines("AC-3: Anularea în browser, reformulată | e2e\nAC-3: Copie | e2e", previous), previous);
  assert.deepEqual(retyped[0].steps, [{ goto: "/anulare" }]);
  assert.equal(retyped[1].id, "AC-4"); assert.equal(retyped[1].steps, undefined);
  // Typed without ids and without a previous spec (a new mission): AC-1, AC-2… as before.
  assert.deepEqual(parseCriteriaLines("Unu e bun | review\nDoi e bun | review").map((a) => a.id), ["AC-1", "AC-2"]);
  const panel = source("web/src/screens/factory/FactoryPanel.jsx");
  assert.match(panel, /spec\.acceptance\.map\(criterionLine\)/);
  assert.match(panel, /mergeCriteria\(parseCriteriaLines\(form\.criteria, spec\.acceptance\), spec\.acceptance\)/);
});

test("FIX-B22 a „|” inside a criterion's text stays in the text (the kind and the path are read from the end of the line)", () => {
  const a = { id: "AC-1", text: "Afișează „Da | Nu” la confirmare", verify: "test", testRef: "test/confirm.test.mjs" };
  const [back] = parseCriteriaLines(criterionLine(a), [a]);
  assert.deepEqual(back, a);
  assert.deepEqual(parseCriteriaLines("Opțiunile A | B rămân vizibile")[0], { id: "AC-1", text: "Opțiunile A | B rămân vizibile", verify: "review" });
  assert.deepEqual(parseCriteriaLines("Raport X | Y | manual")[0], { id: "AC-1", text: "Raport X | Y", verify: "manual" });
  assert.deepEqual(parseCriteriaLines("Numele e validat | test/n.test.mjs")[0], { id: "AC-1", text: "Numele e validat", verify: "test", testRef: "test/n.test.mjs" });
  // Review: a text that itself ends in „| test” round-trips (the kind written last wins).
  const tail = { id: "AC-2", text: "Butonul arată x | test", verify: "review" };
  assert.deepEqual(parseCriteriaLines(criterionLine(tail), [tail])[0], tail);
  // Review: ids stay in the server's AC-1..AC-999 form (leading zeros normalised; past AC-999 the lowest free id).
  assert.equal(parseCriteriaLines("AC-007: Text bun | review")[0].id, "AC-7");
  const full = [{ id: "AC-999", text: "Ultimul criteriu", verify: "review" }, { id: "AC-1", text: "Primul criteriu", verify: "review" }];
  const grown = parseCriteriaLines("AC-999: Ultimul criteriu | review\nAC-1: Primul criteriu | review\nCriteriu nou | review", full);
  assert.deepEqual(grown.map((a) => a.id), ["AC-999", "AC-1", "AC-2"]);
  assert.ok(grown.every((a) => /^AC-[1-9]\d{0,2}$/.test(a.id)));
});

// ---------------------------------------------------------------- A16: a PASS review quoting code
test("FIX-A16 a valid PASS review whose evidence quotes code with ``` is read as PASS, not INCONCLUSIVE", () => {
  const sha = "a".repeat(64);
  const answer = { changeSet: sha.slice(0, 12), verdict: "PASS", summary: "Schimbarea e corectă.", missingContext: [],
    findings: [{ severity: "info", file: "src/app.js", area: "validare", observation: "Validarea e corectă", impact: "niciunul", evidence: "```js\nif (!name) throw new Error(\"nume\");\n```", reproduction: "-" }] };
  const text = `Am verificat diff-ul.\n\n\`\`\`json\n${JSON.stringify(answer, null, 2)}\n\`\`\`\n`;
  const parsed = parseReview(text, { changeSetSha: sha });
  assert.equal(parsed.verdict, "PASS", JSON.stringify(parsed.problems));
  assert.equal(parsed.findings[0].evidence.includes("throw new Error"), true);
  // The last block still wins; a block that never parses is still reported as invalid JSON.
  assert.equal(JSON.parse(lastJsonBlock("```json\n{\"a\":1}\n```\ntext\n```json\n{\"a\":2}\n```")).a, 2);
  assert.match(parseReview("```json\n{ nu e json\n```", { changeSetSha: sha }).problems.join(" "), /JSON invalid/);
  // Review: a broken LAST block is never replaced by an earlier one (a quoted sample is not the verdict).
  const sample = `Exemplu:\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`\nRăspunsul meu:\n\`\`\`json\n{"verdict": "CHANGES_REQUESTED",\n\`\`\`\n`;
  assert.equal(parseReview(sample, { changeSetSha: sha }).verdict, "INCONCLUSIVE");
  assert.match(parseReview(sample, { changeSetSha: sha }).problems.join(" "), /JSON invalid/);
  // The test review of step 0 reads its block with the same rule.
  assert.match(source("server/factory/test-first.mjs"), /const lastJsonBlock = reviewJsonBlock;/);
});

// ---------------------------------------------------------------- A26 + A27: redaction
test("FIX-A26 a quoted secret with spaces is redacted whole", () => {
  for (const text of ['password: "parola mea secreta"', "{\"api_key\": \"abc def ghi\"}", "token='a b\\'c d'", 'client_secret = "x y"']) {
    const out = redactText(text);
    assert.match(out, /\[redacted\]/, text);
    for (const word of ["parola", "secreta", "abc", "ghi", "b\\'c", "x y"]) if (text.includes(word)) assert.ok(!out.includes(word), `${text} → ${out}`);
  }
  assert.equal(redactText("password=hunter22 ok"), "password=[redacted] ok");
  assert.equal(redactText('password: "[redacted]"'), 'password: "[redacted]"');
  // Review: redacted JSON text stays JSON (the quotes are kept).
  assert.deepEqual(JSON.parse(redactText(JSON.stringify({ password: "parola mea", user: "ana" }))), { password: "[redacted]", user: "ana" });
});
test("FIX-A27 secrets inside a list under a sensitive key are redacted; other lists and objects keep their values", () => {
  const out = redactDeep({ tokens: ["abc", "def"], secrets: [{ name: "db", value: "pw" }], credentials: [["x"]], apiKey: null, list: ["plain"], tokenUsage: { input: 3 } });
  assert.deepEqual(out, { tokens: ["[redacted]", "[redacted]"], secrets: [{ name: "[redacted]", value: "[redacted]" }], credentials: [["[redacted]"]], apiKey: null, list: ["plain"], tokenUsage: { input: 3 } });
});

// ---------------------------------------------------------------- A36, A35, A3: Lega and the named project
const PROJECTS = [{ id: "p1", name: "ProDelivery", slug: "prodelivery" }, { id: "p2", name: "Factory Demo A", slug: "factory-demo-a" }, { id: "p3", name: "Factory Demo B", slug: "factory-demo-b" }];
const resolve = (text) => resolveIntent(text, { projects: PROJECTS, currentProjectId: "p1", missions: [], departments: [], pendingEnvelopes: [] });
test("FIX-A36 / A35 (resolver) a named project that matches nothing or several is never replaced by the open one", () => {
  const unknown = resolve("Setează autonomia pe trusted pe Zorro").steps[0];
  assert.equal(unknown.intent, "autonomy"); assert.equal(unknown.args.projectId, undefined); assert.equal(unknown.args.unknownRef, "zorro");
  assert.equal(resolve("Setează autonomia pe trusted").steps[0].args.projectId, "p1", "no name → the open project");
  assert.equal(resolve("Setează autonomia pe trusted pe proiectul acesta").steps[0].args.projectId, "p1");
  assert.equal(resolve("Setează autonomia pe trusted pe Factory Demo A").steps[0].args.projectId, "p2");
  for (const text of ["Îngheață Zorro", "Dezgheață Zorro"]) assert.equal(resolve(text).steps[0].args.projectId, undefined, text);
  const both = resolve("Dezgheață Factory Demo acum");
  assert.equal(both.steps[0].args.projectId, undefined); assert.match(both.clarification?.question || "", /Factory Demo A sau Factory Demo B/);
  assert.equal(resolve("Dezgheață proiectul").steps[0].args.projectId, "p1");
  // Review: the usual ways of saying „this project” still mean the open one.
  for (const text of ["Îngheață acest proiect", "Îngheață aici", "Îngheață proiectul de aici", "Dezgheață acest proiect", "Setează autonomia pe trusted pe acest proiect"]) {
    assert.equal(resolve(text).steps[0].args.projectId, "p1", text);
  }
});
test("FIX-A3 the unfreeze runs only as a clear imperative: a question, a condition, a negation or a report unfreezes nothing", () => {
  assert.equal(resolve("Dezgheață Factory Demo A").steps[0].intent, "unfreeze_project");
  assert.equal(resolve("Lega, te rog dezgheață Factory Demo A").steps[0].intent, "unfreeze_project");
  for (const [text, mood] of [["Dezgheață Factory Demo A?", "ask"], ["Dacă pică testele, dezgheață Factory Demo A", "conditional"], ["Ieri am zis dezgheață Factory Demo A", "reported"],
    ["Butonul dezgheață proiectul", "mention"]]) {
    const step = resolve(text).steps[0];
    assert.deepEqual([step.intent, step.args.about, step.args.mood], ["explain_stop", "unfreeze_project", mood], text);
  }
  for (const text of ["Nu dezgheța Factory Demo A", "Lega, să nu dezgheți Factory Demo A", "Nu vreau să dezgheți Factory Demo A"]) {
    assert.ok(resolve(text).steps.every((s) => s.intent !== "unfreeze_project"), text);
  }
  assert.equal(stopTalkAnswer({ mood: "negation", about: "unfreeze_project" }), "Bine, nu dezgheț nimic.");
  assert.match(stopTalkAnswer({ mood: "ask", about: "unfreeze_project" }), /^Nu am dezghețat nimic/);
});

async function intakeHub() {
  const t = await makeTestHub();
  const alfa = await testProject(t, "demo-alfa", "Demo Alfa");
  const beta = await testProject(t, "demo-beta", "Demo Beta");
  const say = (text, projectId = alfa.id) => dispatch(t.hub, "owner.intent", { text, projectId, source: "typed" });
  const frozen = () => Object.keys(t.hub.settings.get("projectFreeze") || {});
  return { t, alfa, beta, say, frozen };
}
test("FIX-A35 / A36 (intake) nothing is frozen, unfrozen or changed on the open project when the named one is unknown or ambiguous", async () => {
  const { t, alfa, beta, say, frozen } = await intakeHub();
  try {
    const unknown = await say("Îngheață Zorro");
    assert.deepEqual(frozen(), [], "the open project is not frozen for an unknown name");
    assert.match(unknown.results[0].interrupt?.summary || "", /Nu găsesc proiectul „zorro”; nu am înghețat nimic/);
    const ambiguous = await say("Îngheață Demo");
    assert.deepEqual(frozen(), [], "nothing frozen before the question is answered");
    assert.match(ambiguous.resolved.clarification?.question || "", /Demo Alfa sau Demo Beta/);
    const level = t.hub.envelopes.autonomyOf(alfa.id).level;
    const autonomy = await say("Setează autonomia la trusted pe Zorro");
    assert.equal(t.hub.envelopes.autonomyOf(alfa.id).level, level, "the open project's autonomy is unchanged");
    assert.match(autonomy.results[0].message || "", /Nu găsesc proiectul „zorro”; nu am schimbat autonomia/);
    await say("Îngheață Demo Beta");
    assert.deepEqual(frozen(), [beta.id], "the named project is frozen, not the open one");
    await say("Dezgheață Zorro");
    assert.deepEqual(frozen(), [beta.id], "an unknown name unfreezes nothing");
    await say("Dezgheață Demo Beta?");
    assert.deepEqual(frozen(), [beta.id], "a question unfreezes nothing");
    await say("Nu dezgheța Demo Beta");
    assert.deepEqual(frozen(), [beta.id], "a negation unfreezes nothing");
    await say("Dezgheață Demo Beta");
    assert.deepEqual(frozen(), [], "the imperative unfreezes the named project");
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- A12: a failed backup
test("FIX-A12 a backup whose step throws ends as failed with its reason, never „running” forever", async () => {
  const t = await makeTestHub();
  try {
    const project = await testProject(t, "backup-fails", "Backup fails");
    const dir = project.dir;
    if (!t.hub.projects.get(project.id).executionAllowed) t.hub.projects.setExecution(project.id, true, { confirmName: "Backup fails", actor: "test" });
    fs.writeFileSync(path.join(dir, ".ifrim"), "a file where the backup folder must be\n"); // the archive folder cannot be created
    await assert.rejects(t.hub.backups.run(project.id, "test"));
    const rows = t.hub.db.prepare("SELECT status, error FROM backups WHERE project_id = ?").all(project.id);
    assert.equal(rows.length, 1); assert.equal(rows[0].status, "failed"); assert.ok(rows[0].error);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM backups WHERE status = 'running'").get().n, 0);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'backup.failed'").get().n, 1);
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- A10: one unreadable file
test("FIX-A10 one file that cannot be read (EBUSY) is skipped and counted; the search still answers", (c) => {
  const root = fs.mkdtempSync(path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "ifrim-fix-a10-"));
  c.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "a.txt"), "căutare aici\n");
  fs.writeFileSync(path.join(root, "busy.txt"), "căutare și aici\n");
  const real = fs.readFileSync;
  const spy = mock.method(fs, "readFileSync", function (file, ...rest) {
    if (String(file).endsWith("busy.txt")) throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
    return real.call(this, file, ...rest);
  });
  try {
    const out = searchFiles(root, { query: "căutare" });
    assert.deepEqual(out.matches.map((m) => m.path), ["a.txt"]);
    assert.ok(out.skipped >= 1);
  } finally { spy.mock.restore(); }
});

// ---------------------------------------------------------------- A38: the handoff's test results
test("FIX-A38 a handoff package (and a checkpoint) carries the test runs of its own project only", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const { project } = await enableLive(hub, { attempts: 5 });
    const other = await testProject(t, "other-project", "Alt proiect");
    const insert = (id, projectId, summary) => hub.db.prepare("INSERT INTO tool_calls (id, run_id, tool, args_json, effects, status, result_json, started_at, finished_at) VALUES (?, NULL, 'process.test', ?, 'local process', 'completed', ?, ?, ?)")
      .run(id, JSON.stringify({ script: "test", ...(projectId ? { projectId } : {}) }), JSON.stringify({ summary: [summary] }), new Date().toISOString(), new Date().toISOString());
    insert("tool_mine", project.id, "# pass 7 (al meu)");
    insert("tool_other", other.id, "# fail 3 (alt proiect)");
    insert("tool_legacy", null, "# fail 9 (fără proiect)");
    const conv = hub.bus.transaction(() => hub.conversations.create({ projectId: project.id, title: "Predare" }));
    hub.bus.transaction(() => hub.conversations.addMessage({ conversationId: conv.id, role: "user", content: "Continuă lucrul" }));
    const h = hub.handoffs.begin({ conversationId: conv.id, toProvider: "claude" });
    const ready = await hub.handoffs.advance(h.id);
    const text = JSON.stringify(ready.package.test_results);
    assert.match(text, /al meu/); assert.doesNotMatch(text, /alt proiect|fără proiect/);
    const ckpt = await hub.checkpoints.create({ scopeType: "project", scopeId: project.id, label: "test" }, "test");
    assert.deepEqual(ckpt.hubState.tests.map((row) => row.tool), ["process.test"], "the checkpoint lists this project's run only");
    assert.match(source("server/tools/registry.mjs"), /"process\.test" : "process\.build", \{ script, projectId: p\.id \}/);
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- B42 + B39: the two screens
test("FIX-B42 a retry keeps the run's task, effort, model and access (the conversation's „Reîncearcă”)", () => {
  const run = { id: "run_1", provider: "codex", access: "workspace-write", model: "gpt-6.1-sol", effort: "high", taskId: "tsk_1", status: "failed" };
  assert.deepEqual(retryRunBody(run), { provider: "codex", access: "workspace-write", model: "gpt-6.1-sol", effort: "high", taskId: "tsk_1" });
  assert.deepEqual(retryRunBody(retryRunBody(run)), retryRunBody(run), "the confirmed body is sent unchanged");
  assert.deepEqual(retryRunBody({ provider: "claude", access: "read-only", model: "sonnet", effort: "", taskId: null }), { provider: "claude", access: "read-only", model: "sonnet" });
  // What the composer sends for a new run has the same shape (task and effort included).
  assert.deepEqual(Object.keys(runRequestBody({ provider: "codex", access: "read-only", effort: "high", taskId: "tsk_1" })).sort(), ["access", "effort", "provider", "taskId"]);
  const screen = source("web/src/screens/focus/FocusScreen.jsx");
  assert.match(screen, /setConfirmRetry\(retryRunBody\(lastRun\)\)/);
  assert.match(screen, /body: retryRunBody\(r\)/);
  assert.doesNotMatch(screen, /body: \{ provider: r\.provider, access: r\.access/);
});
test("FIX-B39 the verification note belongs to the task it was typed for (the task panel's actions are keyed by the task)", () => {
  const screen = source("web/src/screens/Missions.jsx");
  assert.match(screen, /<TaskActions key=\{task\.id\} task=\{task\} onDone=\{reload\} \/>/);
  assert.equal((screen.match(/<TaskActions /g) || []).length, 1);
});
