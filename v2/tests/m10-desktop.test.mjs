// M10 Desktop Operator through the Hub (deterministic fixture helper speaking the real protocol): direct local commands in the owner
// session (D1, D8), the Notepad observe → act → verify plan (D2), CapCut through a plan (D6), the negatives (D9): no authority, other
// channels, protected targets, sensitive controls, user input, identity changes, secure desktop, a dying or hanging helper, Stop and
// "Preiau eu", boot recovery and a changed binary. The real C# helper's protocol checks run in m10-operator-real.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tempDir } from "./helpers.mjs";
import { makeDesktopHub, readyDesktop, asOwner, asChannel, runPlan } from "./m10-helpers.mjs";

const setPolicy = (t, patch) => t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...t.hub.settings.get("mediaPolicy"), ...patch }, "test"));
const actions = (t) => t.hub.db.prepare("SELECT * FROM desktop_actions ORDER BY started_at, rowid").all();

test("M10-DO-01 D1 „Deschide CapCut”: launch → its window → foreground, verified; one recorded session that ends; no model", async () => {
  const t = await makeDesktopHub();
  try {
    const owner = await readyDesktop(t);
    const r = await asOwner(t, owner, "desktop.app.open", { app: "CapCut" });
    assert.equal(r.app.id, "capcut");
    assert.equal(r.launched, true);
    assert.equal(r.verified, true, r.note);
    assert.ok(r.window.hwnd && r.window.pid && r.window.procStart);
    // A second "Deschide CapCut" reuses the window (no second launch).
    const again = await asOwner(t, owner, "desktop.app.open", { app: "capcut" });
    assert.equal(again.launched, false);
    assert.equal(again.window.hwnd, r.window.hwnd);
    const log = t.opLog();
    assert.equal(log.filter((e) => e.op === "launch").length, 1);
    for (const e of log.filter((x) => !["discoverApps"].includes(x.op))) assert.deepEqual(e.auth.apps, ["CapCut"], `${e.op} carries the app scope`);
    assert.ok(actions(t).length >= 4 && actions(t).every((a) => a.status === "DONE" && a.channel === "owner"));
    assert.equal(t.hub.desktop.sessionStatus(), null, "the direct command's desktop session ended");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0);
  } finally { await t.cleanup(); }
});

test("M10-DO-02 direct commands only from the owner session: ui / voice / agent refused; an unauthorized app needs the decision", async () => {
  const t = await makeDesktopHub();
  try {
    const owner = await readyDesktop(t, ["notepad"]);
    for (const channel of ["ui", "voice", "companion"]) await assert.rejects(asChannel(t, channel, "desktop.app.open", { app: "notepad" }), /cannot be issued through|canal/i);
    await assert.rejects(t.hub.commands.dispatch({ type: "desktop.app.open", payload: { app: "notepad" }, channel: "agent", actor: "agent", delegation: "delegare 1234567" }));
    // CapCut is discovered (signed by Bytedance) but not authorized: the gate refuses with NEEDS_DECISION, nothing reaches the helper.
    const before = t.opLog().length;
    await assert.rejects(asOwner(t, owner, "desktop.app.open", { app: "capcut" }), (e) => e.code === "NEEDS_DECISION");
    assert.equal(t.opLog().filter((e) => e.op === "launch").length, 0);
    assert.ok(t.opLog().length - before <= 0, "no helper operation for a refused action");
    assert.equal(actions(t).at(-1).status, "REFUSED");
    // Unknown app name: a clear error listing the operator's apps.
    await assert.rejects(asOwner(t, owner, "desktop.app.open", { app: "Word" }), /Nu cunosc aplicația/);
    // An ended owner session cannot drive the desktop.
    t.hub.trust.endSession(owner.session, "test");
    await assert.rejects(asOwner(t, owner, "desktop.app.open", { app: "notepad" }), /sesiunea de proprietar|session/i);
  } finally { await t.cleanup(); }
});

test("M10-DO-03 owner.intent „Deschide CapCut” for an unauthorized app → ONE plan card with that decision; Hello-fresh confirm → authorized + opened", async () => {
  const t = await makeDesktopHub();
  try {
    const owner = await readyDesktop(t, []);
    const r = await asOwner(t, owner, "owner.intent", { text: "Deschide CapCut", source: "typed" });
    const step = r.results[0];
    assert.equal(step.intent, "desktop_open");
    assert.ok(step.opsPlan, JSON.stringify(step));
    assert.equal(step.opsPlan.decisions.length, 1);
    assert.equal(step.opsPlan.decisions[0].kind, "app.authorize");
    assert.equal(t.hub.desktop.apps.get("capcut").authorized, false, "nothing authorized by showing the card");
    // "Da" typed, for exactly the presented plan.
    const yes = await asOwner(t, owner, "owner.intent", { text: "Da", source: "typed", presented: { planId: step.opsPlan.id, nonce: step.opsPlan.nonce, hash: step.opsPlan.hash } });
    assert.ok(yes.results[0].confirmed, JSON.stringify(yes.results[0]));
    const done = await t.hub.opsPlans.idle(step.opsPlan.id);
    assert.equal(done.status, "DONE", done.statusReason);
    assert.equal(t.hub.desktop.apps.get("capcut").authorized, true);
    assert.equal(t.hub.desktop.apps.get("capcut").authorizedBy.via, `plan:${step.opsPlan.id}`);
    // From now on the sentence is direct (LOCAL_DIRECT), no card.
    const direct = await asOwner(t, owner, "owner.intent", { text: "Adu CapCut în față", source: "typed" });
    assert.equal(direct.results[0].intent, "desktop_focus");
    assert.equal(direct.results[0].desktop.verified, true);
  } finally { await t.cleanup(); }
});

test("M10-DO-04 protected targets and the Hub's own window are refused by the helper even inside the app scope", async () => {
  const t = await makeDesktopHub({ scenario: { windows: [
    { kind: "generic", processName: "consent", title: "User Account Control", className: "Credential Dialog Xaml Host" },
    { kind: "generic", processName: "CapCut", title: "Ifrim Agent Hub — localhost:8011", className: "Chrome_WidgetWin_1" },
    { kind: "generic", processName: "KeePass", title: "Database.kdbx - KeePass", className: "WindowsForms10" }] } });
  try {
    const owner = await readyDesktop(t);
    const list = (await t.hub.desktop.client.request("listWindows", { processNames: ["consent", "CapCut", "KeePass"] }, { plan: "t", step: "t", apps: ["consent", "CapCut", "KeePass"], exp: new Date(Date.now() + 60000).toISOString() })).windows;
    const consent = list.find((w) => w.processName === "consent");
    const hubWin = list.find((w) => w.title.includes("Ifrim Agent Hub"));
    const keepass = list.find((w) => w.processName === "KeePass");
    const ctx = { kind: "direct", channel: "owner", actor: "owner", sessionId: owner.session.id };
    await assert.rejects(t.hub.desktop.perform(ctx, { op: "app.focus", helperOp: "focus", appId: "capcut", args: { hwnd: consent.hwnd } }), (e) => ["PROTECTED_TARGET", "OUT_OF_SCOPE"].includes(e.code));
    await assert.rejects(t.hub.desktop.perform(ctx, { op: "app.focus", helperOp: "focus", appId: "capcut", args: { hwnd: hubWin.hwnd } }), (e) => e.code === "PROTECTED_TARGET");
    await assert.rejects(t.hub.desktop.perform(ctx, { op: "app.focus", helperOp: "focus", appId: "capcut", args: { hwnd: keepass.hwnd } }), (e) => ["PROTECTED_TARGET", "OUT_OF_SCOPE"].includes(e.code));
    // The policy refuses a protected process name before any helper call.
    const { classifyAction } = await import("../server/policy/action-policy.mjs");
    assert.equal(classifyAction("app.focus", { app: t.hub.desktop.apps.get("capcut"), processName: "1Password" }).class, "REFUSED");
    assert.ok(actions(t).filter((a) => a.status === "FAILED").length >= 3);
  } finally { await t.cleanup(); }
});

test("M10-DO-05 sensitive controls: the policy refuses „Export to TikTok” / „Publish” before the helper; the helper refuses them too", async () => {
  const t = await makeDesktopHub();
  try {
    const owner = await readyDesktop(t);
    const { classifyAction } = await import("../server/policy/action-policy.mjs");
    const capcut = t.hub.desktop.apps.get("capcut");
    for (const name of ["Export to TikTok", "Publish", "Postează", "Șterge proiectul", "Buy Pro", "Sign in"]) assert.equal(classifyAction("ui.invoke", { app: capcut, controlName: name }).class, "REFUSED", name);
    assert.equal(classifyAction("ui.invoke", { app: capcut, controlName: "Import" }).class, "PLAN_STEP");
    // Inside a plan, an executor that tries the export button is refused by the gate (REFUSED) and never reaches the helper.
    t.hub.executors["test.invoke"] = {
      describe: () => ({ title: "Invoke", apps: ["capcut"], ops: [{ op: "app.launch", appId: "capcut" }, { op: "app.focus", appId: "capcut" }, { op: "desktop.observe", appId: "capcut" }, { op: "ui.invoke", appId: "capcut" }], observed: [], transmitted: [], outputs: [] }),
      run: async ({ planId, stepId, authorize, plan }) => {
        const ctx = { kind: "plan", planId, stepId, actor: `plan:${planId}`, folders: plan.authority.folders, authorize };
        await t.hub.desktop.perform(ctx, { op: "app.launch", helperOp: "launch", appId: "capcut", args: { kind: "exe", exe: capcut.exePath } });
        const w = (await t.hub.desktop.perform(ctx, { op: "app.focus", helperOp: "waitWindow", appId: "capcut", args: { processNames: ["CapCut"], timeoutMs: 1000 } })).window;
        await t.hub.desktop.perform(ctx, { op: "ui.invoke", helperOp: "invoke", appId: "capcut", controlName: "Export to TikTok", args: { hwnd: w.hwnd, selector: { name: "Export to TikTok" } } });
        return { result: {} };
      },
    };
    const done = await runPlan(t, owner, { steps: [{ kind: "test.invoke", params: {} }] });
    assert.equal(done.status, "FAILED");
    assert.match(done.steps[0].error, /DESKTOP_REFUSED|efect extern/);
    assert.equal(t.opLog().filter((e) => e.op === "invoke").length, 0, "the export button never reached the helper");
    // Directly at the helper (bypassing the policy): refused there as well.
    const w = (await t.hub.desktop.client.request("listWindows", { processNames: ["CapCut"] }, { plan: "t", step: "t", apps: ["CapCut"], exp: new Date(Date.now() + 60000).toISOString() })).windows[0];
    await assert.rejects(t.hub.desktop.client.request("invoke", { hwnd: w.hwnd, selector: { name: "Export to TikTok" } }, { plan: "t", step: "t", apps: ["CapCut"], exp: new Date(Date.now() + 60000).toISOString() }), (e) => e.code === "SENSITIVE_CONTROL");
  } finally { await t.cleanup(); }
});

/** A synthetic Notepad task in a temp folder that is an approved import root (no folder decision needed). */
function notepadTask(t, { name = "nota.txt", content = "Linia inițială\n" } = {}) {
  const dir = path.join(tempDir("m10-notepad"), "lucru");
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(dir, name);
  fs.writeFileSync(src, content, "utf8");
  setPolicy(t, { importRoots: [dir] });
  return { dir, src, saveAs: path.join(dir, "nota-salvata.txt") };
}

test("M10-DO-06 D2 Notepad: precondition → type Romanian text → verify → Save As → disk verified → move + re-identify; text never logged", async () => {
  const t = await makeDesktopHub();
  try {
    const owner = await readyDesktop(t);
    const task = notepadTask(t);
    const text = "Știință, țară, înțelegere — ăâîșț ĂÂÎȘȚ.";
    const done = await runPlan(t, owner, { kind: "desktop.notepad", title: "Notepad D2", steps: [{ kind: "desktop.notepad.edit_save", params: { sourceFile: task.src, text, mode: "append", saveAs: task.saveAs } }] });
    assert.equal(done.status, "DONE", `${done.statusReason} ${JSON.stringify(done.steps[0].error)}`);
    assert.equal(fs.readFileSync(task.saveAs, "utf8"), `Linia inițială\n${text}`);
    assert.equal(fs.readFileSync(task.src, "utf8"), "Linia inițială\n", "the source file is unchanged (Save As)");
    const steps = done.steps[0].evidence.map((e) => e.step);
    assert.deepEqual(steps, ["window", "precondition", "typed", "saved", "moved"]);
    assert.equal(done.steps[0].evidence.find((e) => e.step === "moved").sameProcess, true);
    // The helper log and the Hub's action log carry lengths / hashes, never the typed text.
    const raw = fs.readFileSync(path.join(t.dir, "operator.log"), "utf8") + JSON.stringify(actions(t)) + JSON.stringify(t.hub.db.prepare("SELECT payload_json FROM events WHERE type LIKE 'desktop.%' OR type LIKE 'ops.%'").all());
    assert.ok(!raw.includes("Știință"), "typed text is not in any log");
    assert.equal(done.consent.modality, "click");
    assert.equal(t.hub.desktop.sessionStatus()?.status ?? "ENDED", "ENDED");
  } finally { await t.cleanup(); }
});

test("M10-DO-07 D2 never overwrites: an existing destination makes the plan refuse at proposal (no form, no write)", async () => {
  const t = await makeDesktopHub();
  try {
    const owner = await readyDesktop(t);
    const task = notepadTask(t);
    fs.writeFileSync(task.saveAs, "existent", "utf8");
    await assert.rejects(asOwner(t, owner, "ops.plan.propose", { kind: "desktop.notepad", title: "D2", steps: [{ kind: "desktop.notepad.edit_save", params: { sourceFile: task.src, text: "x", saveAs: task.saveAs } }] }), (e) => e.code === "PLAN_REFUSED" && /suprascrie/.test(e.message));
    assert.equal(fs.readFileSync(task.saveAs, "utf8"), "existent");
    assert.equal(t.opLog().filter((e) => e.op === "launch").length, 0);
  } finally { await t.cleanup(); }
});

test("M10-DO-08 user input while typing suspends: step BLOCKED, plan NEEDS_OWNER, session PAUSED, nothing saved; „Continuă” re-verifies and finishes", async () => {
  const t = await makeDesktopHub({ scenario: { userInputAfterChars: 20 } });
  try {
    const owner = await readyDesktop(t);
    const task = notepadTask(t);
    const text = "Un text suficient de lung ca să fie întrerupt de tastatura ta.";
    const done = await runPlan(t, owner, { kind: "desktop.notepad", title: "D2 întrerupt", steps: [{ kind: "desktop.notepad.edit_save", params: { sourceFile: task.src, text, saveAs: task.saveAs } }] });
    assert.equal(done.status, "NEEDS_OWNER");
    assert.equal(done.steps[0].status, "BLOCKED");
    assert.match(done.steps[0].error, /USER_INPUT/);
    assert.equal(fs.existsSync(task.saveAs), false);
    assert.equal(t.hub.desktop.sessionStatus().status, "PAUSED");
    assert.ok(actions(t).some((a) => a.status === "SUSPENDED"));
    // While paused the operator refuses new work (one controller; the owner decides).
    await assert.rejects(asOwner(t, owner, "desktop.app.open", { app: "notepad" }), (e) => e.code === "DESKTOP_PAUSED");
    // „Continuă” (typed, owner session): the helper resumes, the blocked step is re-run from a fresh verification (new window from the
    // file on disk), never "continued" blindly in the half-typed one. The fixture's input trigger is one-shot per helper process.
    const r = await asOwner(t, owner, "owner.intent", { text: "Continuă", source: "typed" });
    assert.equal(r.results[0].intent, "ops_continue");
    assert.ok(!r.results[0].error, JSON.stringify(r.results[0]));
    const after = await t.hub.opsPlans.idle(done.id);
    if (after.status === "DONE") assert.equal(fs.readFileSync(task.saveAs, "utf8"), `Linia inițială\n${text}`);
    else assert.match(after.steps[0].error || "", /USER_INPUT|PRECONDITION/, "a second intervention stops again — never a blind retry");
  } finally { await t.cleanup(); }
});

test("M10-DO-09 identity change (HWND reused by another process) and a secure desktop suspend the work", async () => {
  const t = await makeDesktopHub();
  try {
    const owner = await readyDesktop(t);
    const opened = await asOwner(t, owner, "desktop.app.open", { app: "notepad" });
    t.control({ replaceWindow: opened.window.hwnd });
    // Observing is a plan step: a plan context whose authority covers it (the gate's own checks are exercised in m10-ops-plans).
    const ctx = { kind: "plan", planId: "opp_identity", stepId: "ops_identity", actor: "plan:test", folders: [], authorize: () => ({ expiresAt: new Date(Date.now() + 60000).toISOString() }) };
    await assert.rejects(t.hub.desktop.perform(ctx, { op: "desktop.observe", helperOp: "observe", appId: "notepad", args: { hwnd: opened.window.hwnd, pid: opened.window.pid, procStart: opened.window.procStart } }), (e) => e.code === "IDENTITY_CHANGED");
    assert.equal(t.hub.desktop.sessionStatus().status, "PAUSED");
    await asOwner(t, owner, "desktop.resume", {});
    t.hub.desktop.endSession("test");
    t.control({ secureDesktop: true });
    await assert.rejects(asOwner(t, owner, "desktop.app.focus", { app: "notepad" }), (e) => e.code === "SECURE_DESKTOP");
    assert.equal(t.hub.desktop.sessionStatus().status, "PAUSED");
  } finally { await t.cleanup(); }
});

test("M10-DO-10 a helper that dies or hangs mid-step: the step is UNCERTAIN (never DONE), the plan waits for the owner", async () => {
  const t = await makeDesktopHub({ scenario: { exitOn: "typeText" } });
  try {
    const owner = await readyDesktop(t);
    const task = notepadTask(t);
    const done = await runPlan(t, owner, { kind: "desktop.notepad", title: "D2 helper mort", steps: [{ kind: "desktop.notepad.edit_save", params: { sourceFile: task.src, text: "abc", saveAs: task.saveAs } }] });
    assert.equal(done.status, "NEEDS_OWNER");
    assert.equal(done.steps[0].status, "UNCERTAIN");
    assert.match(done.steps[0].error, /OPERATOR_EXITED/);
    assert.ok(actions(t).some((a) => a.status === "UNCERTAIN"));
  } finally { await t.cleanup(); }
  // A hanging operation: the client's timeout decides (short timeout through args.timeoutMs is bounded below by the client default),
  // checked at the client level so the test stays fast.
  const { createOperatorClient } = await import("../server/desktop/operator-client.mjs");
  const { createSupervisor } = await import("../server/runtime/supervisor.mjs");
  const { FAKE_OPERATOR } = await import("./m10-helpers.mjs");
  const dir = tempDir("m10-hang");
  const scen = path.join(dir, "s.json");
  fs.writeFileSync(scen, JSON.stringify({ hangOps: ["observe"] }));
  const config = { testMode: true, allowedTestBinaryDir: path.dirname(FAKE_OPERATOR), desktop: { launcher: { executable: process.execPath, prefixArgs: [FAKE_OPERATOR, `--scenario=${scen}`] } } };
  const sup = createSupervisor({ config });
  const client = createOperatorClient({ config, supervisor: sup, requestTimeoutMs: 400 });
  try {
    await client.start({});
    await assert.rejects(client.request("observe", { hwnd: 1 }, { plan: "p", step: "s", apps: ["x"], exp: new Date(Date.now() + 60000).toISOString() }), (e) => e.code === "OPERATOR_TIMEOUT");
  } finally { await client.close(); sup.stopAll?.(); }
});

test("M10-DO-11 Stop and „Preiau eu”: the helper pauses at once, typing stops, plans pause; applications are not closed", async () => {
  const t = await makeDesktopHub();
  try {
    const owner = await readyDesktop(t);
    const opened = await asOwner(t, owner, "desktop.app.open", { app: "notepad" });
    // Stop from the voice channel (fail-safe from every owner-facing channel).
    t.hub.desktop.ensureSession({ controller: "owner" });
    const s = await asChannel(t, "voice", "desktop.stop", { reason: "Stop (test)" });
    assert.equal(s.stopped, true);
    assert.equal(s.helperPaused, true);
    // Paused helper: effectful operations are refused until resume (the owner verifies the state first).
    await assert.rejects(t.hub.desktop.client.request("focus", { hwnd: opened.window.hwnd }, { plan: "t", step: "t", apps: ["Notepad"], exp: new Date(Date.now() + 60000).toISOString() }), (e) => e.code === "PAUSED");
    const win = (await t.hub.desktop.client.request("listWindows", { processNames: ["Notepad"] }, { plan: "t", step: "t", apps: ["Notepad"], exp: new Date(Date.now() + 60000).toISOString() })).windows;
    assert.equal(win.length, 1, "Notepad stays open (nothing force-closed)");
    const tk = await asChannel(t, "ui", "desktop.takeover", {});
    assert.equal(tk.takenOver, true);
    assert.equal(t.hub.desktop.sessionStatus(), null, "taken over: no active operator session");
    // Stop All also stops the operator.
    t.hub.desktop.ensureSession({ controller: "owner" });
    const all = await asChannel(t, "ui", "system.stop_all", { reason: "test" });
    assert.equal(all.desktop.stopped, true);
  } finally { await t.cleanup(); }
});

test("M10-DO-12 D6 CapCut via ONE plan: new test project + import of a synthetic file (structural controls), export never touched", async () => {
  const t = await makeDesktopHub();
  try {
    const owner = await readyDesktop(t);
    const dir = path.join(tempDir("m10-capcut"), "test");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "clip-test.mp4");
    fs.writeFileSync(file, "synthetic");
    setPolicy(t, { importRoots: [dir] });
    const done = await runPlan(t, owner, { kind: "desktop.capcut", title: "CapCut test", steps: [{ kind: "desktop.capcut.new_project_import", params: { file } }] });
    assert.equal(done.status, "DONE", done.statusReason);
    assert.equal(done.steps[0].result.completed, true, JSON.stringify(done.steps[0].result.steps));
    assert.equal(done.steps[0].result.verdict, "STRUCTURAL_CONTROLS");
    assert.ok(done.steps[0].result.steps.every((s) => s.ok));
    assert.equal(t.opLog().filter((e) => e.op === "invoke" && /Export/.test(JSON.stringify(e.args))).length, 0);
  } finally { await t.cleanup(); }
});

test("M10-DO-13 D8 „Deschide Studio” starts no model and no desktop work; „Arată folderul exporturilor” opens the exports folder, verified", async () => {
  const t = await makeDesktopHub();
  try {
    const owner = await readyDesktop(t);
    const exportsDir = path.join(tempDir("m10-exports"), "Exporturi");
    setPolicy(t, { exportsDir });
    const s = await asOwner(t, owner, "owner.intent", { text: "Deschide Studio", source: "typed" });
    assert.equal(s.results[0].intent, "studio_open");
    assert.equal(s.results[0].navigate, "/studio");
    assert.equal(t.opLog().filter((e) => e.op !== "discoverApps").length, 0, "no desktop operation for opening the Studio page");
    const f = await asOwner(t, owner, "owner.intent", { text: "Arată folderul exporturilor", source: "typed" });
    assert.equal(f.results[0].intent, "desktop_folder");
    assert.equal(f.results[0].desktop.verified, true, JSON.stringify(f.results[0]));
    assert.equal(path.resolve(f.results[0].desktop.folder).toLowerCase(), path.resolve(exportsDir).toLowerCase());
    assert.ok(fs.existsSync(exportsDir));
    // A protected folder is never shown.
    await assert.rejects(asOwner(t, owner, "desktop.folder.show", { folder: t.dataDir }), (e) => e.code === "DESKTOP_REFUSED");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0);
  } finally { await t.cleanup(); }
});

test("M10-DO-14 D9 no universal endpoint: no click/type/eval command, no agent/cli channel, no script step, no unauthenticated helper call", async () => {
  const t = await makeDesktopHub();
  try {
    const owner = await readyDesktop(t);
    const catalog = t.hub.commands.catalog().filter((c) => /^(desktop|ops)\./.test(c.type));
    assert.ok(catalog.length >= 15);
    for (const c of catalog) {
      assert.doesNotMatch(c.type, /click|type$|eval|script|exec|shell|keys|commit|push|deploy|publish/i, c.type);
      assert.ok(!c.channels.includes("agent") && !c.channels.includes("cli") && !c.channels.includes("schedule"), `${c.type}: ${c.channels}`);
    }
    // A plan step kind that does not exist (e.g. "desktop.eval" or a raw script) is refused at proposal.
    for (const kind of ["desktop.eval", "desktop.script", "shell.run", "desktop.click"]) await assert.rejects(asOwner(t, owner, "ops.plan.propose", { kind: "x", title: "x", steps: [{ kind, params: { code: "rm -rf /" } }] }), /Tip de pas necunoscut/);
    // An effectful helper operation without the Hub's authority is refused by the helper itself.
    await assert.rejects(t.hub.desktop.client.request("launch", { kind: "exe", exe: "C:\\Windows\\System32\\cmd.exe" }, null), (e) => e.code === "NO_AUTHORITY");
    await assert.rejects(t.hub.desktop.client.request("launch", { kind: "exe", exe: "x" }, { plan: "p", step: "s", apps: [], exp: new Date(Date.now() - 1000).toISOString() }), (e) => e.code === "AUTHORITY_EXPIRED");
  } finally { await t.cleanup(); }
});

test("M10-DO-15 boot recovery ends a desktop session; a changed binary withdraws the authorization; an untrusted signer is never authorized", async () => {
  const t = await makeDesktopHub({ signers: { obs: { trusted: false } } });
  try {
    const owner = await readyDesktop(t, ["notepad", "capcut"]);
    assert.equal(t.hub.desktop.apps.get("obs").status, "INSTALLED");
    assert.throws(() => t.hub.desktop.apps.authorize(["obs"], { sessionId: owner.session.id, via: "test" }), /identitatea executabilului nu e verificată/);
    t.hub.desktop.ensureSession({ controller: "owner" });
    const rec = t.hub.desktop.recover();
    assert.ok(rec.endedSession);
    assert.equal(t.hub.desktop.sessionStatus(), null);
    assert.equal(t.hub.desktop.apps.get("capcut").authorized, true);
    t.rebinary("capcut", "fake capcut binary v2 (updated)");
    await t.hub.desktop.discover("test");
    assert.equal(t.hub.desktop.apps.get("capcut").authorized, false, "a different binary must be authorized again");
    assert.equal(t.hub.desktop.apps.get("notepad").authorized, true);
  } finally { await t.cleanup(); }
});
