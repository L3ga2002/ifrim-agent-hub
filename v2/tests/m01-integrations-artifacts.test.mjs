import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub } from "./helpers.mjs";
import { catalogEntry } from "../server/policy/approval-policy.mjs";

const run = (hub, type, payload = {}) => hub.commands.dispatch({ type, payload, actor: "user", channel: "test" });

test("M01-INT-01 tool/connector registry: Hub tools + observed integrations, each with the Hub approval policy (vendor prompts never replace it)", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const all = hub.integrations.list();
    const hubTools = all.filter((i) => i.kind === "hub_tool");
    assert.equal(hubTools.length, hub.tools.definitions.length, "every Hub tool is registered");
    assert.ok(all.some((i) => i.kind === "claude_connector"), "Claude connectors from the snapshot");
    assert.ok(all.some((i) => i.kind === "codex_plugin"), "Codex plugins from the snapshot");
    for (const i of all) {
      assert.equal(i.approvalPolicy.vendorPromptReplacesHub, false, i.id);
      assert.ok(["AUTO_ALLOWED", "ASK_ONCE_FOR_TASK", "ALWAYS_ASK", "DENIED"].includes(i.approvalPolicy.policy), i.id);
      assert.ok(["none", "local", "external", "unknown"].includes(i.sideEffects), i.id);
    }
    // Anything that writes outside the machine is at least ALWAYS_ASK.
    for (const i of all.filter((x) => x.sideEffects === "external")) {
      assert.ok(["ALWAYS_ASK", "DENIED"].includes(i.approvalPolicy.policy), `${i.id} → ${i.approvalPolicy.policy}`);
    }
    const blocked = hubTools.filter((i) => i.status === "blocked").map((i) => i.name).sort();
    assert.deepEqual(blocked, ["desktop.control", "screen.capture"]);
    // M02: browser.inspect is dynamic — needs_setup until Playwright is installed with approval, then approval per exact URL; never AUTO.
    const browser = hubTools.find((i) => i.name === "browser.inspect");
    const installed = hub.tools.browserStatus().installed;
    assert.equal(browser.status, installed ? "available" : "needs_setup", browser.statusReason);
    assert.equal(browser.approvalPolicy.policy, "ALWAYS_ASK");
    const openclaw = all.find((i) => i.kind === "openclaw_integration");
    assert.equal(openclaw.status, "blocked", "OpenClaw is retired from the V2 runtime");
    assert.equal(catalogEntry("connector.write").loosest, "ALWAYS_ASK");
  } finally { await t.cleanup(); }
});

test("M01-SURF-ASSIST ExecutionSurfaceAdapter: ASSISTED start prepares a brief + artifact and waits for the provider; programmatic surfaces refuse assisted prep; UNSUPPORTED is a real error", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const mission = (await run(hub, "mission.create", { projectId: "ifrim-agent-hub", kind: "research", title: "Competitor scan", objective: "Find three competitors with sources" })).result;
    const [question] = hub.missions.tasks(mission.id);
    await run(hub, "task.command", { taskId: question.id, action: "queue", reason: "ready" });
    const prep = (await run(hub, "assisted.prepare", { taskId: question.id, surfaceId: "anthropic.claude_research" })).result;
    assert.match(prep.brief, /rulezi tu în aplicația vendorului/);
    assert.match(prep.brief, /Fără secrete/);
    assert.equal(prep.artifact.kind, "assisted_brief");
    assert.equal(prep.artifact.surfaceId, "anthropic.claude_research");
    assert.ok(fs.existsSync(path.join(t.config.hubRoot, prep.briefFile)), "brief written under the Hub work dir");
    assert.equal(hub.missions.task(question.id).status, "WAITING_PROVIDER");
    assert.ok(hub.bus.query({ typePrefix: "provider.native_task_prepared" }).length >= 1);

    await assert.rejects(run(hub, "assisted.prepare", { taskId: question.id, surfaceId: "openai.codex_app_server" }), (e) => e.category === "validation" && /nu este o suprafață asistată/.test(e.message));
    await assert.rejects(run(hub, "assisted.prepare", { taskId: question.id, surfaceId: "openai.agents_api" }), (e) => e.category === "validation" && /UNSUPPORTED/.test(e.message) && e.details?.support === "UNSUPPORTED");
    await assert.rejects(run(hub, "assisted.prepare", { taskId: question.id, surfaceId: "nope.surface" }), (e) => e.category === "not_found");
  } finally { await t.cleanup(); }
});

test("M01-ART-01 ArtifactReference: native refs and project files are versioned; secrets and files outside the project are refused", async () => {
  const t = await makeTestHub();
  try {
    const { hub, projectDir } = t;
    const a1 = (await run(hub, "artifact.register", { projectId: "ifrim-agent-hub", kind: "report", title: "Market scan", source: "claude_research", surfaceId: "anthropic.claude_research", nativeRef: "https://claude.ai/chat/example-1" })).result;
    const a2 = (await run(hub, "artifact.register", { projectId: "ifrim-agent-hub", kind: "report", title: "Market scan v2", source: "claude_research", nativeRef: "https://claude.ai/chat/example-1" })).result;
    assert.equal(a1.version, 1);
    assert.equal(a2.version, 2, "same native ref → new version");
    fs.writeFileSync(path.join(projectDir, "notes.md"), "# Notes\n");
    const file = (await run(hub, "artifact.register", { projectId: "ifrim-agent-hub", kind: "doc", title: "Notes", source: "local_file", filePath: "notes.md" })).result;
    assert.match(file.sha256, /^[0-9a-f]{64}$/);
    assert.equal(file.path, "notes.md");
    fs.writeFileSync(path.join(projectDir, ".env"), "X=1\n");
    await assert.rejects(run(hub, "artifact.register", { projectId: "ifrim-agent-hub", kind: "doc", title: "env", source: "local_file", filePath: ".env" }), (e) => e.category === "policy");
    await assert.rejects(run(hub, "artifact.register", { projectId: "ifrim-agent-hub", kind: "doc", title: "outside", source: "local_file", filePath: "../outside.txt" }), (e) => e.category === "policy");
    await assert.rejects(run(hub, "artifact.register", { projectId: "ifrim-agent-hub", kind: "doc", title: "bad ref", source: "other", nativeRef: "javascript:alert(1)" }), (e) => e.category === "validation");
  } finally { await t.cleanup(); }
});

test("M01-BKP-SLUG regression: a backup requested by project slug is stored under the project id and satisfies the gate lookup", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const backup = (await run(hub, "backup.run", { projectId: "ifrim-agent-hub" })).result;
    assert.equal(backup.status, "verified");
    const project = hub.projects.hub();
    assert.equal(backup.projectId, project.id, "stored under the canonical project id, not the slug");
    const fresh = hub.backups.freshVerified(project.id);
    assert.equal(fresh.ok, true);
    assert.equal(fresh.backup.id, backup.id);
    assert.equal(hub.backups.freshVerified("ifrim-agent-hub").backup.id, backup.id, "slug lookups work too");
    // A legacy row keyed by the slug (written before the fix) is still found.
    hub.db.prepare("UPDATE backups SET project_id = 'ifrim-agent-hub' WHERE id = ?").run(backup.id);
    assert.equal(hub.backups.freshVerified(project.id).backup.id, backup.id);
    assert.equal(hub.backups.list(project.id).length, 1);
  } finally { await t.cleanup(); }
});
