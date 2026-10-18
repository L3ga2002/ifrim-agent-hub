// M08 UI inspection (manual tool, not part of the suite): a TEST hub with synthetic data serves a separate UI build
// (HUB_V2_WEB_DIST, never v2/web/dist) and a headless Chromium captures every M08 screen at desktop and phone widths, records
// console/page errors, horizontal overflow and time-to-content. The owner session is a SOFTWARE authenticator (PASS_SIMULATED).
//   HUB_V2_WEB_DIST=<build> node v2/tests/manual/m08-screens.mjs [outDir]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants, HUB_ROOT, WEB_DIST } from "../helpers.mjs";
import { createHttpServer } from "../../server/http/server.mjs";
import { browserLaunchOptions } from "../../server/tools/browser-core.mjs";
import { materializeFixture, demoSpec } from "../../server/factory/fixtures.mjs";

const OUT = path.resolve(process.argv[2] || path.join(HUB_ROOT, ".ifrim", "m08-screens"));
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(WEB_DIST, "index.html"))) { console.error(`No UI build at ${WEB_DIST}`); process.exit(1); }

const t = await makeTestHub({ queues: true });
const { server } = createHttpServer(t.hub);
await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
const origin = `http://localhost:${t.config.port}`;
const d = (type, payload, extra = {}) => t.hub.commands.dispatch({ type, payload, channel: "test", actor: "owner:test", ...extra }).then((r) => r.result);
const report = { generatedAt: new Date().toISOString(), webDist: path.relative(HUB_ROOT, WEB_DIST), hubVersion: t.config && (await import("../../server/config.mjs")).HUB_VERSION, screens: [], errors: [] };
const pw = createRequire(path.join(HUB_ROOT, "package.json"))("playwright");
const browser = await pw.chromium.launch(browserLaunchOptions(origin));
try {
  // ---------- synthetic data ----------
  await prepareLiveWithoutGrants(t.hub);
  const dir = path.join(t.dataDir, "factory-bug-demo");
  materializeFixture("bug-demo", dir);
  const project = await d("project.register_test", { path: dir });
  const owner = await enrolOwner(t);
  await d("owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
  t.hub.bus.transaction(() => t.hub.settings.set("simulationDefaults", { currentProjects: 3, effortHoursPerProject: { min: 30, max: 60 }, capacityHoursPerWeek: 50, horizonWeeks: 8 }, "test"));
  const inc = await d("incident.propose", { projectId: project.id, text: "Formularul de solicitare dă eroare la trimitere de azi-dimineață" });
  await d("incident.entry.add", { incidentId: inc.incident.id, kind: "hypothesis", text: "Validarea numelui respinge și valori corecte" });
  const sim = await d("simulation.run", { title: "Încă cinci clienți în 8 săptămâni", inputs: { currentProjects: 3, newProjects: 5, effortHoursPerProject: { min: 30, max: 60 }, capacityHoursPerWeek: 50, horizonWeeks: 8 } });
  const lesson = await d("lesson.propose", { text: "La livrarea unui site de client verifică mobilul, formularele și erorile consolei", source: "typed" });
  await d("lesson.confirm", { lessonId: lesson.lesson.id }, { ownerSession: owner.session });
  await d("lesson.propose", { text: "Pentru proiectele noi folosește întotdeauna teste unitare", source: "typed" });
  const bug = demoSpec("bug-demo");
  const objective = await d("autopilot.draft", { projectId: project.id, title: "Validare robustă a solicitărilor", criteria: ["Numele din spații e refuzat", "Numele prea lung e detectat"], tasks: [
    { key: "t1", title: bug.title, workType: "BUGFIX", objective: bug.objective, inScope: bug.spec.inScope, acceptance: bug.spec.acceptance, verification: bug.spec.verification },
    { key: "t2", title: "Limită de lungime pentru nume", workType: "FEATURE", objective: "Detectarea numelui prea lung, cu test.", dependsOn: ["t1"], inScope: ["src/limits.js"], acceptance: [{ id: "AC-1", text: "Numele lung e detectat", verify: "test", testRef: "test/acceptance.test.mjs" }], verification: bug.spec.verification },
  ] });
  await d("autopilot.prepare", { objectiveId: objective.id }, { ownerSession: owner.session });
  await d("board.open", {});
  await d("package.present", { kind: "A" });
  await d("package.present", { kind: "B" });
  const pairing = await d("device.pairing.start", {}, { ownerSession: owner.session });
  const phone = t.hub.devices.pair({ code: pairing.code, label: "Telefon (simulat)" });
  const skill = t.hub.db.prepare("SELECT id FROM skills ORDER BY id LIMIT 1").get();
  if (skill) {
    const base = t.hub.skillEvolution.baseBody(skill.id);
    const c = await d("skill.candidate.propose", { skillId: skill.id, body: `${base.body}\n- Verifică și erorile din consolă înainte de raport.\n`, reason: "Erori de consolă ratate în review", evidence: ["review_sim_1"] });
    await d("skill.candidate.evaluate", { candidateId: c.id });
  }

  // ---------- browser ----------
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await context.addCookies([{ name: "ifrim_owner", value: owner.token, domain: "localhost", path: "/api", httpOnly: true, sameSite: "Strict" }]);
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") report.errors.push({ where: page.url(), text: m.text().slice(0, 300) }); });
  page.on("pageerror", (e) => report.errors.push({ where: page.url(), text: `pageerror: ${String(e.message).slice(0, 300)}` }));
  const shot = async (name, hash, { width = 1440, height = 900, wait = ".page, .mobile-app", action = null } = {}) => {
    await page.setViewportSize({ width, height });
    const started = Date.now();
    await page.goto(`${origin}/#${hash}`);
    await page.waitForSelector(wait, { timeout: 15000 });
    // The SSE stream keeps the network busy (no "networkidle"): wait until the panel has real content instead.
    await page.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 8000 }).catch(() => {});
    const ms = Date.now() - started;
    if (action) await action(page);
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const file = `${name}-${width}.png`;
    await page.screenshot({ path: path.join(OUT, file), fullPage: false });
    report.screens.push({ name, hash, width, file, msToContent: ms, horizontalOverflowPx: overflow });
  };
  const pid = project.id;
  await shot("cockpit", `/lega/${pid}`);
  // Zero-Menu: four sentences, the answers appear as cards in the cockpit.
  const say = async (text) => { await page.fill("input[aria-label='Mesaj pentru Lega']", text); await page.press("input[aria-label='Mesaj pentru Lega']", "Enter"); await page.waitForTimeout(900); };
  await shot("cockpit-today", `/lega/${pid}`, { action: async () => { await say("Ce avem azi?"); } });
  await shot("cockpit-incident", `/lega/${pid}`, { action: async () => { await say("Checkout-ul a picat"); } });
  await shot("cockpit-scenario", `/lega/${pid}`, { action: async () => { await say("Ce se întâmplă dacă luăm încă cinci clienți?"); } });
  await shot("cockpit-teach", `/lega/${pid}`, { action: async () => { await say("Ține minte că la livrare verifici și viteza paginii"); } });
  await shot("stage-fullscreen", `/lega/${pid}`, { wait: ".page", action: async (p) => { await p.click("button:has-text('Ecran complet')"); await p.waitForTimeout(800); } });
  await page.goto("about:blank"); // the big screen is in-memory state: a fresh load closes it before the next captures
  for (const [name, hash] of [["intel-today", "/intel/today"], ["intel-twin", `/intel/twin?id=${pid}`], ["intel-warroom", `/intel/warroom?id=${inc.incident.id}`], ["intel-autopilot", `/intel/autopilot?id=${objective.id}`],
    ["intel-board", "/intel/board"], ["intel-simulation", `/intel/simulation?id=${sim.id}`], ["intel-league", "/intel/league"], ["intel-skills", "/intel/skills"], ["intel-lessons", "/intel/lessons"],
    ["intel-decisions", "/intel/decisions"], ["intel-devices", "/intel/devices"]]) await shot(name, hash);
  // Narrow widths: the intel screens and the cockpit at 360 px (no horizontal scroll expected).
  for (const [name, hash] of [["cockpit", `/lega/${pid}`], ["intel-warroom", `/intel/warroom?id=${inc.incident.id}`], ["intel-simulation", `/intel/simulation?id=${sim.id}`], ["intel-decisions", "/intel/decisions"]]) await shot(name, hash, { width: 360, height: 780 });
  // The phone: the owner's preview, then a paired device (its own cookie, no owner session).
  await shot("mobile-owner-preview", "/m", { width: 390, height: 844, wait: ".mobile-app" });
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", isMobile: true, hasTouch: true });
  await phoneCtx.addCookies([{ name: "ifrim_device", value: phone.token, domain: "localhost", path: "/api", httpOnly: true, sameSite: "Strict" }]);
  const phonePage = await phoneCtx.newPage();
  phonePage.on("pageerror", (e) => report.errors.push({ where: "phone", text: `pageerror: ${String(e.message).slice(0, 300)}` }));
  let started = Date.now();
  await phonePage.goto(`${origin}/#/m`);
  await phonePage.waitForSelector(".m-stop", { timeout: 15000 });
  report.screens.push({ name: "mobile-device", hash: "/m", width: 390, file: "mobile-device-390.png", msToContent: Date.now() - started, horizontalOverflowPx: await phonePage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) });
  await phonePage.screenshot({ path: path.join(OUT, "mobile-device-390.png") });
  const unpaired = await browser.newContext({ viewport: { width: 360, height: 760 }, isMobile: true });
  const up = await unpaired.newPage();
  started = Date.now();
  await up.goto(`${origin}/#/m`);
  await up.waitForSelector("form.m-card", { timeout: 15000 });
  report.screens.push({ name: "mobile-pairing", hash: "/m", width: 360, file: "mobile-pairing-360.png", msToContent: Date.now() - started, horizontalOverflowPx: await up.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) });
  await up.screenshot({ path: path.join(OUT, "mobile-pairing-360.png") });
  // Keyboard: the intel tabs move with the arrow keys and keep focus.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/#/intel/today`);
  await page.waitForSelector("[role=tab][aria-selected=true]");
  await page.focus("[role=tab][aria-selected=true]");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  report.keyboard = { afterArrowRight: await page.evaluate(() => document.activeElement?.id || null), url: page.url().split("#")[1] };
} catch (error) {
  report.errors.push({ where: "script", text: String(error.stack || error).slice(0, 800) });
} finally {
  await browser.close();
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
  await t.cleanup();
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out: OUT, screens: report.screens.length, errors: report.errors.length, overflow: report.screens.filter((s) => s.horizontalOverflowPx > 0).map((s) => `${s.name}@${s.width}:${s.horizontalOverflowPx}`), keyboard: report.keyboard }, null, 2));
}
