// Milestone 06-A — the local-only profile (bwrap, own network namespace with loopback only) for the preview of project code
// in ifrim-runner. The flags are checked statically against the canary that attests them (C18); the routing, the in-namespace
// probe, the stop/reap and the honest E2E/review limits run on the SIMULATED distro (tests/fixtures/fake-wsl.mjs: no
// namespace exists there, so isolation is reported "simulated", never measured). The real measurement is in the canary.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTestHub, enableLive, waitFor } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { localOnlyArgs, previewArgv } from "../server/environments/wsl-factory-runner.mjs";
import { CANARY_CHECK_IDS } from "../server/environments/canary.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dispatch = (hub, type, payload, channel = "test") => hub.commands.dispatch({ type, payload, actor: "test", channel }).then((r) => r.result);

async function envHub(state = true) {
  const t = await makeTestHub({ wsl: state, queues: true });
  await dispatch(t.hub, "environment.inspect", { environmentId: "wsl-runner" });
  await dispatch(t.hub, "environment.probe", { environmentId: "wsl-runner" });
  const att = await dispatch(t.hub, "environment.attest", { environmentId: "wsl-runner" });
  return { ...t, att };
}
async function routedFixture(t, fixture = "service-request", { port = null } = {}) {
  await enableLive(t.hub, { provider: "codex", access: "workspace-write", attempts: 1 });
  const dir = path.join(t.dataDir, `factory-${fixture}`);
  materializeFixture(fixture, dir, { port });
  const project = await dispatch(t.hub, "project.register_test", { path: dir });
  await dispatch(t.hub, "project.environment.set", { projectId: project.id, environment: "wsl-runner" });
  return { project, dir };
}

test("M06-PL-01 the preview sandbox flags: namespaces, die-with-parent, clean env, read-only /usr, no host home; same flags as the canary C18", () => {
  const args = localOnlyArgs({ repo: "/home/runner/ws/hub/pv-0123456789abcdef/repo", hostDir: "/home/runner/ws/hub/pv-0123456789abcdef/host", marker: "pv-0123456789abcdef" });
  for (const flag of ["--unshare-all", "--die-with-parent", "--new-session", "--clearenv"]) assert.ok(args.includes(flag), flag);
  assert.ok(!args.includes("--share-net"), "the network namespace is never shared");
  assert.equal(args[args.indexOf("--ro-bind") + 1], "/usr");
  assert.equal(args[args.indexOf("--tmpfs", args.indexOf("--tmpfs") + 1) + 1], "/home", "an empty /home: no ~/.codex, no other workspace");
  assert.ok(!args.some((a) => /^\/mnt\b/.test(a)), "nothing from Windows");
  assert.throws(() => localOnlyArgs({ repo: "/home/runner/ws/hub/x/../../.codex/repo", hostDir: "/home/runner/ws/hub/x/host", marker: "abcd" }), /invalid/);
  assert.throws(() => localOnlyArgs({ repo: "/home/runner/.codex", hostDir: "/home/runner/ws/hub/x/host", marker: "abcd" }), /invalid/);
  assert.deepEqual(previewArgv("npm run dev", { node: "/usr/local/bin/node", npm: "/usr/local/bin/npm" }), ["/usr/local/bin/npm", "run", "dev"]);
  assert.equal(previewArgv("bash -c evil", { node: "n", npm: "m" }), null);
  // The canary attests exactly this profile: every isolation flag used for the preview appears in canary.sh's C18 call.
  const canary = fs.readFileSync(path.join(here, "..", "server", "environments", "scripts", "canary.sh"), "utf8");
  const c18 = canary.slice(canary.indexOf("# C18"), canary.indexOf("# Fingerprint"));
  for (const flag of ["--unshare-all", "--die-with-parent", "--new-session", "--clearenv", "--ro-bind /usr /usr", "--tmpfs /home", "--tmpfs /tmp", "--chdir /work"]) assert.ok(c18.includes(flag), `canary C18 uses ${flag}`);
  for (const id of ["C18a", "C18b", "C18c", "C18d", "C18e", "C18f", "C18g", "C18h", "C18i"]) assert.ok(c18.includes(`res ${id} `), id);
  assert.ok(CANARY_CHECK_IDS.includes("C18"));
});

test("M06-PL-02 stage map with the attested local-only profile: preview inside the environment, E2E BLOCKED (no Linux browser), review a tool boundary → not eligible", async () => {
  const t = await envHub();
  try {
    assert.equal(t.att.byId.C18, "PASS", JSON.stringify(t.att.byId));
    assert.ok(t.hub.wslRunner.attestationStatus().latest.stages.includes("preview-local-only"));
    const { project } = await routedFixture(t);
    const map = t.hub.factoryRunner.stageMap(t.hub.projects.get(project.id));
    const by = Object.fromEntries(map.stages.map((s) => [s.stage, s]));
    assert.equal(by.preview.boundary, "environment", by.preview.where);
    assert.match(by.preview.where, /bwrap/);
    assert.equal(by.e2e.boundary, "blocked");
    assert.match(by.e2e.where, /Chromium pentru Linux nu este instalat/);
    assert.equal(by.review.boundary, "tool", "the reviewer is still Claude on Windows (a tool boundary)");
    assert.equal(map.realProjectEligible, false, "PIPELINE_ISOLATION_VERIFIED is not claimed");
  } finally { await t.cleanup(); }
});

test("M06-PL-03 without C18 in the attestation the profile is not used: the M05 behaviour (preview on Windows) is stated, not hidden", async () => {
  const t = await envHub({ noC18: true });
  try {
    assert.notEqual(t.att.byId.C18, "PASS");
    assert.equal(t.att.status, "PASS_SIMULATED", "C18 only adds coverage: without it C1–C17 still attest the writer/checks/QA");
    assert.ok(!t.hub.wslRunner.attestationStatus().latest.stages.includes("preview-local-only"));
    const { project } = await routedFixture(t);
    const map = t.hub.factoryRunner.stageMap(t.hub.projects.get(project.id));
    const preview = map.stages.find((s) => s.stage === "preview");
    assert.equal(preview.boundary, "windows-sandbox");
    assert.match(preview.where, /profilul doar-local din wsl-runner nu e pregătit/);
  } finally { await t.cleanup(); }
});

test("M06-PL-04 preview in the local-only profile: copy, host script, probe from inside, stop reaps and removes the workspace", async () => {
  const t = await envHub();
  const port = 47000 + Math.floor(Math.random() * 2000);
  try {
    const { project, dir } = await routedFixture(t, "service-request", { port });
    const spec = demoSpec("service-request", { port });
    const key = "m06-preview-test";
    const result = await t.hub.factoryRunner.startPreview({ key, ws: dir, command: spec.spec.verification.preview.command, url: spec.spec.verification.preview.url, project: t.hub.projects.get(project.id) });
    assert.equal(result.status, "PASS", `${result.reason}\n${result.outputTail}`);
    assert.equal(result.inEnvironment, true);
    assert.match(result.reason, /verificat din namespace-ul preview-ului/);
    assert.equal(result.isolationCheck.simulated, true, "the fixture has no namespace: isolation is not claimed as measured");
    assert.match(result.isolation, /SIMULATED/);
    const log = t.wslLog();
    const bw = log.find((e) => e.bwrap);
    assert.ok(bw.bwrap.flags.includes("--unshare-all") && bw.bwrap.flags.includes("--clearenv"));
    assert.ok(log.some((e) => e.script === "env:previewhost"), "the host is written by the versioned script");
    await t.hub.factoryRunner.stop(key);
    await waitFor(() => t.wslLog().some((e) => e.release), 10000);
    assert.ok(t.wslLog().some((e) => e.reap), "stop reaps the workspace processes (marker IFRIM_RUN)");
  } finally { await t.cleanup(); }
});

test("M06-PL-05 factory on the environment route: preview PASS inside the profile, then E2E BLOCKED (infrastructure, not a repair), evidence names the environment", async () => {
  const t = await envHub();
  const port = 47000 + Math.floor(Math.random() * 2000);
  try {
    const { project } = await routedFixture(t, "service-request", { port });
    t.hub.bus.transaction(() => {
      t.hub.grants.create({ provider: "codex", projectId: project.id, access: "workspace-write", maxAttempts: 4, maxDurationS: 900, ttlMinutes: 60 }, "test");
      t.hub.grants.create({ provider: "claude", projectId: project.id, access: "read-only", maxAttempts: 4, maxDurationS: 900, ttlMinutes: 60 }, "test");
    });
    const { mission } = await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("service-request", { port }) });
    t.queue("codex", "factory-write:feature-b-nodedupe", "factory-write:feature-b-dedupe");
    t.queue("claude", "review:pass");
    const scope = t.hub.factory.view(mission.id).scope;
    const requested = await t.hub.commands.dispatch({ type: "factory.start", payload: scope, channel: "test", actor: "test" });
    await dispatch(t.hub, "approval.decide", { approvalId: requested.approval.id, decision: "approved", displayedHash: requested.approval.payloadHash });
    await t.hub.commands.executeApproved(requested.command.id, "user");
    const v = await waitFor(() => { const x = t.hub.factory.view(mission.id); return ["BLOCKED", "NEEDS_OWNER_DECISION", "DELIVERY_READY", "CANCELLED"].includes(x.factory.stage) ? x : null; }, 180000, 200);
    const preview = v.evidence.find((e) => e.stage === "PREVIEW");
    assert.ok(preview, `stage ${v.factory.stage}: ${v.factory.stageReason}`);
    assert.equal(preview.status, "PASS", preview.detail?.reason);
    assert.match(preview.isolation, /bwrap/);
    const e2e = v.evidence.find((e) => e.stage === "E2E");
    assert.equal(e2e?.status, "BLOCKED");
    assert.equal(e2e.runner, "playwright@wsl-runner");
    assert.equal(v.factory.stage, "BLOCKED");
    assert.match(v.factory.stageReason, /Chromium pentru Linux/);
    assert.ok(!v.findings.some((f) => f.area === "e2e"), "a missing browser is not a product finding and starts no repair");
  } finally { await t.cleanup(); }
});
