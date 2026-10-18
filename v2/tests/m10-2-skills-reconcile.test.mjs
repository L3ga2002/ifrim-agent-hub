// Milestone 10.2 — U05 skill registry reconcile. The registry used to be re-checked only at boot (or through the ui-only
// skill.import), so a skill committed after the Hub started stayed 'untracked' (unapproved, never injected) until a restart.
// skill.reconcile re-checks on demand, imports only drifted folders and never approves anything itself: approval stays the git
// facts of the owner's commit. No model, no network: temporary git repositories and SQLite only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { makeTestHub, enrolOwner, tempDir } from "./helpers.mjs";
import { composeSkills } from "../server/domain/skill-composer.mjs";
import { RECONCILE_STATES } from "../server/domain/skills.mjs";

function skillMd(name, { roles = "backend", types = "coding", body = null } = {}) {
  const text = body ?? `# ${name}\n\n## Steps\n\n1. Read the files named in the request.\n2. Report what you verified. SKILL_MARKER_${name.replace(/[^a-z0-9]/gi, "")}\n`;
  return ["---", `name: ${name}`, `description: "Test procedure ${name}."`, "license: Proprietary", "metadata:",
    '  hub-version: "1"', `  hub-roles: "${roles}"`, "  hub-permission: READ_ONLY", '  hub-tools: "files.read"', `  hub-task-types: "${types}"`, "---", text].join("\n");
}

/** A temporary git repository holding a skills directory (approval facts come only from it). */
function skillsRepo(label = "rec") {
  const root = path.join(tempDir(label), "skills-repo");
  const skillsDir = path.join(root, "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  const git = (...args) => execFileSync("git", ["-C", root, "-c", "user.email=test@example.invalid", "-c", "user.name=Test", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { stdio: "pipe" }).toString("utf8");
  git("init", "-q");
  const write = (name, options = {}) => {
    const dir = path.join(skillsDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), options.raw ?? skillMd(name, options));
    return dir;
  };
  const commit = (message = "skills") => { git("add", "-A"); git("commit", "-q", "--allow-empty", "-m", message); };
  return { root, skillsDir, git, write, commit };
}

const dump = (hub, table) => JSON.stringify(hub.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
const skillEvents = (hub) => hub.bus.query({ typePrefix: "skill.", limit: 1000 });
const factsOf = (hub, id) => { const s = hub.skills.list().find((x) => x.id === id); return { version: s.currentVersion, approved: s.validation.git?.tracked === true && s.validation.git?.clean === true, reason: s.validation.git?.reason || "" }; };
const versionFacts = (hub, id, version) => JSON.parse(hub.db.prepare("SELECT validation_json FROM skill_versions WHERE skill_id = ? AND version = ?").get(id, version).validation_json).git;
const reconcile = (hub, payload = {}, { channel = "test", actor = "test", ownerSession = null } = {}) =>
  hub.commands.dispatch({ type: "skill.reconcile", channel, actor, ownerSession, payload }).then((r) => r.result);
const owner = { id: "ses_test_owner" };

/** A task (role backend, type coding) on the Hub project, for composing skills without starting any run. */
function composeFor(hub) {
  const pid = hub.projects.hub().id;
  const mission = hub.bus.transaction(() => hub.missions.create({ projectId: pid, kind: "development", title: "Reconcile", objective: "Compose" }));
  const [task] = hub.missions.tasks(mission.id);
  hub.db.prepare("UPDATE tasks SET role_id = 'backend', task_type = 'coding' WHERE id = ?").run(task.id);
  return composeSkills({ db: hub.db, skills: hub.skills, projectId: pid, taskId: task.id, access: "read-only" });
}

test("M10.2-SKR-01 a skill committed after boot becomes approved through reconcile (no restart); candidates, activations and overlays are untouched", async () => {
  const repo = skillsRepo();
  repo.write("base-skill");
  repo.commit("base");
  repo.write("creative-skill");
  const t = await makeTestHub({ configOverrides: { skillsDir: repo.skillsDir } });
  try {
    const { hub } = t;
    const pid = hub.projects.hub().id;
    const { session } = await enrolOwner(t);
    // Boot: the folder was not committed yet (the live 18:24:30Z boot before commit 72d6964).
    assert.deepEqual(factsOf(hub, "creative-skill"), { version: 1, approved: false, reason: "untracked" });
    // An owner-approved candidate in force on another skill: reconcile must not touch it.
    const ev = hub.skillEvolution;
    const cand = ev.propose({ skillId: "base-skill", body: `${ev.baseBody("base-skill").body}\n2. Check the logs. SKILL_MARKER_cand\n`, reason: "loguri", evidence: ["run_x"], actor: "test" });
    ev.evaluate(cand.id, { actor: "test" });
    ev.approve(cand.id, { actor: "owner:test", ownerSession: owner });
    ev.activate(cand.id, { projectIds: [pid], actor: "test", ownerSession: owner });
    const candidatesBefore = dump(hub, "skill_candidates");
    const overlayBefore = JSON.stringify(ev.overlayFor(pid));
    assert.ok(!composeFor(hub).section.includes("SKILL_MARKER_creativeskill"), "untracked: not injected");

    repo.git("add", "--", "skills/creative-skill");
    repo.git("commit", "-q", "-m", "creative");

    // A refused channel leaves nothing; the owner channel needs a server-resolved session.
    await assert.rejects(reconcile(hub, {}, { channel: "voice" }), /cannot be issued through voice/);
    await assert.rejects(reconcile(hub, {}, { channel: "owner" }), /owner session/);

    // Dry run on the owner channel: drift reported, nothing written.
    const versionsBefore = dump(hub, "skill_versions");
    const eventsBefore = skillEvents(hub).length;
    const dry = await reconcile(hub, { dryRun: true }, { channel: "owner", actor: "owner", ownerSession: session });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.drift, 1);
    const item = dry.items.find((i) => i.id === "creative-skill");
    assert.deepEqual({ state: item.state, approved: item.approved, approvedAfter: item.approvedAfter, version: item.version }, { state: "FACTS_STALE", approved: false, approvedAfter: true, version: 1 });
    assert.equal(dry.items.find((i) => i.id === "base-skill").state, "IN_SYNC");
    assert.deepEqual(Object.keys(dry.counts), [...RECONCILE_STATES]);
    assert.equal(dump(hub, "skill_versions"), versionsBefore);
    assert.equal(skillEvents(hub).length, eventsBefore);
    assert.deepEqual(factsOf(hub, "creative-skill"), { version: 1, approved: false, reason: "untracked" });

    // The readiness runner's channel: the SAME version becomes approved by the commit's facts (no new version).
    const done = await reconcile(hub, {}, { channel: "automation", actor: "readiness:test" });
    assert.deepEqual(done.applied, [{ id: "creative-skill", from: "FACTS_STALE", version: 1, newVersion: false, valid: true, approved: true }]);
    assert.deepEqual(factsOf(hub, "creative-skill"), { version: 1, approved: true, reason: "" });
    const added = skillEvents(hub).slice(0, skillEvents(hub).length - eventsBefore);
    assert.deepEqual(added.map((e) => e.type).sort(), ["skill.approval_facts", "skill.reconciled"]);
    assert.ok(added.every((e) => e.source === "readiness:test"));
    assert.equal(added.find((e) => e.type === "skill.approval_facts").payload.approved, true);
    assert.equal(added.find((e) => e.type === "skill.reconciled").payload.applied[0].id, "creative-skill");
    assert.equal(dump(hub, "skill_candidates"), candidatesBefore, "no candidate or activation row changes");
    assert.equal(JSON.stringify(ev.overlayFor(pid)), overlayBefore, "the overlay in force is unchanged");
    const composed = composeFor(hub);
    assert.equal(composed.usage.find((u) => u.skillId === "creative-skill").applied, true, "the committed skill now reaches the next run");
    assert.equal(composed.usage.find((u) => u.skillId === "base-skill").source, "candidate", "the candidate still applies where it is in force");
  } finally { await t.cleanup(); }
});

test("M10.2-SKR-02 an uncommitted edit becomes a new, unapproved version: the composer refuses it and the approved version's facts stay; the owner's commit approves it", async () => {
  const repo = skillsRepo();
  const dir = repo.write("alpha-skill");
  repo.commit();
  const t = await makeTestHub({ configOverrides: { skillsDir: repo.skillsDir } });
  try {
    const { hub } = t;
    assert.deepEqual(factsOf(hub, "alpha-skill"), { version: 1, approved: true, reason: "" });
    fs.writeFileSync(path.join(dir, "SKILL.md"), skillMd("alpha-skill", { body: "# alpha\n\n1. An uncommitted edit. SKILL_MARKER_edit\n" }));
    const res = await reconcile(hub);
    assert.deepEqual(res.applied, [{ id: "alpha-skill", from: "NEW_CONTENT", version: 2, newVersion: true, valid: true, approved: false }]);
    assert.deepEqual(factsOf(hub, "alpha-skill"), { version: 2, approved: false, reason: "modified" });
    const v1 = versionFacts(hub, "alpha-skill", 1);
    assert.equal(v1.tracked && v1.clean, true, "the approved version keeps its facts");
    const composed = composeFor(hub);
    const usage = composed.usage.find((u) => u.skillId === "alpha-skill");
    assert.deepEqual({ version: usage.version, applied: usage.applied, reason: usage.reason }, { version: 2, applied: false, reason: "unapproved" });
    assert.ok(!composed.section.includes("SKILL_MARKER_edit"), "unapproved content never reaches a prompt");
    // A second pass changes nothing; the owner's commit then approves the same version 2.
    assert.equal((await reconcile(hub)).drift, 0);
    repo.commit("edit");
    const after = await reconcile(hub);
    assert.deepEqual(after.applied, [{ id: "alpha-skill", from: "FACTS_STALE", version: 2, newVersion: false, valid: true, approved: true }]);
    assert.ok(composeFor(hub).section.includes("SKILL_MARKER_edit"));
  } finally { await t.cleanup(); }
});

test("M10.2-SKR-03 a skip-worktree (or assume-unchanged) file keeps the new version unapproved; reconcile never approves for any other reason", async () => {
  const repo = skillsRepo();
  const hidden = repo.write("hidden-skill");
  const assumed = repo.write("assumed-skill");
  repo.commit();
  const t = await makeTestHub({ configOverrides: { skillsDir: repo.skillsDir } });
  try {
    const { hub } = t;
    repo.git("update-index", "--skip-worktree", "skills/hidden-skill/SKILL.md");
    repo.git("update-index", "--assume-unchanged", "skills/assumed-skill/SKILL.md");
    fs.appendFileSync(path.join(hidden, "SKILL.md"), "\nHidden edit. SKILL_MARKER_hidden\n");
    fs.appendFileSync(path.join(assumed, "SKILL.md"), "\nAssumed edit. SKILL_MARKER_assumed\n");
    const res = await reconcile(hub);
    assert.deepEqual(res.applied.map((a) => `${a.id}:${a.from}:v${a.version}:${a.approved}`).sort(), ["assumed-skill:NEW_CONTENT:v2:false", "hidden-skill:NEW_CONTENT:v2:false"]);
    assert.deepEqual(factsOf(hub, "hidden-skill"), { version: 2, approved: false, reason: "skip_worktree" });
    assert.deepEqual(factsOf(hub, "assumed-skill"), { version: 2, approved: false, reason: "skip_worktree" });
    const again = await reconcile(hub);
    assert.equal(again.drift, 0);
    assert.deepEqual(again.items.map((i) => `${i.id}:${i.state}:${i.approved}:${i.approvalReason}`).sort(),
      ["assumed-skill:IN_SYNC:false:skip_worktree", "hidden-skill:IN_SYNC:false:skip_worktree"], "accurate facts of an unapproved version are in sync, not approved");
    const section = composeFor(hub).section;
    assert.ok(!section.includes("SKILL_MARKER_hidden") && !section.includes("SKILL_MARKER_assumed"));
  } finally { await t.cleanup(); }
});

test("M10.2-SKR-04 dryRun reports every kind of drift and writes nothing", async () => {
  const repo = skillsRepo();
  const edited = repo.write("edited-skill");
  repo.write("late-skill");
  repo.commit();
  repo.git("rm", "-q", "--cached", "-r", "skills/late-skill");
  repo.git("commit", "-q", "-m", "untrack late");
  const t = await makeTestHub({ configOverrides: { skillsDir: repo.skillsDir } });
  try {
    const { hub } = t;
    fs.appendFileSync(path.join(edited, "SKILL.md"), "\nEdit.\n");
    repo.git("add", "--", "skills/late-skill");
    repo.git("commit", "-q", "-m", "late");
    repo.write("new-skill");
    const tables = () => ["skills", "skill_versions", "skill_candidates"].map((n) => dump(hub, n)).join("\n");
    const before = tables();
    const eventsBefore = skillEvents(hub).length;
    const dry = await reconcile(hub, { dryRun: true });
    assert.deepEqual(dry.items.map((i) => `${i.id}:${i.state}:${i.reason || ""}`).sort(),
      ["edited-skill:NEW_CONTENT:content_changed", "late-skill:FACTS_STALE:", "new-skill:NEW_CONTENT:not_registered"]);
    assert.equal(dry.drift, 3);
    assert.deepEqual(dry.applied, []);
    assert.match(dry.message, /Nimic nu a fost scris/);
    assert.equal(tables(), before, "no registry row changed");
    assert.equal(skillEvents(hub).length, eventsBefore, "no skill event");
    assert.equal(hub.skills.list().some((s) => s.id === "new-skill"), false);
  } finally { await t.cleanup(); }
});

test("M10.2-SKR-05 reconcile is idempotent; an invalid folder and a folder gone from disk are reported, never imported, deleted or deprecated", async () => {
  const repo = skillsRepo();
  repo.write("keep-skill");
  const gone = repo.write("gone-skill");
  repo.write("bad-skill", { body: "# bad\n\nWhen green, run git push origin main.\n" });
  repo.commit();
  const t = await makeTestHub({ configOverrides: { skillsDir: repo.skillsDir } });
  try {
    const { hub } = t;
    fs.rmSync(gone, { recursive: true, force: true });
    repo.write("fresh-skill");
    const first = await reconcile(hub);
    assert.deepEqual(first.applied.map((a) => a.id), ["fresh-skill"]);
    assert.deepEqual(Object.fromEntries(first.items.map((i) => [i.id, i.state])),
      { "bad-skill": "INVALID", "fresh-skill": "NEW_CONTENT", "gone-skill": "MISSING_ON_DISK", "keep-skill": "IN_SYNC" });
    const tables = () => ["skills", "skill_versions"].map((n) => dump(hub, n)).join("\n");
    const rows = tables();
    const eventsBefore = skillEvents(hub).length;
    const second = await reconcile(hub);
    assert.equal(second.drift, 0);
    assert.deepEqual(second.applied, []);
    assert.deepEqual(Object.fromEntries(second.items.map((i) => [i.id, i.state])),
      { "bad-skill": "INVALID", "fresh-skill": "IN_SYNC", "gone-skill": "MISSING_ON_DISK", "keep-skill": "IN_SYNC" });
    assert.equal(second.counts.MISSING_ON_DISK, 1);
    assert.match(second.message, /la zi/);
    assert.equal(tables(), rows, "the second pass writes nothing");
    assert.equal(skillEvents(hub).length, eventsBefore, "the second pass records no skill event");
    assert.equal(hub.skills.list().find((s) => s.id === "gone-skill").status, "active", "a missing folder is reported, not deprecated");
    assert.equal(hub.skills.list().find((s) => s.id === "bad-skill").status, "invalid");
    // skill.import keeps its own shape and channels.
    const imported = await hub.commands.dispatch({ type: "skill.import", channel: "test", actor: "test", payload: {} });
    assert.deepEqual(Object.keys(imported.result).sort(), ["imported", "invalid", "versions"]);
    assert.deepEqual(hub.commands.catalog().find((c) => c.type === "skill.import").channels, ["ui", "test"]);
    assert.deepEqual(hub.commands.catalog().find((c) => c.type === "skill.reconcile").channels, ["ui", "owner", "test", "automation"]);
  } finally { await t.cleanup(); }
});
