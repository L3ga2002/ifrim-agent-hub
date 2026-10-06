// M10.2 U15 — the web side of "one plan, one confirmation": plan cards everywhere, the old flow demoted to "advanced".
//
// Part A (always runs, no browser, no build): the pure page logic (web/src/lib/uiLogic.js) — the `lega.plan` shapes, where Lega's
// arrow may go while a plan is on screen, which toast opens what, which blocker option leads where, which gate refusal becomes
// „pregătește un plan” — the LEGA_TARGETS ↔ data-lega-target sync (with the new environment targets), source checks that keep the
// fail-safe controls visible and one click, and the cockpit's server read model (the plan, the ops plan, the armed window and the
// kept requests survive a reload).
//
// Part B (a REAL browser — headless Chromium through Playwright — against a throwaway test Hub serving the built UI; fixture
// providers, no model, nothing live): a `lega.plan` event shows and focuses the DecisionCard, the card survives a reload, Enter
// confirms with the exact id + nonce + hash in the owner session; FactoryPanel under voice-first proposes the plan and opens the
// cockpit (legacy unchanged); Integrations keeps "Revino la BUILD_SAFE", "Suspendă poarta" and Stop All one click away while the
// manual path is collapsed. Part B runs only against a build that contains U15 (HUB_V2_WEB_DIST may point at a fresh build; the
// live Hub's v2/web/dist is never rebuilt here) and is SKIPPED otherwise.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { makeTestHub, enrolOwner, waitFor, prepareLiveWithoutGrants, HUB_ROOT, WEB_DIST } from "./helpers.mjs";
import { planCoversRefusal, PLAN_RESOLVED_CHECKS, planRefOfLive, isCockpitHash, legaPointAction, legaPointPath, approvalToastTarget, blockerAction, LEGA_CHECK_HINTS, LEGA_APPROVAL_KINDS } from "../web/src/lib/uiLogic.js";
import { ENVELOPE_RESOLVES } from "../server/owner/envelopes.mjs";
import { explain, PLAN_RESOLVED_CHECKS as BLOCKER_PLAN_CHECKS } from "../server/owner/blockers.mjs";
import { LEGA_TARGETS, LEGA_LEGACY_ONLY_TARGETS } from "../server/policy/lega-policy.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { browserStatus, browserLaunchOptions } from "../server/tools/browser.mjs";

const V2 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (rel) => fs.readFileSync(path.join(V2, rel), "utf8");
const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };

// ---------------------------------------------------------------- Part A: pure logic
test("U15-01 lega.plan shapes → one plan ref; the cockpit address; Lega's arrow never leaves a presented plan or the cockpit", () => {
  // The intake's live event, the kept request's re-plan (live data) and the persisted bus event all name the same plan.
  assert.deepEqual(planRefOfLive({ type: "lega.plan", kind: "envelope", id: "env_abc_123", projectId: "prj_1", sessionId: "lgs_1" }),
    { kind: "envelope", id: "env_abc_123", projectId: "prj_1", sessionId: "lgs_1", workRequestId: null });
  assert.deepEqual(planRefOfLive({ type: "lega.plan", data: { workRequestId: "wrq_1", projectId: null, planRef: { kind: "ops", id: "opp_xyz_9" } } }),
    { kind: "ops", id: "opp_xyz_9", projectId: null, sessionId: null, workRequestId: "wrq_1" });
  assert.equal(planRefOfLive({ type: "lega.plan", scopeType: "work_request", payload: { planRef: { kind: "envelope", id: "env_q_1" }, projectId: "prj_2" } }).projectId, "prj_2");
  // Anything else, or an id that is not a plan id, is ignored (the page only ever reads a plan through its own route).
  for (const bad of [null, { type: "lega.point", id: "env_1" }, { type: "lega.plan" }, { type: "lega.plan", kind: "envelope", id: "../../x" }, { type: "lega.plan", kind: "grant", id: "grant_1" }]) assert.equal(planRefOfLive(bad), null);

  for (const h of ["", "#", "#/", "#/lega", "#/lega/prj_1", "#/lega/", "#/lega?x=1"]) assert.equal(isCockpitHash(h), true, h);
  for (const h of ["#/lega/setup", "#/integrations", "#/missions/mis_1", "#/system?tab=environments", "#/legacy"]) assert.equal(isCockpitHash(h), false, h);

  // P11 regression: a point with a path while a plan is presented, or while in the cockpit → an inline hint, never a navigation.
  assert.equal(legaPointAction({ path: "/integrations", presented: true, hash: "#/missions" }), "hint");
  assert.equal(legaPointAction({ path: "/integrations", presented: false, hash: "#/lega/prj_1" }), "hint");
  assert.equal(legaPointAction({ path: "/integrations", presented: false, hash: "#/missions" }), "navigate");
  // A top-bar element (no path) is always just pointed at (Stop All stays reachable from anywhere).
  assert.equal(legaPointAction({ path: null, presented: true, hash: "#/lega" }), "point");
  // The isolation panel is named in the address (scroll + the probe's integrations.isolation), other paths are kept as they are.
  assert.equal(legaPointPath("isolation", "/integrations"), "/integrations?panel=isolation");
  assert.equal(legaPointPath("billing", "/integrations"), "/integrations");
  assert.equal(legaPointPath("stop-all", null), null);
});

test("U15-02 toasts and blocker options: Lega proposals open the Lega panel; every blocker option is ONE next action", () => {
  assert.deepEqual([...LEGA_APPROVAL_KINDS], ["lega.run_request", "lega.mission_request"]);
  assert.equal(approvalToastTarget({ type: "approval.requested", source: "lega:voice", payload: { actionKind: "lega.mission_request" } }), "lega");
  assert.equal(approvalToastTarget({ type: "approval.requested", source: "user", payload: { actionKind: "lega.run_request" } }), "lega");
  assert.equal(approvalToastTarget({ type: "approval.requested", source: "user", payload: { actionKind: "factory.scope" } }), "approvals");
  assert.equal(approvalToastTarget({ type: "approval.requested", source: "sales", payload: { actionKind: "process.run" } }), "approvals");

  // Real explainer output for the owner's live situation (real project on the Windows route, Observ, gate after Stop All).
  const ex = explain({ intent: "engineering", project: { name: "ProDelivery", source: "registry", route: "windows" }, autonomy: "OBSERVE", gate: { status: "suspended", suspendedBy: "stop_all" } });
  const byCode = (code, kind) => ex.options.find((o) => o.code === code && (!kind || o.kind === kind));
  assert.deepEqual(blockerAction(byCode("HOST_R2_OPEN", "owner_decision_separate")), { type: "link", href: "#/system?tab=environments" }, "R2 → the environment route, System → Medii");
  assert.deepEqual(blockerAction(byCode("HOST_R2_OPEN", "admin")), { type: "link", href: "#/integrations?panel=isolation" }, "the risk acceptance is the admin escape hatch");
  assert.deepEqual(blockerAction(byCode("AUTONOMY_OBSERVE")), { type: "autonomy", level: "ASSISTED" }, "autonomy is an inline Windows Hello decision");
  // M10.2.1 (D14, deliberate change): a suspended gate is never a link to an administration page. Without the rearm eligibility in the
  // facts the Hub's honest reason is information only; when the card can reopen it the option is { type: "rearm" } (m10-2-p0-ui P0UI-01).
  assert.deepEqual(blockerAction(byCode("GATE_SUSPENDED")), { type: "info" }, "after Stop All: no admin link (the cockpit's rearm card reopens the gate)");
  // After the owner's own pause: „Continuă” (D13), said in the conversation.
  const paused = explain({ intent: "engineering", project: { name: "T", source: "hub-test", route: "windows" }, autonomy: "ASSISTED", gate: { status: "suspended", suspendedBy: "owner_pause" } });
  assert.deepEqual(blockerAction(paused.options.find((o) => o.code === "GATE_SUSPENDED")), { type: "say", text: "Continuă" });
  // A kept request stores options WITHOUT `where`: the same place is found by code.
  assert.deepEqual(blockerAction({ kind: "owner_decision_separate", code: "ENV_POLICY_B_NEEDED", label: "x" }), { type: "link", href: "#/system?tab=environments" });
  assert.deepEqual(blockerAction({ kind: "automatic_readiness", code: "ACCOUNT_CHECK_STALE", label: "x" }), { type: "auto" });
  assert.deepEqual(blockerAction({ kind: "refused", code: "HUB_SELF_TARGET", label: "x" }), { type: "refused" });
  assert.deepEqual(blockerAction({ kind: "owner_decision_inline", code: "PLAN_INCOMPLETE_MODELS", label: "x" }), { type: "info" }, "the role defaults are shown and confirmed with the plan");
  // A `where` that is not an in-app address is never followed.
  assert.deepEqual(blockerAction({ kind: "admin", code: "UNKNOWN", where: "https://example.test/" }), { type: "info" });
  assert.deepEqual(blockerAction({ kind: "admin", code: "UNKNOWN", where: "javascript:alert(1)" }), { type: "info" });
  // Every option the explainer can produce for a wide fact matrix maps to a known action type (none is dropped).
  const facts = [ex, paused, explain({ intent: "studio", media: { assets: 0, editProjects: 0, tools: "UNPINNED" } }), explain({ intent: "engineering", project: { name: "Hub", isHub: true, source: "registry", route: "windows" } })];
  for (const f of facts) for (const o of f.options) assert.ok(["link", "autonomy", "say", "auto", "refused", "info"].includes(blockerAction(o).type), `${o.code}/${o.kind}`);

  // Hints: the isolation hint points to System → Medii (route + attestation), never to typing a mode or a grant.
  assert.match(LEGA_CHECK_HINTS.isolation, /Sistem → Medii/);
  assert.match(LEGA_CHECK_HINTS.execution_gate, /Continuă/);
});

test("U15-03 gate refusal mapping: only checks a plan arranges → „pregătește un plan”; isolation, billing, the gate stay raw", () => {
  // One list, three places (the page, the envelope service, the blocker explainer).
  assert.deepEqual([...PLAN_RESOLVED_CHECKS].sort(), [...ENVELOPE_RESOLVES].sort());
  assert.deepEqual([...PLAN_RESOLVED_CHECKS].sort(), [...BLOCKER_PLAN_CHECKS].sort());
  const ok = (id) => ({ id, ok: true, detail: "" });
  const no = (id) => ({ id, ok: false, detail: `${id} refuzat` });
  assert.equal(planCoversRefusal([no("mode"), no("live_grant"), ok("billing_route")]), true, "BUILD_SAFE + no grant → a plan");
  assert.equal(planCoversRefusal([no("writer:live_grant"), no("backup")]), true);
  assert.equal(planCoversRefusal([no("mode"), no("host_isolation")]), false, "isolation is a real blocker");
  assert.equal(planCoversRefusal([no("billing_route")]), false, "billing is a real blocker");
  assert.equal(planCoversRefusal([no("execution_gate"), no("mode")]), false, "the gate after Stop All is a real blocker");
  assert.equal(planCoversRefusal([ok("mode")]), false, "nothing failed → nothing to plan");
  assert.equal(planCoversRefusal([]), false);
  assert.equal(planCoversRefusal(null), false);
  // Composer and the retry notice use the mapping (the raw checks stay one click away under „Detalii”).
  assert.match(source("web/src/screens/focus/Composer.jsx"), /planCoversRefusal\(checks\)/);
  assert.match(source("web/src/screens/focus/Composer.jsx"), /<GateRefusal checks=\{refusal\}/);
  assert.match(source("web/src/screens/focus/FocusScreen.jsx"), /<GateRefusal checks=\{retryRefusal\}/);
});

test("U15-04 LEGA_TARGETS ↔ data-lega-target (incl. environment-route / environment-attest); fail-safe controls stay visible, one click", () => {
  const web = path.join(V2, "web", "src");
  const all = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.jsx?$/.test(e.name)) all.push(fs.readFileSync(p, "utf8")); } };
  walk(web);
  const ui = all.join("\n");
  for (const key of Object.keys(LEGA_TARGETS)) assert.ok(ui.includes(`data-lega-target="${key}"`), `UI marks ${key}`);
  // The real fix for host isolation is marked where it lives (System → Medii), so the arrow and the explainer can point at it.
  const envs = source("web/src/screens/system/Environments.jsx");
  assert.match(envs, /data-lega-target="environment-route"/);
  assert.match(envs, /data-lega-target="environment-attest"/);

  // Integrations under voice-first: the safety row (BUILD_SAFE, suspend, Stop All) is rendered OUTSIDE the collapsed manual path,
  // and the grants list with „Revocă” after it; the legacy-only targets (mode, gate, grant form) are inside `manual`.
  const integ = source("web/src/screens/Integrations.jsx");
  const safety = integ.slice(integ.indexOf('aria-label="Comenzi de siguranță"'), integ.indexOf("Avansat (cale manuală / diagnostic): mod, poartă, grant nou"));
  assert.match(safety, /Revino la BUILD_SAFE/);
  assert.match(safety, /Suspendă poarta/);
  assert.match(safety, /<StopAllButton \/>/);
  const manual = integ.slice(integ.indexOf("const manual = ("), integ.indexOf("return (\n    <Panel title=\"Validare live"));
  for (const key of LEGA_LEGACY_ONLY_TARGETS.filter((k) => k !== "grants-list")) assert.ok(manual.includes(`data-lega-target="${key}"`), `${key} is in the manual (advanced) path`);
  const afterAdvanced = integ.slice(integ.indexOf(") : manual}"));
  assert.match(afterAdvanced, /data-lega-target="grants-list"/, "the grants list (revoke) is outside the collapsed block");
  assert.match(afterAdvanced, />Revocă</);
  assert.match(integ, /risc acceptat, nu izolare/, "R2 is relabelled");
  // The palette keeps the safe-direction commands and the top bar keeps Stop All (unchanged).
  const shell = source("web/src/shell/Shell.jsx");
  assert.match(shell, /id: "pause", label: "Pauză: suspendă poarta/);
  assert.match(shell, /id: "safe", label: "Mod: revino la BUILD_SAFE"/);
  assert.match(shell, /data-lega-target="stop-all"/);

  // The cockpit: no page-side forwarder under voice-first (the server bridge handles every final sentence once).
  const cockpit = source("web/src/screens/Lega.jsx");
  assert.match(cockpit, /if \(serverBridgeRef\.current\) return;/);
  assert.match(cockpit, /planRefOfLive\(e\)/);
  // Lega's panel: the arrow goes through legaPointAction (never a bare navigation while a plan is shown).
  const panel = source("web/src/shell/Lega.jsx");
  assert.match(panel, /legaPointAction\(\{ path, presented: Boolean\(presentedPlan\(\)\), hash: window\.location\.hash \}\)/);
  assert.doesNotMatch(panel, /lega\.point" && e\.target\) \{ if \(e\.path\) go\(e\.path\)/, "the M10 unconditional navigation is gone");
  // FactoryPanel: under voice-first the scope is ONE plan; the M03 scope approval stays reachable, collapsed.
  const factory = source("web/src/screens/factory/FactoryPanel.jsx");
  assert.match(factory, /api\("\/api\/envelopes", \{ method: "POST"/);
  assert.match(factory, /Avansat: aprobare fără plan/);
  assert.match(factory, /Granturi pe care planul le derivă/);
});

test("U15-05 cockpit read model: the plan, the ops plan (with its armed window since this boot) and the kept requests survive a reload", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    t.hub.executors["test.probe"] = {
      describe: ({ n = 1 } = {}) => ({ title: `Sondă ${n}`, params: { n }, ops: [{ op: "media.render" }], observed: ["nimic"], transmitted: [], outputs: [`rezultat ${n}`] }),
      run: async ({ authorize }) => { authorize({ op: "media.render" }); return { result: {} }; },
    };
    const project = t.hub.projects.list().find((p) => p.executionAllowed) || t.hub.projects.list()[0];
    let c = await t.hub.cockpit.projectCockpit(project.id);
    assert.equal(c.proposedOpsPlan, null);
    assert.deepEqual(c.workRequests, []);

    // An operation plan waiting for the owner is reported company-wide (an ops plan has no project).
    const opp = (await t.hub.commands.dispatch({ type: "ops.plan.propose", channel: "test", actor: `owner:${owner.session.id}`, ownerSession: owner.session,
      payload: { kind: "test.plan", title: "Plan de test U15", steps: [{ kind: "test.probe", params: { n: 1 } }], limits: {} } })).result;
    const planId = opp.plan?.id || opp.id;
    c = await t.hub.cockpit.projectCockpit(project.id);
    assert.equal(c.proposedOpsPlan.planId, planId);
    assert.equal(c.proposedOpsPlan.title, "Plan de test U15");
    assert.equal(c.proposedOpsPlan.armedUntil, null);
    assert.ok(!("nonce" in c.proposedOpsPlan), "never the plan's nonce in the read model");

    // The armed window: the last window event SINCE THIS BOOT decides (a refused unclear sentence leaves it as it was).
    const until = new Date(Date.now() + 60000).toISOString();
    t.hub.bus.emit({ type: "system.booted", scopeType: "system", scopeId: "boot_test", source: "hub", payload: {} });
    t.hub.bus.emit({ type: "ops.plan.confirmation_armed", scopeType: "ops_plan", scopeId: planId, source: "test", payload: { expiresAt: until } });
    t.hub.bus.emit({ type: "ops.plan.armed_refused", scopeType: "ops_plan", scopeId: planId, source: "test", payload: { closed: false } });
    c = await t.hub.cockpit.projectCockpit(project.id);
    assert.equal(c.proposedOpsPlan.armedUntil, until);
    t.hub.bus.emit({ type: "ops.plan.confirmation_disarmed", scopeType: "ops_plan", scopeId: planId, source: "test", payload: {} });
    c = await t.hub.cockpit.projectCockpit(project.id);
    assert.equal(c.proposedOpsPlan.armedUntil, null, "disarmed → closed");
    // An expired window is not reported either.
    t.hub.bus.emit({ type: "ops.plan.confirmation_armed", scopeType: "ops_plan", scopeId: planId, source: "test", payload: { expiresAt: new Date(Date.now() - 1000).toISOString() } });
    c = await t.hub.cockpit.projectCockpit(project.id);
    assert.equal(c.proposedOpsPlan.armedUntil, null);

    // A kept request (blocked, explained once) with its causes and options as kind/code/label — never the consent body.
    const wr = t.hub.workRequests.create({ text: "Fă un videoclip promo de 30 de secunde", source: "typed", channel: "owner", projectId: project.id, intent: "engineering", actor: "owner:test" });
    t.hub.workRequests.explainOnce(wr.id, { blocked: true, signature: "AUTONOMY_OBSERVE", cause: "AUTONOMY_OBSERVE", causes: ["AUTONOMY_OBSERVE"], text: "Nu pot porni încă.", short: "Încă blocat.",
      options: [{ kind: "owner_decision_inline", code: "AUTONOMY_OBSERVE", label: "Ridică autonomia la Asistat", where: "#/ignored" }], automaticOnly: false });
    const company = t.hub.workRequests.create({ text: "Clip pentru Studio", source: "typed", channel: "owner", projectId: null, intent: "studio", actor: "owner:test" });
    c = await t.hub.cockpit.projectCockpit(project.id);
    const kept = c.workRequests.find((r) => r.id === wr.id);
    assert.equal(kept.status, "BLOCKED");
    assert.equal(kept.text, "Fă un videoclip promo de 30 de secunde");
    assert.deepEqual(kept.causes, ["AUTONOMY_OBSERVE"]);
    assert.deepEqual(kept.options, [{ kind: "owner_decision_inline", code: "AUTONOMY_OBSERVE", label: "Ridică autonomia la Asistat" }]);
    assert.equal(c.workRequests.find((r) => r.id === company.id).company, true, "company-wide requests (Studio) are shown too");
    // Cancelled / expired requests drop out.
    t.hub.workRequests.cancel(company.id, "owner:test");
    c = await t.hub.cockpit.projectCockpit(project.id);
    assert.equal(c.workRequests.some((r) => r.id === company.id), false);
    // Read-only: building the cockpit wrote no event and no command.
    const before = t.hub.bus.lastSeq();
    await t.hub.cockpit.projectCockpit(project.id);
    assert.equal(t.hub.bus.lastSeq(), before);
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- Part B: the real UI
const status = browserStatus({ hubRoot: HUB_ROOT });
const built = fs.existsSync(path.join(WEB_DIST, "index.html"));
/** The build must contain U15 (an older dist would test the old UI): a marker string from the voice-first Integrations copy. */
const hasU15 = () => {
  try {
    const dir = path.join(WEB_DIST, "assets");
    return fs.readdirSync(dir).filter((f) => f.endsWith(".js")).some((f) => fs.readFileSync(path.join(dir, f), "utf8").includes("Avansat (cale manuală / diagnostic)"));
  } catch { return false; }
};
const skip = !status.installed || !status.cachedBrowsers.length ? "SKIPPED_ENV: Playwright/Chromium is missing"
  : !built ? `SKIPPED_ENV: the built UI is missing (${WEB_DIST})`
    : !hasU15() ? `SKIPPED_ENV: the built UI predates U15 (${WEB_DIST}); set HUB_V2_WEB_DIST to a fresh build`
      : false;

test("U15-E2E-01 lega.plan → focused card → reload keeps it → Enter confirms id+nonce+hash; FactoryPanel plan; Integrations fail-safe controls", { skip, timeout: 300000 }, async () => {
  const t = await makeTestHub({ queues: true });
  const { server } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  const pw = createRequire(path.join(HUB_ROOT, "package.json"))("playwright");
  const origin = `http://localhost:${t.config.port}`;
  const browser = await pw.chromium.launch(browserLaunchOptions(origin));
  const pageErrors = [];
  try {
    await prepareLiveWithoutGrants(t.hub);
    const projectOf = async (name) => {
      const dir = path.join(t.dataDir, name);
      materializeFixture("bug-demo", dir);
      const project = (await t.hub.commands.dispatch({ type: "project.register_test", channel: "test", actor: "test", payload: { path: dir, name: `Demo ${name}` } })).result;
      await t.hub.commands.dispatch({ type: "factory.prepare", channel: "test", actor: "test", payload: { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS } });
      return { project, missionId: t.hub.factory.list().find((f) => f.projectId === project.id).missionId };
    };
    const A = await projectOf("u15-a");
    const B = await projectOf("u15-b");
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", (e) => pageErrors.push(String(e?.message || e)));
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await page.goto(`${origin}/#/lega/setup`);
    await page.getByText("Windows Hello / cheia ta înregistrată").first().waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: /Înregistrează acest calculator/ }).click();
    await page.getByText(/sesiune deschisă până la/).waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: /Accept și activez/ }).click();
    await page.getByText(/activă \(v1\)/).waitFor({ timeout: 20000 });

    // 1 · The cockpit with nothing proposed; a plan made elsewhere (the voice bridge) is announced as `lega.plan`.
    await page.goto(`${origin}/#/lega/${A.project.id}`);
    await page.getByLabel("Mesaj pentru Lega").waitFor({ timeout: 20000 });
    const out = await t.hub.envelopes.propose({ projectId: A.project.id, missionIds: [A.missionId], actor: "test", via: "test" });
    const env = out.envelope;
    assert.ok(env?.id, "a plan was proposed");
    const announce = () => t.hub.live.publish({ type: "lega.plan", kind: "envelope", id: env.id, projectId: A.project.id, sessionId: null });
    announce();
    const confirmButton = page.getByRole("button", { name: /Da, execută planul/ });
    await confirmButton.waitFor({ timeout: 20000 });
    const focused = () => page.evaluate(() => document.activeElement?.classList?.contains("decision") === true);
    // Review #38 (deliberate change): a plan this tab did not ask for (sessionId null, no send of this tab in flight) is SHOWN, never
    // focused — the owner's next Enter must not confirm something they did not just request.
    await page.waitForTimeout(800);
    assert.equal(await focused(), false, "a plan from elsewhere is shown without taking the focus");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0, "showing the plan started nothing");

    // 2 · A reload (or the end of the voice session) keeps the card: it is restored from the Hub, never re-created.
    await page.reload();
    await confirmButton.waitFor({ timeout: 20000 });
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM mission_envelopes WHERE project_id = ?").get(A.project.id).n, 1, "the same plan, not a new one");

    // 3 · Announced while THIS tab's own request is in flight (a typed request: sessionId null; review #38/#39) → focused, and the
    // focus stays on the card after the answer → Enter confirms exactly this plan in the owner session.
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    await page.route("**/api/owner/intent", async (route) => {
      announce();
      await waitFor(focused, 10000, 100).catch(() => {});
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ resolved: { steps: [], refused: [] }, results: [], layout: null }) });
    });
    await page.getByLabel("Mesaj pentru Lega").fill("Arată-mi planul");
    await page.getByLabel("Mesaj pentru Lega").press("Enter");
    await waitFor(focused, 10000, 100);
    await waitFor(async () => !(await page.getByLabel("Mesaj pentru Lega").isDisabled()), 10000, 100);
    assert.equal(await focused(), true, "the card keeps the focus after the request ends");
    await page.unroute("**/api/owner/intent");
    await waitFor(async () => confirmButton.isEnabled(), 10000);
    await page.keyboard.press("Enter");
    await waitFor(() => t.hub.envelopes.get(env.id).status !== "PROPOSED", 20000, 100);
    const confirms = t.hub.db.prepare("SELECT channel, payload_json FROM commands WHERE type = 'envelope.confirm'").all();
    assert.equal(confirms.length, 1, "ONE confirmation");
    assert.equal(confirms[0].channel, "owner");
    const p = JSON.parse(confirms[0].payload_json);
    assert.equal(p.envelopeId, env.id);
    assert.equal(p.nonce, env.nonce);
    assert.equal(p.displayedHash, env.envelopeHash);
    assert.equal(p.modality, "keyboard");

    // 4 · FactoryPanel under voice-first: ONE button proposes the plan and opens the cockpit (no scope approval, no grant).
    await page.goto(`${origin}/#/missions/${B.missionId}`);
    const planButton = page.getByRole("button", { name: /Arată-mi planul \(o confirmare\)/ });
    await planButton.waitFor({ timeout: 20000 });
    assert.equal(await page.getByRole("button", { name: "Cere aprobarea scope-ului" }).isVisible(), false, "the M03 scope approval is collapsed");
    await planButton.click();
    await waitFor(() => page.evaluate((id) => window.location.hash === `#/lega/${id}`, B.project.id), 15000, 100);
    await page.getByRole("button", { name: /Da, execută planul/ }).waitFor({ timeout: 20000 });
    const proposeCmd = t.hub.db.prepare("SELECT channel FROM commands WHERE type = 'envelope.propose' ORDER BY created_at DESC LIMIT 1").get();
    assert.equal(proposeCmd.channel, "owner");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE action_kind = 'factory.scope' AND decided_via IS NULL AND status = 'pending'").get().n, 0, "no scope approval was requested");

    // 5 · Integrations under voice-first: the fail-safe controls are visible and one click; the manual path is collapsed.
    t.hub.bus.transaction(() => t.hub.settings.set("mode", "LIVE_VALIDATION", "test"));
    await page.goto(`${origin}/#/integrations`);
    const safety = page.getByRole("group", { name: "Comenzi de siguranță" });
    await safety.waitFor({ timeout: 20000 });
    assert.equal(await page.getByRole("button", { name: "Activează LIVE_VALIDATION" }).isVisible().catch(() => false), false);
    assert.equal(await page.getByRole("button", { name: "Creează grant" }).isVisible().catch(() => false), false, "the grant form is under „Avansat”");
    assert.ok(await safety.getByRole("button", { name: "Stop All" }).isVisible(), "Stop All on the page");
    assert.ok(await page.locator("header").getByRole("button", { name: "Stop All" }).first().isVisible(), "and in the top bar");
    await safety.getByRole("button", { name: "Revino la BUILD_SAFE" }).click();
    await waitFor(() => t.hub.settings.get("mode") === "BUILD_SAFE", 10000, 100);
    await safety.getByRole("button", { name: "Suspendă poarta" }).click();
    await waitFor(() => t.hub.settings.get("executionGate").status !== "open", 10000, 100);

    // 6 · The legacy policy (the owner's fail-safe) keeps the M03 panel as it was.
    await t.hub.commands.dispatch({ type: "owner.policy.deactivate", channel: "test", actor: "test", payload: { reason: "test" } });
    await page.goto(`${origin}/#/missions/${B.missionId}`);
    await page.getByRole("button", { name: "Cere aprobarea scope-ului" }).waitFor({ timeout: 20000 });
    assert.equal(await page.getByRole("button", { name: /Arată-mi planul \(o confirmare\)/ }).count(), 0);
    await page.goto(`${origin}/#/integrations`);
    await page.getByRole("button", { name: "Activează LIVE_VALIDATION" }).waitFor({ timeout: 20000 });
    assert.equal(await page.getByRole("group", { name: "Comenzi de siguranță" }).count(), 0);

    // What the owner did, from the server's own log: no grant form, no manual mode change from the UI before step 5, no approval click.
    const forms = t.hub.db.prepare("SELECT type, channel FROM commands WHERE type IN ('grant.create','approval.decide')").all();
    assert.deepEqual(forms, []);
    assert.deepEqual(pageErrors, [], "no uncaught page errors");
  } finally {
    await browser.close();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    await t.cleanup();
  }
});
