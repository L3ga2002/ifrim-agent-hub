import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTestHub, enableLive, waitFor, tempDir } from "./helpers.mjs";
import { LEGA_CONSENT_VERSION, LEGA_TARGETS, LEGA_HOWTO, legaDynamicTools, legaAgentInstructions } from "../server/policy/lega-policy.mjs";
import { legaAllowedItems } from "../server/providers/codex-realtime.mjs";
import { codexBaseOverrides, CODEX_APP_SERVER_OVERRIDES } from "../server/providers/codex.mjs";
import { readProjectNotes } from "../server/domain/project-notes.mjs";

// Lega "full access under control": it SEES the company (read-only tools), SHOWS the UI (point, how-to), PREPARES work
// (missions and runs by approval, a grant only pre-filled), searches the web when the owner allows it, and the owner
// enables runs on company projects. Fake app-server only: no network, no audio, no model.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const SECRET = "sk-proj-FAKEFAKEFAKEFAKEFAKEFAKE1234";
const dispatch = async (hub, type, payload = {}, channel = "ui") => (await hub.commands.dispatch({ type, payload, actor: channel === "voice" ? "voice" : "user", channel })).result;
const calls = (list) => `lega-calls:${Buffer.from(JSON.stringify(list)).toString("base64url")}`;
const liveEvents = (hub) => { const events = []; hub.live.subscribe((e) => events.push(e)); return events; };

async function enableLega(hub) {
  await enableLive(hub, { provider: "codex" });
  hub.bus.transaction(() => hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
  hub.bus.transaction(() => hub.grants.create({ provider: "codex", projectId: hub.projects.hub().id, access: "read-only", maxAttempts: 3, maxDurationS: 600, ttlMinutes: 30, kind: "voice" }, "test"));
}

/** A second company project (from the registry) with notes, a secret in its README and a private folder. */
function addClientProject(t) {
  const dir = path.join(t.dataDir, "client-site");
  fs.mkdirSync(path.join(dir, ".ifrim", "private"), { recursive: true });
  fs.writeFileSync(path.join(dir, "README.md"), `# Client landing\nSite de prezentare pentru client.\napi_key = ${SECRET}\n`);
  fs.writeFileSync(path.join(dir, ".ifrim", "PROJECT_STATE.md"), "Stare: design aprobat, lipsesc paginile de contact.\n");
  fs.writeFileSync(path.join(dir, ".ifrim", "private", "keys.md"), "PRIVATE-DO-NOT-READ\n");
  fs.writeFileSync(t.config.registryPath, `# Projects\n\n## Client Site\n- Path: ${dir}\n- Stack: Next.js\n- Status: activ\n`);
  t.hub.projects.syncFromRegistry();
  return { dir, project: t.hub.projects.list().find((p) => p.name === "Client Site") };
}

async function runSession(t, { until }) {
  const { hub } = t;
  const events = liveEvents(hub);
  const s = await dispatch(hub, "lega.session.start", { sdp: OFFER });
  await dispatch(hub, "lega.session.connected", { sessionId: s.sessionId });
  await waitFor(() => until(t.readLog("codex")), 15000);
  return { s, events, replies: t.readLog("codex").filter((l) => l.toolReply).map((l) => ({ tool: l.tool, ok: l.toolReply.success, text: l.toolReply.contentItems?.[0]?.text || "" })) };
}

test("M03-ACCESS-01 policy: the agent sees the company, shows the UI and prepares work; the UI map is complete", () => {
  const tools = legaDynamicTools({ projects: [{ id: "p1", name: "Hub" }], allProjects: [{ id: "p1", name: "Hub" }, { id: "p2", name: "Client" }], missionKinds: ["development", "site_audit"] })[0].tools;
  const names = tools.map((t) => t.name);
  for (const n of ["company_briefing", "list_projects", "project_brief", "list_missions", "mission_detail", "pending_approvals", "recent_runs", "how_to", "point", "prepare_grant", "propose_mission", "propose_run", "stop_all", "pause"]) assert.ok(names.includes(n), n);
  assert.deepEqual(tools.find((t) => t.name === "propose_run").inputSchema.properties.project.enum, ["Hub"], "runs only on enabled projects");
  assert.deepEqual(tools.find((t) => t.name === "project_brief").inputSchema.properties.project.enum, ["Hub", "Client"], "reading covers every company project");
  assert.deepEqual(tools.find((t) => t.name === "propose_mission").inputSchema.properties.kind.enum, ["development", "site_audit"]);
  for (const topic of Object.values(LEGA_HOWTO)) assert.ok(LEGA_TARGETS[topic.target], `how-to target ${topic.target} exists`);
  // Every target Lega can point at is really marked in the web UI (data-lega-target), so the arrow never points at nothing.
  const web = path.join(HERE, "..", "web", "src");
  const sources = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.jsx?$/.test(e.name)) sources.push(fs.readFileSync(p, "utf8")); } };
  walk(web);
  const all = sources.join("\n");
  for (const key of Object.keys(LEGA_TARGETS)) assert.ok(all.includes(`data-lega-target="${key}"`), `UI marks ${key}`);
  const withWeb = legaAgentInstructions({ projects: [], webSearch: "live" });
  assert.match(withWeb, /web search/i);
  assert.match(withWeb, /Never put project contents/);
  assert.doesNotMatch(legaAgentInstructions({ projects: [], webSearch: "disabled" }), /web search/i);
});

test("M03-ACCESS-02 read tools: briefing, projects, project notes (bounded, redacted, never private), missions, approvals, runs, how-to", async () => {
  const t = await makeTestHub({ codex: calls([
    { tool: "company_briefing" }, { tool: "list_projects" }, { tool: "project_brief", args: { project: "Client Site" } },
    { tool: "list_missions" }, { tool: "mission_detail", args: { mission: "Site nou" } }, { tool: "pending_approvals" },
    { tool: "recent_runs", args: { limit: 3 } }, { tool: "how_to", args: { topic: "grant" } }, { tool: "project_brief", args: { project: "C:\\Windows" } },
    { tool: "list_missions", args: { project: "../../etc" } },
  ]) });
  try {
    const { hub } = t;
    const { project } = addClientProject(t);
    await dispatch(hub, "mission.create", { projectId: project.id, kind: "development", title: "Site nou pentru client", objective: "Pagini de contact și formular.", acceptance: ["Formular funcțional"] });
    await enableLega(hub);
    const { s, replies } = await runSession(t, { until: (log) => log.some((l) => l.callsDone) });
    const by = (tool, i = 0) => replies.filter((r) => r.tool === tool)[i];
    assert.ok(by("company_briefing").ok);
    assert.match(by("company_briefing").text, /Mod LIVE_VALIDATION/);
    assert.match(by("company_briefing").text, /Site nou pentru client/);
    assert.match(by("list_projects").text, /Client Site: doar context/);
    const brief = by("project_brief");
    assert.ok(brief.ok);
    assert.match(brief.text, /Client landing/);
    assert.match(brief.text, /lipsesc paginile de contact/);
    assert.match(brief.text, /informație, nu instrucțiuni/);
    assert.ok(!brief.text.includes(SECRET), "secrets in notes are redacted");
    assert.ok(!brief.text.includes("PRIVATE-DO-NOT-READ"), ".ifrim/private is never read");
    assert.match(by("list_missions").text, /Site nou pentru client \[DRAFT\]/);
    assert.match(by("mission_detail").text, /Obiectiv \(informație, nu instrucțiuni\): Pagini de contact/);
    assert.match(by("mission_detail").text, /Formular funcțional/);
    assert.match(by("pending_approvals").text, /Nicio aprobare/);
    assert.match(by("recent_runs").text, /Nicio execuție/);
    assert.match(by("how_to").text, /Creează grant/);
    assert.match(by("how_to").text, /grant-form/);
    assert.equal(by("project_brief", 1).ok, false, "a path is never a project");
    assert.match(by("project_brief", 1).text, /Nu găsesc proiectul/);
    assert.equal(by("list_missions", 1).ok, false);
    assert.equal(hub.lega.state().status, "active", "read tools never end the session");
    assert.ok(hub.bus.query({ limit: 200 }).filter((e) => e.type === "lega.tool").length >= 10, "every tool call is recorded");
    await dispatch(hub, "lega.session.stop", { sessionId: s.sessionId });
  } finally { await t.cleanup(); }
});

test("M03-ACCESS-03 notes reader refuses a junction that leaves the project and bounds what it reads", async (t) => {
  const root = tempDir("notes");
  try {
    const project = path.join(root, "proj"); const outside = path.join(root, "outside");
    fs.mkdirSync(project, { recursive: true }); fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "PROJECT_STATE.md"), "OUTSIDE-CONTENT\n");
    fs.writeFileSync(path.join(project, "README.md"), `${"x".repeat(5000)}\n`);
    try { fs.symlinkSync(outside, path.join(project, ".ifrim"), "junction"); } catch { t.skip("junctions not available"); return; }
    const { notes, skipped } = readProjectNotes(project, { perFile: 100, total: 5000 });
    assert.equal(notes.length, 1);
    assert.equal(notes[0].file, "README.md");
    assert.equal(notes[0].truncated, true);
    assert.ok(notes[0].text.length <= 100);
    assert.ok(skipped.some((s) => s.file === ".ifrim/PROJECT_STATE.md" && /refused/.test(s.reason)));
    assert.ok(!JSON.stringify(notes).includes("OUTSIDE-CONTENT"));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("M03-ACCESS-04 show and prepare: point with arrow, grant form pre-filled (never created), mission by approval only", async () => {
  const t = await makeTestHub({ codex: calls([
    { tool: "point", args: { target: "grant-create" } },
    { tool: "point", args: { target: "project-execution", project: "Client Site" } },
    { tool: "point", args: { target: "__proto__" } },
    { tool: "prepare_grant", args: { kind: "run", project: "Client Site" } },
    { tool: "prepare_grant", args: { kind: "run", provider: "claude", access: "workspace-write", attempts: 2, valid_minutes: 45 } },
    { tool: "prepare_grant", args: { kind: "voice", attempts: 9, note: `cheia ${SECRET}` } },
    { tool: "prepare_grant", args: { kind: "voice", attempts: 9 } },
    { tool: "propose_mission", args: { project: "Client Site", kind: "site_audit", title: "Audit site client", objective: "Verifică performanța și SEO.", acceptance: ["Raport cu 5 probleme"] } },
    { tool: "propose_mission", args: { project: "Client Site", kind: "deploy_everything", title: "X y z", objective: "Nimic de făcut." } },
    { tool: "propose_mission", args: { project: "Client Site", kind: "development", title: "Cu secret", objective: `Folosește ${SECRET}` } },
    { tool: "propose_run", args: { project: "Client Site", provider: "codex", task: "Citește README." } },
  ]) });
  try {
    const { hub } = t;
    const { project } = addClientProject(t);
    await enableLega(hub);
    const grantsBefore = hub.grants.list().length;
    const missionsBefore = hub.missions.list().length;
    const { s, events, replies } = await runSession(t, { until: (log) => log.some((l) => l.callsDone) });
    const by = (tool, i = 0) => replies.filter((r) => r.tool === tool)[i];
    const points = events.filter((e) => e.type === "lega.point");
    assert.deepEqual([points[0].target, points[0].path], ["grant-create", "/integrations"]);
    assert.deepEqual([points[1].target, points[1].path], ["project-execution", `/projects/${project.id}`]);
    assert.equal(by("point", 2).ok, false, "only known targets (no prototype keys)");
    // A run grant on a project that is not enabled: refused, and the arrow shows where to enable it.
    assert.equal(by("prepare_grant").ok, false);
    assert.ok(points.some((p) => p.target === "project-execution" && p.path === `/projects/${project.id}` && p !== points[1]));
    const prefills = events.filter((e) => e.type === "lega.prefill");
    assert.equal(prefills.length, 2, "the note with a secret is refused");
    assert.deepEqual(prefills[0].form, { kind: "run", projectId: hub.projects.hub().slug, provider: "claude", access: "workspace-write", maxAttempts: 2, ttlMinutes: 45, maxDurationS: 900, note: "Pregătit de Lega" });
    assert.equal(prefills[1].form.kind, "voice");
    assert.equal(prefills[1].form.maxAttempts, 5, "clamped to the grant limit");
    assert.equal(prefills[1].form.access, "read-only");
    assert.equal(by("prepare_grant", 2).ok, false);
    assert.equal(hub.grants.list().length, grantsBefore, "Lega never creates a grant");
    // Mission: an approval, nothing created before the owner's click.
    assert.ok(by("propose_mission").ok);
    assert.equal(by("propose_mission", 1).ok, false);
    assert.equal(by("propose_mission", 2).ok, false);
    assert.equal(by("propose_run").ok, false, "runs need the project enabled");
    assert.match(by("propose_run").text, /nu este activat/);
    const proposal = events.find((e) => e.type === "lega.proposal" && e.kind === "mission");
    const approval = hub.approvals.get(proposal.approvalId);
    assert.deepEqual([approval.actionKind, approval.status, approval.payload.title], ["lega.mission_request", "pending", "Audit site client"]);
    assert.equal(hub.missions.list().length, missionsBefore);
    await assert.rejects(hub.commands.dispatch({ type: "approval.decide", payload: { approvalId: approval.id, decision: "approved", displayedHash: approval.payloadHash }, actor: "voice", channel: "voice" }), (e) => e.category === "policy");
    await dispatch(hub, "approval.decide", { approvalId: approval.id, decision: "approved", displayedHash: approval.payloadHash });
    const executed = await hub.commands.executeApproved(proposal.commandId, "user");
    const mission = hub.missions.get(executed.result.id);
    assert.deepEqual([mission.title, mission.status, mission.projectId, mission.acceptance], ["Audit site client", "DRAFT", project.id, ["Raport cu 5 probleme"]]);
    assert.ok(hub.missions.tasks(mission.id).every((task) => task.status === "DRAFT"), "nothing runs from a Lega mission");
    await waitFor(() => t.readLog("codex").some((l) => l.spoke && /Audit site client/.test(l.spoke)), 5000);
    await assert.rejects(hub.commands.dispatch({ type: "lega.propose_mission", payload: { projectId: project.id, kind: "development", title: "Din UI", objective: "Nu se poate." }, actor: "user", channel: "ui" }), (e) => e.category === "policy");
    await dispatch(hub, "lega.session.stop", { sessionId: s.sessionId });
  } finally { await t.cleanup(); }
});

test("M03-ACCESS-05 runs on company projects: enabled only by the owner in the UI with the exact name; withdrawal also revokes grants", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const { project, dir } = addClientProject(t);
    await enableLive(hub, { provider: "codex" });
    const enable = (payload, channel = "ui") => hub.commands.dispatch({ type: "project.execution.enable", payload: { projectId: project.id, ...payload }, actor: "user", channel });
    await assert.rejects(enable({ confirmName: "Client Site" }, "voice"), (e) => e.category === "policy", "voice cannot enable");
    await assert.rejects(enable({ confirmName: "client site" }), (e) => e.category === "validation", "exact name");
    await assert.rejects(hub.commands.dispatch({ type: "project.execution.enable", payload: { projectId: hub.projects.hub().id, confirmName: hub.projects.hub().name }, actor: "user", channel: "ui" }), (e) => e.category === "policy", "the Hub is not toggled");
    const enabled = (await enable({ confirmName: "Client Site" })).result;
    assert.equal(enabled.executionAllowed, true);
    assert.ok(hub.bus.query({ limit: 50 }).some((e) => e.type === "project.execution_enabled" && e.scopeId === project.id));
    assert.equal(hub.gate.evaluate({ provider: "codex", projectId: project.id }).checks.find((c) => c.id === "project_scope").ok, true);
    const again = (await enable({ confirmName: "Client Site" })).result;
    assert.equal(again.version, enabled.version, "idempotent");
    const grant = hub.bus.transaction(() => hub.grants.create({ provider: "codex", projectId: project.id, access: "read-only", maxAttempts: 1, maxDurationS: 600, ttlMinutes: 30 }, "test"));
    // Withdrawal is fail-safe: voice may do it, and the project's run grants go with it.
    const disabled = await dispatch(hub, "project.execution.disable", { projectId: project.id, reason: "test" }, "voice");
    assert.equal(disabled.executionAllowed, false);
    assert.deepEqual(disabled.revokedGrants, [grant.id]);
    assert.equal(hub.grants.get(grant.id).status, "revoked");
    assert.equal(hub.grants.list().filter((g) => g.projectId === hub.projects.hub().id && g.status === "active").length, 1, "other projects keep their grants");
    assert.equal(hub.gate.evaluate({ provider: "codex", projectId: project.id }).checks.find((c) => c.id === "project_scope").ok, false);
    // A project folder replaced by a junction that leads elsewhere is refused.
    const outside = path.join(t.dataDir, "..", `outside-${path.basename(t.dataDir)}`);
    fs.mkdirSync(outside, { recursive: true });
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      let linked = true;
      try { fs.symlinkSync(outside, dir, "junction"); } catch { linked = false; }
      if (linked) await assert.rejects(enable({ confirmName: "Client Site" }), (e) => e.category === "policy");
    } finally { try { fs.rmSync(dir, { force: true, recursive: true }); } catch { /* junction */ } fs.rmSync(outside, { recursive: true, force: true }); }
  } finally { await t.cleanup(); }
});

test("M03-ACCESS-06 web search: only for Lega's process, cached (no live page fetch) by default; each search is shown (redacted) and logged; off means violation", async () => {
  assert.deepEqual(codexBaseOverrides(), CODEX_APP_SERVER_OVERRIDES, "runs keep web search disabled");
  assert.ok(codexBaseOverrides({ webSearch: "live" }).includes('web_search="live"'));
  assert.ok(codexBaseOverrides({ webSearch: "indexed" }).includes('web_search="indexed"'));
  assert.ok(!codexBaseOverrides({ webSearch: "live" }).includes('web_search="disabled"'));
  assert.throws(() => codexBaseOverrides({ webSearch: "everything" }));
  assert.equal(legaAllowedItems("disabled").has("webSearch"), false);
  assert.equal(legaAllowedItems("live").has("webSearch"), true);

  let t = await makeTestHub({ codex: "lega-web" });
  try {
    const { hub } = t;
    await enableLega(hub);
    assert.equal(hub.lega.state(), null);
    const events = liveEvents(hub);
    const s = await dispatch(hub, "lega.session.start", { sdp: OFFER });
    await dispatch(hub, "lega.session.connected", { sessionId: s.sessionId });
    const web = await waitFor(() => events.find((e) => e.type === "lega.web"), 8000);
    assert.match(web.text, /curs euro azi/);
    assert.ok(!web.text.includes(SECRET), "queries are redacted before they are shown or logged");
    const launch = t.readLog("codex").filter((l) => l.launchArgs).at(-1).launchArgs;
    assert.ok(launch.includes('web_search="cached"') && !launch.includes('web_search="disabled"'), "default for Lega: OpenAI's index, no live page fetch");
    await waitFor(() => t.readLog("codex").some((l) => l.spoke && /5 lei/.test(l.spoke)), 5000);
    assert.equal(hub.lega.state().status, "active", "an allowed web search does not end the session");
    assert.ok(hub.bus.query({ limit: 100 }).some((e) => e.type === "lega.web_search"));
    assert.equal(hub.lega.state().webSearch, "cached");
    await dispatch(hub, "lega.session.stop", { sessionId: s.sessionId });
  } finally { await t.cleanup(); }

  t = await makeTestHub({ codex: "lega-web" });
  try {
    const { hub } = t;
    await enableLega(hub);
    await assert.rejects(dispatch(hub, "settings.update", { lega: { webSearch: "everywhere" } }), (e) => e.category === "validation");
    await dispatch(hub, "settings.update", { lega: { webSearch: "disabled" } });
    assert.equal(hub.settings.get("lega").webSearch, "disabled");
    const s = await dispatch(hub, "lega.session.start", { sdp: OFFER });
    await dispatch(hub, "lega.session.connected", { sessionId: s.sessionId });
    const ended = await waitFor(() => (hub.lega.state()?.status === "ended" ? hub.lega.state() : null), 10000);
    assert.equal(ended.endReason, "forbidden:webSearch", "with search off, a web search is a violation");
    const launch = t.readLog("codex").filter((l) => l.launchArgs).at(-1).launchArgs;
    assert.ok(launch.includes('web_search="disabled"'));
  } finally { await t.cleanup(); }
});

test("M03-ACCESS-07 review fixes: company text redacted, prototype keys and oversized args refused, proposals capped", async () => {
  const t = await makeTestHub({ codex: calls([
    { tool: "company_briefing" }, { tool: "how_to", args: { topic: "__proto__" } }, { tool: "project_brief", args: { project: "x".repeat(5000) } },
    { tool: "propose_mission", args: { project: "Client Site", kind: "research", title: "A șasea propunere", objective: "Nu trebuie să apară." } },
  ]) });
  try {
    const { hub } = t;
    const { project } = addClientProject(t);
    const mission = await dispatch(hub, "mission.create", { projectId: project.id, kind: "development", title: "Integrare plăți", objective: "Conectează procesatorul." });
    hub.db.prepare("UPDATE tasks SET status = 'BLOCKED', status_reason = ? WHERE mission_id = ?").run(`cheia ${SECRET} a expirat`, mission.id);
    for (let i = 0; i < 5; i += 1) await hub.commands.dispatch({ type: "lega.propose_mission", payload: { projectId: project.id, kind: "research", title: `Propunerea ${i}`, objective: "Cercetare de test." }, actor: "lega", channel: "test" });
    await enableLega(hub);
    const pendingBefore = hub.approvals.list("pending").length;
    const { s, replies } = await runSession(t, { until: (log) => log.some((l) => l.callsDone) });
    const by = (tool) => replies.find((r) => r.tool === tool);
    assert.match(by("company_briefing").text, /Integrare plăți|Blocate/);
    assert.ok(!by("company_briefing").text.includes(SECRET), "blocked-task reasons are redacted before they reach the model");
    assert.equal(by("how_to").ok, false, "no prototype lookups");
    assert.equal(by("project_brief").ok, false);
    assert.match(by("project_brief").text, /prea lung/);
    assert.equal(by("propose_mission").ok, false);
    assert.match(by("propose_mission").text, /5 propuneri/);
    assert.equal(hub.approvals.list("pending").length, pendingBefore, "no sixth card");
    await dispatch(hub, "lega.session.stop", { sessionId: s.sessionId });
  } finally { await t.cleanup(); }
});

test("M03-ACCESS-08 an enabled project stays safe: a registry path change withdraws runs; a folder swapped for a junction is refused by the gate", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const { project, dir } = addClientProject(t);
    await enableLive(hub, { provider: "codex" });
    await dispatch(hub, "project.execution.enable", { projectId: project.id, confirmName: "Client Site" });
    const scope = () => hub.gate.evaluate({ provider: "codex", projectId: project.id }).checks.find((c) => c.id === "project_scope");
    assert.equal(scope().ok, true);
    // The folder is replaced by a junction to somewhere else after the owner enabled it: the gate refuses the next run.
    const outside = path.join(t.dataDir, "..", `outside-${path.basename(t.dataDir)}`);
    fs.mkdirSync(outside, { recursive: true });
    const moved = `${dir}-moved`;
    fs.renameSync(dir, moved);
    let linked = true;
    try { fs.symlinkSync(outside, dir, "junction"); } catch { linked = false; }
    try {
      if (linked) { assert.equal(scope().ok, false); assert.match(scope().detail, /link sau junction/); }
    } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* junction */ } fs.renameSync(moved, dir); fs.rmSync(outside, { recursive: true, force: true }); }
    assert.equal(scope().ok, true, "the real folder is back");
    // PROJECTS.md now points the same project at another folder: runs are withdrawn until the owner enables them again.
    const other = path.join(t.dataDir, "client-site-v2");
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(t.config.registryPath, `# Projects

## Client Site
- Path: ${other}
- Stack: Next.js
- Status: activ
`);
    hub.projects.syncFromRegistry();
    assert.equal(hub.projects.get(project.id).executionAllowed, false);
    assert.ok(hub.bus.query({ limit: 50 }).some((e) => e.type === "project.execution_disabled" && e.source === "registry"));
    assert.equal(scope().ok, false);
  } finally { await t.cleanup(); }
});
