// Milestone 10.2 — review group G5 (findings #37, #38, #39, #40, #41, #42). PASS_SIMULATED: fixture providers, the software
// authenticator, test projects and test executors; no model, nothing live.
//  - #37: the focus goes to ONE named card ({ kind, id, tick }): an ops plan just announced never loses the focus to a DecisionCard
//    on screen (Enter used to confirm the other plan);
//  - #38: only a plan THIS tab asked for (its own Lega session, a send() in flight, the owner's own click) takes the focus; never away
//    from text typed in the composer; a stale request is never re-fired by a card restored later;
//  - #39: a plan of another project switches the cockpit only for this tab's own request and never while another plan is on screen
//    (a „Deschide planul” toast instead);
//  - #40: a plan with an OBS step is never confirmed without the password (typed, spoken, armed window): OBS_PASSWORD_NEEDED, the plan
//    stays PROPOSED; the card shape names the secrets so the cockpit's typed-„Da” guard fires;
//  - #41: a plan of this tab's own voice session closes the full-screen stage; a plan from elsewhere never focuses a hidden card;
//  - #42: „Ridică la Asistat” (atLeast) never lowers a higher level, never revokes or supersedes; offered only on Observ.
// Part B drives the BUILT UI in headless Chromium against a throwaway test Hub; it runs only against a build that contains G5
// (HUB_V2_WEB_DIST may point at a fresh scratch build; the live Hub's v2/web/dist is never rebuilt here) and is SKIPPED otherwise.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { makeTestHub, enrolOwner, waitFor, prepareLiveWithoutGrants, HUB_ROOT, WEB_DIST } from "./helpers.mjs";
import { cockpitPlanAction, cardFocusWanted, holdsTypedText, shellPlanAction, autonomyRaiseOffered, FOCUS_REQUEST_MAX_AGE_MS } from "../web/src/lib/uiLogic.js";
import { planNeedsObsPassword } from "../web/src/lib/opsLogic.js";
import { secretsNeeded } from "../server/ops/plans.mjs";
import { createOpsIntentActions } from "../server/ops/intent-actions.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { browserStatus, browserLaunchOptions } from "../server/tools/browser.mjs";

const V2 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (rel) => fs.readFileSync(path.join(V2, rel), "utf8");
const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const asOwner = (t, owner, type, payload, session = owner.session) => t.hub.commands.dispatch({ type, payload, channel: "owner", actor: `owner:${session.id}`, ownerSession: session }).then((r) => r.result);
const refusal = async (p) => { try { await p; } catch (e) { return e; } assert.fail("expected a refusal"); return null; };

// ---------------------------------------------------------------- Part A: page logic
test("G5-37 the focus names ONE card: an ops request never focuses the DecisionCard (and back); once per request; a stale one never re-fires", () => {
  const now = 1_000_000;
  const opsReq = { kind: "ops", id: "opp_new_1", tick: 7, at: now };
  // The scenario of #37: the ops plan just announced and the envelope card already on screen both see the SAME request.
  assert.equal(cardFocusWanted(opsReq, { kind: "envelope", id: "env_old_1", now }), false, "the DecisionCard does not take the ops plan's focus");
  assert.equal(cardFocusWanted(opsReq, { kind: "ops", id: "opp_new_1", now }), true, "the ops card does");
  assert.equal(cardFocusWanted({ kind: "envelope", id: "env_old_1", tick: 8, at: now }, { kind: "ops", id: "opp_new_1", now }), false);
  assert.equal(cardFocusWanted(opsReq, { kind: "ops", id: "opp_other", now }), false, "another ops plan on the card: not this request");
  // Once per request: a re-render (or a later restore of the same plan) does not move the focus again.
  assert.equal(cardFocusWanted(opsReq, { kind: "ops", id: "opp_new_1", handledTick: 7, now }), false);
  // A request older than the bound (a plan restored later from the read model, a card that mounted late) never re-fires.
  assert.equal(cardFocusWanted(opsReq, { kind: "ops", id: "opp_new_1", now: now + FOCUS_REQUEST_MAX_AGE_MS + 1 }), false);
  for (const bad of [null, undefined, {}]) assert.equal(cardFocusWanted(bad, { kind: "ops", id: "opp_new_1", now }), false);
  assert.equal(cardFocusWanted(opsReq, { kind: "ops", id: null, now }), false);

  // The real cards use it with their OWN kind and id; nothing passes the old shared counter any more.
  const cards = source("web/src/screens/lega/cards.jsx");
  const opsCard = source("web/src/screens/lega/OpsPlanCard.jsx");
  const cockpit = source("web/src/screens/Lega.jsx");
  assert.match(cards, /cardFocusWanted\(focusTarget, \{ kind: "envelope", id: env\?\.id/);
  assert.match(opsCard, /cardFocusWanted\(focusTarget, \{ kind: "ops", id: plan\?\.id/);
  for (const [name, src] of [["cards", cards], ["OpsPlanCard", opsCard], ["Lega", cockpit]]) assert.doesNotMatch(src, /focusTick/, `${name}: no shared focus counter`);
  assert.match(cockpit, /requestFocus\("ops", opsPlan\.id\)/, "the typed-„Da” OBS branch names the ops plan");
  assert.match(cockpit, /requestFocus\("envelope", env\.id\)/);
});

test("G5-38 only a plan THIS tab asked for takes the focus; never away from typed text", () => {
  const ref = (extra = {}) => ({ kind: "envelope", id: "env_a_1", projectId: "prj_a", sessionId: null, ...extra });
  // A kept request that became plannable / another tab: sessionId null (or another session), nothing in flight → shown, no focus.
  assert.deepEqual(cockpitPlanAction({ ref: ref(), pid: "prj_a", legaSessionId: "lgs_me" }), { action: "show", focus: false });
  assert.deepEqual(cockpitPlanAction({ ref: ref({ sessionId: "lgs_other" }), pid: "prj_a", legaSessionId: "lgs_me" }), { action: "show", focus: false });
  assert.deepEqual(cockpitPlanAction({ ref: ref({ sessionId: "lgs_other" }), pid: "prj_a", legaSessionId: null }), { action: "show", focus: false });
  // This tab's own voice session, this tab's send in flight (typed: sessionId null), the owner's own click → focus.
  assert.deepEqual(cockpitPlanAction({ ref: ref({ sessionId: "lgs_me" }), pid: "prj_a", legaSessionId: "lgs_me" }), { action: "show", focus: true });
  assert.deepEqual(cockpitPlanAction({ ref: ref(), pid: "prj_a", legaSessionId: null, sendInFlight: true }), { action: "show", focus: true });
  assert.deepEqual(cockpitPlanAction({ ref: ref(), pid: "prj_a", explicit: true }), { action: "show", focus: true });
  // An ops plan (company-wide) follows the same rule wherever the cockpit is.
  assert.deepEqual(cockpitPlanAction({ ref: { kind: "ops", id: "opp_1", projectId: null, sessionId: null }, pid: "prj_a" }), { action: "show", focus: false });
  assert.deepEqual(cockpitPlanAction({ ref: { kind: "ops", id: "opp_1", projectId: "prj_b", sessionId: null }, pid: "prj_a", sendInFlight: true }), { action: "show", focus: true });
  assert.deepEqual(cockpitPlanAction({ ref: { kind: "grant", id: "grant_1" } }), { action: "ignore" });

  // Typed text outside the card holds the focus (the composer, a textarea, a contentEditable); an empty field, a button or an
  // element INSIDE the card does not.
  const card = { contains: (el) => el?.inCard === true };
  assert.equal(holdsTypedText({ tagName: "INPUT", type: "text", value: "Hai să lucrăm" }, card), true);
  assert.equal(holdsTypedText({ tagName: "TEXTAREA", value: "x" }, card), true);
  assert.equal(holdsTypedText({ tagName: "DIV", isContentEditable: true, textContent: " notă " }, card), true);
  assert.equal(holdsTypedText({ tagName: "INPUT", type: "text", value: "" }, card), false);
  assert.equal(holdsTypedText({ tagName: "INPUT", type: "checkbox", value: "on" }, card), false);
  assert.equal(holdsTypedText({ tagName: "BUTTON", value: "x" }, card), false);
  assert.equal(holdsTypedText({ tagName: "INPUT", type: "password", value: "p", inCard: true }, card), false, "the card's own password field");
  assert.equal(holdsTypedText(null, card), false);
  // Both cards check it before taking the focus.
  assert.match(source("web/src/screens/lega/cards.jsx"), /holdsTypedText\(document\.activeElement, ref\.current\)/);
  assert.match(source("web/src/screens/lega/OpsPlanCard.jsx"), /holdsTypedText\(document\.activeElement, box\.current\)/);
});

test("G5-39 a plan of another project: navigate only for this tab's own request and never over a plan on screen; otherwise a toast", () => {
  const b = { kind: "envelope", id: "env_b_1", projectId: "prj_b", sessionId: null };
  assert.deepEqual(cockpitPlanAction({ ref: b, pid: "prj_a", legaSessionId: "lgs_me" }), { action: "toast", path: "/lega/prj_b" }, "an automatic re-plan of B");
  assert.deepEqual(cockpitPlanAction({ ref: { ...b, sessionId: "lgs_other" }, pid: "prj_a", legaSessionId: "lgs_me" }), { action: "toast", path: "/lega/prj_b" }, "another tab");
  assert.deepEqual(cockpitPlanAction({ ref: b, pid: "prj_a", sendInFlight: true }), { action: "navigate", path: "/lega/prj_b" }, "typed here for B");
  assert.deepEqual(cockpitPlanAction({ ref: { ...b, sessionId: "lgs_me" }, pid: "prj_a", legaSessionId: "lgs_me" }), { action: "navigate", path: "/lega/prj_b" });
  // A plan of A on screen (PROPOSED, presented): even this tab's own request does not unmount it.
  assert.deepEqual(cockpitPlanAction({ ref: { ...b, sessionId: "lgs_me" }, pid: "prj_a", legaSessionId: "lgs_me", presentedId: "env_a_1" }), { action: "toast", path: "/lega/prj_b" });
  assert.deepEqual(cockpitPlanAction({ ref: b, pid: "prj_a", sendInFlight: true, presentedId: "opp_on_screen" }), { action: "toast", path: "/lega/prj_b" });
  // The start screen (no project): the same rules.
  assert.deepEqual(cockpitPlanAction({ ref: b, pid: "" }), { action: "toast", path: "/lega/prj_b" });
  assert.deepEqual(cockpitPlanAction({ ref: b, pid: "", sendInFlight: true }), { action: "navigate", path: "/lega/prj_b" });
  // The cockpit tracks its own send in flight and pushes the shell's offer.
  const cockpit = source("web/src/screens/Lega.jsx");
  assert.match(cockpit, /sendingRef\.current = true;/);
  assert.match(cockpit, /openLabel: "Deschide planul"/);
  assert.doesNotMatch(cockpit, /if \(ref\.projectId && pid && ref\.projectId !== pid\) \{ setCurrentProject/, "the unconditional switch is gone");
});

test("G5-41 the shell: this tab's own voice plan closes the stage; a plan from elsewhere never closes it and never navigates", () => {
  const own = { kind: "envelope", id: "env_1", projectId: "prj_1", sessionId: "lgs_me" };
  assert.deepEqual(shellPlanAction({ ref: own, mine: true, onCockpit: true, stageOpen: true }), { closeStage: true, navigate: null, toast: null });
  assert.deepEqual(shellPlanAction({ ref: own, mine: true, onCockpit: false, stageOpen: true }), { closeStage: true, navigate: "/lega/prj_1", toast: null });
  assert.deepEqual(shellPlanAction({ ref: own, mine: true, onCockpit: false, stageOpen: false }), { closeStage: false, navigate: "/lega/prj_1", toast: null });
  assert.deepEqual(shellPlanAction({ ref: { ...own, sessionId: null }, mine: true, onCockpit: true, stageOpen: true }), { closeStage: false, navigate: null, toast: null }, "no session → not this voice session's plan");
  assert.deepEqual(shellPlanAction({ ref: own, mine: false, onCockpit: false, stageOpen: true }), { closeStage: false, navigate: null, toast: "/lega/prj_1" });
  assert.deepEqual(shellPlanAction({ ref: own, mine: false, onCockpit: true, stageOpen: true }), { closeStage: false, navigate: null, toast: null });
  // The shell uses it BEFORE any cockpit early return. One L3ga screen (2026-10-18): „Ecran complet” is the Lega screen itself (no modal
  // covers the cards any more), so a plan this tab asked for is focused there too; the old guard is gone.
  const shell = source("web/src/shell/Lega.jsx");
  assert.match(shell, /shellPlanAction\(\{ ref, mine: Boolean\(mine\), onCockpit: isCockpitHash\(window\.location\.hash\), stageOpen: Boolean\(getState\(\)\?\.stageOpen\) \}\)/);
  assert.doesNotMatch(shell, /if \(!ref \|\| isCockpitHash\(window\.location\.hash\)\) return;/);
  assert.doesNotMatch(source("web/src/screens/Lega.jsx"), /if \(getState\(\)\?\.stageOpen\) return;\n\s*setFocusTarget/);
  assert.doesNotMatch(source("web/src/shell/Shell.jsx"), /<LegaStage /, "no full-screen modal over the screens");
});

// ---------------------------------------------------------------- #40: OBS password (server)
/** A stand-in OBS step (the real one talks to OBS): same kind, a harmless operation, records whether the password reached it. */
function fakeObs(t) {
  const seen = [];
  t.hub.executors["capture.obs_record"] = {
    describe: ({ durationSec = 1 } = {}) => ({ title: `OBS de test ${durationSec} s`, params: { durationSec }, ops: [{ op: "media.render" }], observed: ["starea OBS"], transmitted: [], outputs: ["fișier de test"] }),
    run: async ({ authorize, secrets }) => { authorize({ op: "media.render" }); seen.push(secrets?.obsPassword || null); return { result: { ok: true } }; },
  };
  t.hub.executors["test.probe"] = {
    describe: () => ({ title: "Sondă", params: {}, ops: [{ op: "media.render" }], observed: [], transmitted: [], outputs: [] }),
    run: async ({ authorize }) => { authorize({ op: "media.render" }); return { result: {} }; },
  };
  return seen;
}

test("G5-40 an OBS plan is never confirmed without the password: OBS_PASSWORD_NEEDED, PROPOSED, nothing used up; the card names the secret", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const seen = fakeObs(t);
    const proposed = await asOwner(t, owner, "ops.plan.propose", { kind: "test.obs", title: "Înregistrare de test", steps: [{ kind: "capture.obs_record", params: { durationSec: 1 } }], limits: {} });
    const p = t.hub.opsPlans.view(proposed.id);
    assert.deepEqual(p.needsSecrets, ["obsPassword"], "the plan view names the secret (never its value)");
    assert.deepEqual(t.hub.opsPlans.view((await asOwner(t, owner, "ops.plan.propose", { kind: "test.other", title: "Fără OBS", steps: [{ kind: "test.probe" }], limits: {} })).id).needsSecrets, []);

    // The card's own route, without the password (and with an empty one): refused before CONFIRMED; the plan still waits.
    for (const secrets of [undefined, {}, { obsPassword: "" }, { obsPassword: 42 }]) {
      const err = await refusal(asOwner(t, owner, "ops.plan.confirm", { planId: p.id, nonce: p.nonce, displayedHash: p.hash, ...(secrets ? { secrets } : {}) }));
      assert.equal(err.code, "OBS_PASSWORD_NEEDED", JSON.stringify(secrets));
      assert.match(err.message, /scrie-o în card/);
    }
    // A typed „Da” in the conversation (the presented plan): the same refusal, as a reply that points to the card.
    const typed = await asOwner(t, owner, "owner.intent", { text: "Da", source: "typed", presented: { planId: p.id, nonce: p.nonce, hash: p.hash } });
    const step = typed.results.find((r) => r.error || r.confirmed);
    assert.ok(step?.error, JSON.stringify(typed.results));
    assert.match(step.error.message, /parola OBS/);
    // An armed spoken window is never opened for it (a spoken „Da” cannot carry the password).
    const armErr = await refusal(Promise.resolve().then(() => t.hub.opsPlans.armForLega({ planId: p.id, legaSessionId: "lgs_test", session: owner.session })));
    assert.equal(armErr.code, "OBS_PASSWORD_NEEDED");
    const still = t.hub.opsPlans.view(p.id);
    assert.equal(still.status, "PROPOSED");
    assert.equal(still.consent, null, "no consent recorded");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'ops.plan.consent' AND scope_id = ?").get(p.id).n, 0);
    assert.deepEqual(seen, [], "the OBS step never ran");

    // With the password typed in the card: the ONE confirmation goes through and the step gets it (memory only).
    const ok = await asOwner(t, owner, "ops.plan.confirm", { planId: p.id, nonce: p.nonce, displayedHash: p.hash, secrets: { obsPassword: "parola-obs-G5" } });
    assert.ok(["CONFIRMED", "RUNNING", "DONE"].includes(ok.plan.status));
    const done = await t.hub.opsPlans.idle(p.id);
    assert.equal(done.status, "DONE", done.statusReason);
    assert.deepEqual(seen, ["parola-obs-G5"]);
    const dump = JSON.stringify([t.hub.db.prepare("SELECT * FROM commands").all(), t.hub.db.prepare("SELECT * FROM events").all(), t.hub.db.prepare("SELECT * FROM ops_plans").all()]);
    assert.ok(!dump.includes("parola-obs-G5"), "the password is never stored");
  } finally { await t.cleanup(); }
});

test("G5-40b the card shape carries needsSecrets; the cockpit's guard reads it without the plan body", async () => {
  assert.deepEqual(secretsNeeded([{ kind: "capture.obs_record" }, { kind: "media.render" }, { kind: "capture.obs_record" }]), ["obsPassword"]);
  assert.deepEqual(secretsNeeded(undefined), []);
  // The plan card of „Înregistrează demonstrația cu OBS…” (intent-actions planCard) on a stand-in hub: needsSecrets is derived.
  let proposedSteps = null;
  const hub = {
    opsPlans: { propose: async ({ kind, title, steps }) => { proposedSteps = steps; return { id: "opp_g5_1", kind, title, status: "PROPOSED", summary: { steps: steps.map((s) => s.kind) }, hash: "h", nonce: "n", confirmBy: "2026-10-05T00:00:00Z", body: { decisions: [], steps } }; } },
    settings: { get: (k) => (k === "mediaPolicy" ? { liveCapture: true, obs: { recordingRoot: "C:/OBS-test" } } : null) },
    config: { port: 1 },
  };
  const actions = createOpsIntentActions(hub);
  const card = await actions.captureVertical({ args: { obs: true, vertical: true } }, { ctx: { actor: "test", channel: "test" } });
  assert.equal(proposedSteps[0].kind, "capture.obs_record");
  assert.deepEqual(card.opsPlan.needsSecrets, ["obsPassword"]);
  assert.equal(planNeedsObsPassword(card.opsPlan), true, "the trimmed card (no body) still needs the password");
  assert.equal(planNeedsObsPassword({ id: "opp_x", needsSecrets: [] }), false);
  assert.equal(planNeedsObsPassword({ body: { steps: [{ kind: "capture.obs_record" }] } }), true, "the full plan (card's live data) as before");
  // The cockpit keeps the list in its trimmed shape and reads a card without it back in full.
  const cockpit = source("web/src/screens/Lega.jsx");
  assert.match(cockpit, /needsSecrets: Array\.isArray\(p\.needsSecrets\) \? p\.needsSecrets : planNeedsObsPassword\(p\) \? \["obsPassword"\] : \[\]/);
  assert.match(cockpit, /if \(!Array\.isArray\(r\.opsPlan\.needsSecrets\) && r\.opsPlan\.status === "PROPOSED"\) loadOpsPlan\(r\.opsPlan\.id\)/);
});

// ---------------------------------------------------------------- #42: autonomy atLeast (server)
async function factoryHub() {
  const t = await makeTestHub({ queues: true });
  await prepareLiveWithoutGrants(t.hub);
  const dir = path.join(t.dataDir, "g5-bug-demo");
  materializeFixture("bug-demo", dir);
  const project = (await dispatch(t.hub, "project.register_test", { path: dir, name: "Demo G5" })).result;
  await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS });
  const missionId = t.hub.factory.list().find((f) => f.projectId === project.id).missionId;
  const owner = await enrolOwner(t);
  return { ...t, project, missionId, owner };
}

test("G5-42 „Ridică la Asistat” (atLeast) never lowers a higher level: no write, no revoke, no supersede; a real raise still needs Windows Hello", async () => {
  const t = await factoryHub();
  const { server, token } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  const host = `localhost:${t.config.port}`;
  const post = (p, body) => new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({ host: "127.0.0.1", port: t.config.port, method: "POST", path: p, headers: { Host: host, Origin: `http://${host}`, "X-Hub-Token": token, "Content-Type": "application/json", "Content-Length": data.length } }, (res) => {
      let text = ""; res.setEncoding("utf8"); res.on("data", (c) => { text += c; }); res.on("end", () => { let json = null; try { json = JSON.parse(text); } catch { /* */ } resolve({ status: res.statusCode, json }); });
    });
    req.on("error", reject); req.write(data); req.end();
  });
  try {
    await dispatch(t.hub, "owner.autonomy.set", { projectId: t.project.id, level: "TRUSTED" }, { ownerSession: t.owner.reauth() });
    const env = (await t.hub.envelopes.propose({ projectId: t.project.id, missionIds: [t.missionId], level: "TRUSTED", actor: "test", via: "test" })).envelope;
    assert.equal(env.status, "PROPOSED");
    assert.equal(env.autonomyLevel, "TRUSTED");
    const stored = () => JSON.stringify(t.hub.settings.get("projectAutonomy")?.[t.project.id]);
    const before = stored();
    const changes = () => t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'settings.changed'").get().n;
    const changesBefore = changes();

    // The button's request over HTTP (no owner cookie: the "ui" channel, like a stale card), and the command from any channel.
    const viaHttp = await post("/api/owner/autonomy", { projectId: t.project.id, level: "ASSISTED", atLeast: true });
    assert.equal(viaHttp.status, 200, JSON.stringify(viaHttp.json));
    const out = viaHttp.json?.result ?? viaHttp.json;
    assert.equal(out.unchanged, true, JSON.stringify(viaHttp.json));
    assert.equal(out.level, "TRUSTED");
    const cmd = (await dispatch(t.hub, "owner.autonomy.set", { projectId: t.project.id, level: "OBSERVE", atLeast: true })).result;
    assert.deepEqual({ level: cmd.level, unchanged: cmd.unchanged }, { level: "TRUSTED", unchanged: true });
    assert.equal(stored(), before, "nothing written");
    assert.equal(changes(), changesBefore, "no settings change");
    assert.equal(t.hub.envelopes.autonomyOf(t.project.id).level, "TRUSTED");
    assert.equal(t.hub.envelopes.get(env.id).status, "PROPOSED", "the plan in force is neither revoked nor superseded");

    // A real raise with atLeast still needs a fresh owner session (no authority from the flag).
    await dispatch(t.hub, "owner.autonomy.set", { projectId: t.project.id, level: "OBSERVE" });
    assert.equal(t.hub.envelopes.get(env.id).status, "SUPERSEDED", "control: an explicit lowering still narrows (fail-safe, unchanged)");
    const noSession = await refusal(dispatch(t.hub, "owner.autonomy.set", { projectId: t.project.id, level: "ASSISTED", atLeast: true }));
    assert.ok(noSession, "raising from Observ without a session is refused");
    assert.equal(t.hub.envelopes.autonomyOf(t.project.id).level, "OBSERVE");
    const raised = (await dispatch(t.hub, "owner.autonomy.set", { projectId: t.project.id, level: "ASSISTED", atLeast: true }, { ownerSession: t.owner.reauth() })).result;
    assert.equal(raised.level, "ASSISTED");
    assert.ok(!raised.unchanged);

    // The UI: both buttons send atLeast and are offered only on Observ.
    assert.equal(autonomyRaiseOffered("OBSERVE"), true);
    for (const l of ["ASSISTED", "TRUSTED", "HIGH_AUTONOMY_BOUNDED", null, undefined]) assert.equal(autonomyRaiseOffered(l), false, String(l));
    const cards = source("web/src/screens/lega/cards.jsx");
    assert.equal((cards.match(/level: "ASSISTED", atLeast: true/g) || []).length, 2, "AutonomyRaise and BlockerActions");
    assert.doesNotMatch(cards, /level: "ASSISTED" \}/);
    assert.match(cards, /a\.type === "autonomy" && projectId && autonomyRaiseOffered\(projectLevel\)/);
    assert.match(cards, /env\.autonomyLevel === "OBSERVE" && autonomyRaiseOffered\(projectLevel\) && <AutonomyRaise/);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    await t.cleanup();
  }
});

// ---------------------------------------------------------------- Part B: the real UI
const status = browserStatus({ hubRoot: HUB_ROOT });
const built = fs.existsSync(path.join(WEB_DIST, "index.html"));
/** The build must contain G5: a marker string from the new DecisionCard copy. */
const hasG5 = () => {
  try {
    const dir = path.join(WEB_DIST, "assets");
    return fs.readdirSync(dir).filter((f) => f.endsWith(".js")).some((f) => fs.readFileSync(path.join(dir, f), "utf8").includes("Arată planul din nou"));
  } catch { return false; }
};
const skip = !status.installed || !status.cachedBrowsers.length ? "SKIPPED_ENV: Playwright/Chromium is missing"
  : !built ? `SKIPPED_ENV: the built UI is missing (${WEB_DIST})`
    : !hasG5() ? `SKIPPED_ENV: the built UI predates G5 (${WEB_DIST}); set HUB_V2_WEB_DIST to a fresh build`
      : false;

test("G5-E2E focus belongs to the plan this tab asked for (#37/#38), no project switch over a plan on screen (#39), nothing focused behind the stage (#41)", { skip, timeout: 300000 }, async () => {
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
      const project = (await dispatch(t.hub, "project.register_test", { path: dir, name: `Demo ${name}` })).result;
      await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS });
      return { project, missionId: t.hub.factory.list().find((f) => f.projectId === project.id).missionId };
    };
    const A = await projectOf("g5-a");
    const B = await projectOf("g5-b");
    t.hub.executors["test.probe"] = {
      describe: () => ({ title: "Sondă G5", params: {}, ops: [{ op: "media.render" }], observed: ["nimic"], transmitted: [], outputs: ["rezultat"] }),
      run: async ({ authorize }) => { authorize({ op: "media.render" }); return { result: {} }; },
    };
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

    // The cockpit of A with a PROPOSED plan on screen (restored from the read model, not focused).
    const envA = (await t.hub.envelopes.propose({ projectId: A.project.id, missionIds: [A.missionId], actor: "test", via: "test" })).envelope;
    await page.goto(`${origin}/#/lega/${A.project.id}`);
    const composer = page.getByLabel("Mesaj pentru Lega");
    await composer.waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: /Da, execută planul/ }).waitFor({ timeout: 20000 });
    const active = () => page.evaluate(() => ({ decision: Boolean(document.activeElement?.closest?.(".decision")), ops: Boolean(document.activeElement?.closest?.(".ops-plan")), label: document.activeElement?.getAttribute?.("aria-label") || null }));

    // #38 · The owner types; a plan from elsewhere (sessionId null, nothing in flight) is announced: the focus stays in the composer,
    // and Enter sends the sentence — never envelope.confirm.
    const intents = [];
    await page.route("**/api/owner/intent", async (route) => {
      intents.push(JSON.parse(route.request().postData() || "{}"));
      const hold = intents[intents.length - 1].text === "Pregătește înregistrarea";
      if (hold) {
        // #37 · While THIS tab's send is in flight, the ops plan it asked for is announced: it takes the focus, not the DecisionCard.
        const opp = (await t.hub.commands.dispatch({ type: "ops.plan.propose", channel: "test", actor: "test", payload: { kind: "test.g5", title: "Plan operațional G5", steps: [{ kind: "test.probe" }], limits: {} } })).result;
        t.hub.live.publish({ type: "lega.plan", kind: "ops", id: opp.id, projectId: A.project.id, sessionId: null });
        await waitFor(async () => (await active()).ops, 15000, 100).catch(() => {});
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ resolved: { steps: [], refused: [] }, results: [], layout: null }) });
    });
    await composer.click();
    await composer.fill("Ce mai avem de făcut");
    t.hub.live.publish({ type: "lega.plan", kind: "envelope", id: envA.id, projectId: A.project.id, sessionId: null });
    await page.waitForTimeout(1500);
    assert.equal((await active()).label, "Mesaj pentru Lega", "the composer keeps the focus");
    await page.keyboard.press("Enter");
    await waitFor(() => intents.some((b) => b.text === "Ce mai avem de făcut"), 10000, 100);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE type = 'envelope.confirm'").get().n, 0, "Enter sent the sentence, it confirmed nothing");
    assert.equal(t.hub.envelopes.get(envA.id).status, "PROPOSED");

    // #37 · The ops plan this tab asked for is focused (not the DecisionCard on screen); Enter confirms THAT plan, not the envelope.
    await waitFor(async () => !(await composer.isDisabled()), 10000, 100);
    await composer.fill("Pregătește înregistrarea");
    await page.keyboard.press("Enter");
    await waitFor(async () => (await active()).ops, 15000, 100);
    await waitFor(async () => !(await composer.isDisabled()), 15000, 100);
    const focusAfter = await active();
    assert.equal(focusAfter.ops, true, "the ops card keeps the focus after the send ends");
    assert.equal(focusAfter.decision, false);
    await page.keyboard.press("Enter");
    await waitFor(() => t.hub.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE type = 'ops.plan.confirm'").get().n === 1, 15000, 100);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE type = 'envelope.confirm'").get().n, 0, "the envelope was NOT confirmed");
    assert.equal(t.hub.envelopes.get(envA.id).status, "PROPOSED");
    const opsConfirm = JSON.parse(t.hub.db.prepare("SELECT payload_json FROM commands WHERE type = 'ops.plan.confirm'").get().payload_json);
    assert.equal(opsConfirm.modality, "keyboard");

    // #39 · A plan of project B announced from elsewhere while A's plan is on screen: the address stays on A, a toast offers B.
    const envB = (await t.hub.envelopes.propose({ projectId: B.project.id, missionIds: [B.missionId], actor: "test", via: "test" })).envelope;
    t.hub.live.publish({ type: "lega.plan", kind: "envelope", id: envB.id, projectId: B.project.id, sessionId: null });
    await page.getByText("Un plan te așteaptă în cockpit (o singură confirmare)").first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.location.hash), `#/lega/${A.project.id}`, "the cockpit of A stays");
    // The same plan from a Lega session that is not this tab's: still no switch.
    t.hub.live.publish({ type: "lega.plan", kind: "envelope", id: envB.id, projectId: B.project.id, sessionId: "lgs_not_this_tab" });
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => window.location.hash), `#/lega/${A.project.id}`);

    // #41 · „Ecran complet” is on (one L3ga screen: the Lega screen without the Hub's bars); a plan from elsewhere is announced: the full
    // screen stays, and no card takes the focus for a plan this tab did not ask for.
    await page.getByRole("button", { name: /Ecran complet/ }).first().click();
    await page.locator(".lega-one.is-immersive").waitFor({ timeout: 10000 });
    t.hub.live.publish({ type: "lega.plan", kind: "envelope", id: envA.id, projectId: A.project.id, sessionId: null });
    await page.waitForTimeout(1500);
    assert.ok(await page.locator(".lega-one.is-immersive").isVisible(), "the full screen stays on for a plan that is not this tab's");
    const behind = await active();
    assert.equal(behind.decision || behind.ops, false, "no hidden card took the focus");
    assert.deepEqual(pageErrors, [], "no uncaught page errors");
  } finally {
    await browser.close();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    await t.cleanup();
  }
});
