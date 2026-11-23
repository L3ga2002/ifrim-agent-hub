// 2.20 — the update channel (PASS_SIMULATED / pure): only released tags hub-release/<x.y.z> are offered; a check is read-only; the
// install starts only from the owner session, for the exact version the page showed, on a clean installation. The updater process
// itself (v2/scripts/self-update.mjs) is exercised end to end in v2/tests/manual/self-update-e2e.mjs (real git, real Hub, no model).
import test from "node:test";
import assert from "node:assert/strict";
import { makeTestHub, enrolOwner } from "./helpers.mjs";
import { parseReleaseTags, compareVersions, parseVersion, createUpdateService } from "../server/ops/updates.mjs";
import { HUB_VERSION } from "../server/config.mjs";

const SHA = (c) => c.repeat(40);
const dispatch = (hub, type, payload, ownerSession = null) => hub.commands.dispatch({ type, payload, actor: "test", channel: "test", ownerSession });

test("M20-UPD-01 versions and release tags: only hub-release/<x.y.z>, peeled commits preferred, sorted", () => {
  assert.deepEqual(parseVersion("2.20.0-dist"), [2, 20, 0]);
  assert.equal(parseVersion("latest"), null);
  assert.equal(compareVersions("2.20.1", "2.20.0-dist"), 1);
  assert.equal(compareVersions("2.20.0", "2.20.0-dist"), 0);
  assert.equal(compareVersions("2.9.9", "2.20.0"), -1);
  const out = [
    `${SHA("a")}\trefs/tags/hub-release/2.20.0`,
    `${SHA("b")}\trefs/tags/hub-release/2.20.0^{}`,
    `${SHA("c")}\trefs/tags/hub-release/2.21.0`,
    `${SHA("d")}\trefs/tags/hub-release/not-a-version`,
    `${SHA("e")}\trefs/tags/v2.99.0`,
    `${SHA("f")}\trefs/tags/hub-release/2.10.3`,
  ].join("\n");
  assert.deepEqual(parseReleaseTags(out), [
    { version: "2.10.3", tag: "hub-release/2.10.3", commit: SHA("f") },
    { version: "2.20.0", tag: "hub-release/2.20.0", commit: SHA("b") },
    { version: "2.21.0", tag: "hub-release/2.21.0", commit: SHA("c") },
  ]);
});

function fakeGit({ tags = [], dirty = "", fail = false } = {}) {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    if (args[0] === "rev-parse") return `${SHA("0")}\n`;
    if (args[0] === "ls-remote") { if (fail) throw Object.assign(new Error("fatal: unable to access"), { stderr: "fatal: unable to access 'https://github.com/x': Could not resolve host" }); return tags.map((t) => `${SHA("9")}\trefs/tags/hub-release/${t}`).join("\n"); }
    if (args[0] === "status") return dirty;
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
  return { run, calls };
}

test("M20-UPD-02 a check offers only a NEWER release; failures are recorded, never an offer", async () => {
  const t = await makeTestHub();
  try {
    const { hub, config } = t;
    const newer = fakeGit({ tags: ["2.19.1", "2.20.0", "2.21.3"] });
    const svc = createUpdateService({ config, settings: hub.settings, bus: hub.bus, runGit: newer.run });
    const r = await svc.check("test");
    assert.equal(r.ok, true);
    assert.equal(r.available, compareVersions("2.21.3", HUB_VERSION) === 1);
    assert.equal(svc.status().latest.version, "2.21.3");
    assert.ok(newer.calls.some((a) => a[0] === "ls-remote" && a.includes("refs/tags/hub-release/*")), "only the release tags are read");
    const same = createUpdateService({ config, settings: hub.settings, bus: hub.bus, runGit: fakeGit({ tags: ["2.19.0"] }).run });
    assert.equal((await same.check("test")).available, false);
    assert.equal(same.status().available, false);
    const broken = createUpdateService({ config, settings: hub.settings, bus: hub.bus, runGit: fakeGit({ fail: true }).run });
    const failed = await broken.check("test");
    assert.equal(failed.ok, false);
    assert.equal(failed.available, false);
    assert.match(failed.error, /Could not resolve host/);
    assert.equal(hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'update.checked'").get().n, 3);
  } finally { await t.cleanup(); }
});

test("M20-UPD-03 installing: owner session only, the version shown, a clean installation; the updater is started once with the tag and its commit", async () => {
  const launched = [];
  let dirty = "";
  const git = fakeGit({ tags: ["99.0.0"] });
  const t = await makeTestHub({ hubOptions: { updateOptions: { runGit: async (args) => (args[0] === "status" ? dirty : git.run(args)), spawnUpdater: (args) => { launched.push(args); return 4242; } } } });
  try {
    const { hub } = t;
    await dispatch(hub, "update.check", {});
    assert.equal(hub.updates.status().available, true);
    await assert.rejects(dispatch(hub, "update.apply", { version: "99.0.0" }), /sesiun|session/i);
    const owner = await enrolOwner(t);
    await assert.rejects(dispatch(hub, "update.apply", { version: "98.0.0" }, owner.reauth()), /ultima versiune publicată este 99.0.0/);
    dirty = " M v2/server/config.mjs\n";
    await assert.rejects(dispatch(hub, "update.apply", { version: "99.0.0" }, owner.reauth()), /modificate local/);
    dirty = "";
    const started = await dispatch(hub, "update.apply", { version: "99.0.0" }, owner.reauth());
    assert.equal(started.result.started, true);
    assert.equal(launched.length, 1);
    assert.ok(launched[0][0].endsWith("self-update.mjs"));
    assert.deepEqual(launched[0].slice(1), ["--to", "hub-release/99.0.0", "--expect-commit", SHA("9")]);
    assert.equal(hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'update.started'").get().n, 1);
  } finally { await t.cleanup(); }
});
