// Milestone 09 — regressions for the findings of the M09 adversarial review that are wired through the Hub (PASS_SIMULATED:
// fixture providers, a temp data dir under .ifrim/tmp, real ffmpeg only through the test proxy when present). Each test names
// the finding it pins. Module-level regressions live next to their modules' tests (DS-16, QA-16/17, RN-13/13b, CP-08/09,
// SK-07, LG-06). No model, no network, no live Hub.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { makeTestHub, enableLive, waitFor, tempDir } from "./helpers.mjs";
import { realLaunchers, makeSyntheticMedia } from "./media-helpers.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { hashCanonical } from "../server/core/canonical.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { newId } from "../server/core/ids.mjs";

const dispatch = (hub, type, payload, channel = "test", extra = {}) => hub.commands.dispatch({ type, payload, channel, actor: "test", ...extra });
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
function conversation(hub, project, text = "verifică") {
  const conv = hub.conversations.create({ projectId: project.id, title: "m09-rf" }, "test");
  hub.conversations.addMessage({ conversationId: conv.id, role: "user", content: text }, "test");
  return conv;
}

test("M09-RF-01 (review R26) the billing evidence withdrawn while the run waited for backup/git: refused before the provider, attempt refunded", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const { project, grant } = await enableLive(hub, { provider: "codex", attempts: 2 });
    // The first evaluation (the gate) passes; the second one — the re-check after backup + git state — sees the evidence gone.
    const real = hub.gate.evaluate;
    let calls = 0;
    hub.gate.evaluate = (args) => {
      const d = real(args);
      calls += 1;
      if (calls !== 2) return d;
      return { ...d, allowed: false, checks: d.checks.map((c) => (c.id === "billing_route" ? { ...c, ok: false, detail: "declarația a fost retrasă între timp (test)" } : c)) };
    };
    try {
      await assert.rejects(hub.runs.start({ conversationId: conversation(hub, project).id, provider: "codex", access: "read-only", grantId: grant.id, model: "gpt-fake-sol", actor: "test" }),
        (e) => e.category === "gate" && /Billing evidence changed/.test(e.message));
    } finally { hub.gate.evaluate = real; }
    assert.equal(calls, 2, "gate + one re-check");
    assert.equal(hub.grants.get(grant.id).attemptsUsed, 0, "nothing reached the provider: the attempt went back");
    const blocked = hub.db.prepare("SELECT status, error_category, error_message FROM agent_runs ORDER BY created_at DESC LIMIT 1").get();
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.error_message, /billing_route: declarația a fost retrasă/);
    assert.equal(t.readLog("codex").filter((e) => e.method === "turn/start").length, 0, "no turn was sent");
    // The lease and the conversation are free again: the next run starts normally.
    const { run } = await hub.runs.start({ conversationId: conversation(hub, project).id, provider: "codex", access: "read-only", grantId: grant.id, model: "gpt-fake-sol", actor: "test" });
    const done = await waitFor(() => { const r = hub.runs.getRun(run.id); return ["completed", "failed", "blocked"].includes(r.status) ? r : null; }, 60000);
    assert.equal(done.status, "completed", done.errorMessage);
  } finally { await t.cleanup(); }
});

test("M09-RF-02 (review R10/R15) upload: streamed to the work folder, imported by the validated command, the temporary file removed; refusals leave nothing", async (ctx) => {
  const launchers = realLaunchers();
  const t = await makeTestHub(launchers.available ? { configOverrides: { mediaTools: { launcher: launchers } } } : {});
  const { server, token } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  const host = `localhost:${t.config.port}`;
  const post = (p, body, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: t.config.port, method: "POST", path: p, headers: { Host: host, Origin: `http://${host}`, "X-Hub-Token": token,
      "Content-Type": "application/octet-stream", "Content-Length": body.length, ...headers } }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* */ } resolve({ status: res.statusCode, json }); });
    });
    req.on("error", reject); req.write(body); req.end();
  });
  const uploads = path.join(path.dirname(t.config.mediaWorkDir), "media-uploads");
  const leftovers = () => (fs.existsSync(uploads) ? fs.readdirSync(uploads) : []);
  try {
    // A refused type and a refused content type leave nothing behind.
    assert.equal((await post("/api/media/upload?filename=x.exe", Buffer.from("MZ"))).status, 400);
    assert.equal((await post("/api/media/upload?filename=x.mp4", Buffer.from("x"), { "Content-Type": "text/plain" })).status, 400);
    assert.deepEqual(leftovers(), []);
    if (!launchers.available) { ctx.diagnostic("SKIPPED_ENV: the import half needs ffmpeg/ffprobe for a decodable file"); return; }
    const file = makeSyntheticMedia(path.join(tempDir("m09-rf-up"), "in"), { name: "u.mp4", seconds: 1 });
    const bytes = fs.readFileSync(file);
    const r = await post(`/api/media/upload?filename=u.mp4&title=${encodeURIComponent("Încărcare test")}&origin=OWNED`, bytes);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const result = r.json.result || r.json;
    assert.equal(result.version.sha256, sha(bytes), "the library holds exactly the uploaded bytes");
    assert.equal(result.version.status, "READY");
    assert.deepEqual(leftovers(), [], "the temporary upload is removed after the import");
  } finally { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await t.cleanup(); }
});

test("M09-RF-03 (review R12) import roots: a folder on another drive is accepted; a folder over the repository is refused", async (ctx) => {
  const t = await makeTestHub();
  try {
    await assert.rejects(dispatch(t.hub, "media.policy.import_roots", { roots: [path.dirname(t.config.hubRoot)] }), /repo sau datele Hub-ului/);
    const repoDrive = path.parse(path.resolve(t.config.hubRoot)).root.toUpperCase();
    const other = process.platform === "win32" ? "DEFGHIJKLMNOPQRSTUVWXYZ".split("").map((d) => `${d}:\\`).find((d) => d !== repoDrive && (() => { try { return fs.statSync(d).isDirectory(); } catch { return false; } })()) : null;
    if (!other) { ctx.diagnostic("SKIPPED_ENV: no second drive on this machine"); return; }
    const r = (await dispatch(t.hub, "media.policy.import_roots", { roots: [other] })).result;
    assert.deepEqual(r.roots, [other], "path.relative across drives is absolute: not inside the repo, so not refused");
    assert.deepEqual(t.hub.settings.get("mediaPolicy").importRoots, [other]);
  } finally { await t.cleanup(); }
});

test("M09-RF-04 (review R35) a re-probe that finds the same facts keeps the scope hash (approval and envelope stay valid); a model change does not", async () => {
  const t = await makeTestHub({ queues: true });
  try {
    const { hub } = t;
    await enableLive(hub, { provider: "codex", access: "workspace-write", attempts: 1 });
    const dir = path.join(t.dataDir, "factory-bug-demo");
    materializeFixture("bug-demo", dir);
    const project = (await dispatch(hub, "project.register_test", { path: dir })).result;
    const { mission } = (await dispatch(hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" } })).result;
    const before = hub.factory.view(mission.id).scope;
    assert.ok(before, "the scope is complete");
    assert.equal(before.bindings.writer.resolutionEvidence.probedAt, undefined, "no evidence timestamp inside the approvable scope");
    const later = new Date(Date.now() + 3600000).toISOString();
    const codex = hub.providerState.get("codex");
    const claude = hub.providerState.get("claude");
    hub.providerState.set("codex", { ...codex, probedAt: later, modelsCheckedAt: later });
    hub.providerState.set("claude", { ...claude, probedAt: later, installationCheckedAt: later });
    assert.equal(hashCanonical(hub.factory.view(mission.id).scope), hashCanonical(before), "same facts, later probe: same scope");
    // A material change (the Claude CLI version the alias resolves through) changes the scope: a new approval is needed.
    hub.providerState.set("claude", { ...claude, installation: { ...claude.installation, version: "2.1.999 (Claude Code)" } });
    assert.notEqual(hashCanonical(hub.factory.view(mission.id).scope), hashCanonical(before));
  } finally { await t.cleanup(); }
});

test("M09-RF-05 (review R37) an envelope-derived grant serves only the mission it was derived for, even with the same model binding", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const project = hub.projects.hub();
    const binding = { role: "writer", provider: "codex", model: "gpt-fake-sol", effort: "medium", bindingHash: "a".repeat(64), missionId: "mis_A" };
    const g = hub.bus.transaction(() => hub.grants.create({ provider: "codex", projectId: project.id, access: "workspace-write", maxAttempts: 2, maxDurationS: 600, ttlMinutes: 30,
      envelopeId: "env_test", binding }, "test"));
    assert.equal(g.binding.missionId, "mis_A", "the mission is stored with the binding");
    const ask = (missionId, bindingHash = binding.bindingHash) => hub.grants.problem(hub.grants.get(g.id), { provider: "codex", projectId: project.id, access: "workspace-write", now: new Date(), bindingHash, missionId });
    assert.equal(ask("mis_A"), null);
    assert.match(ask("mis_B"), /derivat pentru misiunea mis_A/);
    assert.match(ask(null), /derivat pentru misiunea mis_A/, "a bound run outside any mission cannot use it either");
    assert.match(ask("mis_A", "b".repeat(64)), /alt model sau alt efort/, "the model binding is still checked first");
    assert.equal(hub.grants.findUsable("codex", project.id, "workspace-write", "run", { bindingHash: binding.bindingHash, missionId: "mis_B" })?.id === g.id
      && !ask("mis_B"), false, "findUsable never hands mis_B a usable grant of mis_A");
  } finally { await t.cleanup(); }
});

test("M09-RF-06 (review R27) settings.update never returns the billing identity salt", async () => {
  const t = await makeTestHub();
  try {
    t.hub.bus.transaction(() => t.hub.settings.set("billingIdentitySecret", "0123456789abcdef0123456789abcdef", "test"));
    const r = await dispatch(t.hub, "settings.update", { usageReservePercent: 20 }, "ui");
    const text = JSON.stringify(r.result);
    assert.ok(!text.includes("0123456789abcdef0123456789abcdef"));
    assert.ok(!("billingIdentitySecret" in (r.result || {})));
  } finally { await t.cleanup(); }
});

test("M09-RF-07 (review R6) revoking a right re-checks at once every approved manifest that uses the material: it is invalidated and its packs withdrawn", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const { db } = hub;
    const at = new Date().toISOString();
    const mediaDir = t.config.mediaDir;
    const project = hub.media.content.createProject({ title: "Revocare", platforms: ["youtube"] }, "owner");
    // The source material and its right.
    const srcAsset = newId("mas"); const srcVersion = newId("mav");
    db.prepare("INSERT INTO media_assets (id, content_project_id, kind, category, title, origin, created_by, created_at, updated_at) VALUES (?, ?, 'video', 'raw', 'sursa', 'OWNED', 'test', ?, ?)").run(srcAsset, project.id, at, at);
    db.prepare("INSERT INTO media_asset_versions (id, asset_id, version, sha256, bytes, rel_path, is_original, status, created_by, created_at) VALUES (?, ?, 1, ?, 10, 'originals/x.mp4', 1, 'READY', 'test', ?)").run(srcVersion, srcAsset, "d".repeat(64), at);
    const right = hub.media.rights.record({ assetId: srcAsset, status: "CLEARED_FOR_SCOPE", holder: "Ifrim Digital", platforms: ["*"], uses: ["organic"], sourceKind: "manual", sourceRef: "test", actor: "owner" });
    // An edit that uses it, its YouTube variant, a final render on disk and QA bound to that file.
    const editProject = newId("mep"); const ev = newId("mev");
    db.prepare("INSERT INTO media_edit_projects (id, content_project_id, title, current_version, created_by, created_at, updated_at) VALUES (?, ?, 'Montaj', 1, 'test', ?, ?)").run(editProject, project.id, at, at);
    const ir = { fps: { num: 30, den: 1 }, tracks: [{ id: "v1", kind: "video", clips: [{ id: "c1", assetVersionId: srcVersion, sourceIn: 0, sourceOut: 30, start: 0 }] }] };
    db.prepare("INSERT INTO media_edit_versions (id, edit_project_id, version, ir_json, ir_sha256, change_kind, created_by, created_at) VALUES (?, ?, 1, ?, ?, 'initial', 'test', ?)").run(ev, editProject, JSON.stringify(ir), sha(JSON.stringify(ir)), at);
    const variantId = newId("mva");
    db.prepare("INSERT INTO media_variants (id, edit_project_id, master_version_id, platform_key, variant_version_id, status, created_by, created_at, updated_at) VALUES (?, ?, ?, 'youtube_16x9', ?, 'RENDERED', 'test', ?, ?)").run(variantId, editProject, ev, ev, at, at);
    const bytes = crypto.randomBytes(4096); const outAsset = newId("mas"); const outVersion = newId("mav");
    fs.mkdirSync(path.join(mediaDir, "renders"), { recursive: true });
    fs.writeFileSync(path.join(mediaDir, "renders", `${outVersion}.mp4`), bytes);
    db.prepare("INSERT INTO media_assets (id, content_project_id, kind, category, title, origin, created_by, created_at, updated_at) VALUES (?, ?, 'video', 'render', 'randare', 'OWNED', 'test', ?, ?)").run(outAsset, project.id, at, at);
    db.prepare("INSERT INTO media_asset_versions (id, asset_id, version, sha256, bytes, rel_path, is_original, status, derived_from_json, created_by, created_at) VALUES (?, ?, 1, ?, ?, ?, 0, 'READY', ?, 'test', ?)")
      .run(outVersion, outAsset, sha(bytes), bytes.length, `renders/${outVersion}.mp4`, JSON.stringify([{ versionId: srcVersion }]), at);
    const jobId = newId("mrj");
    db.prepare("INSERT INTO media_render_jobs (id, edit_version_id, profile, idempotency_key, status, output_asset_version_id, created_by, created_at, updated_at, finished_at) VALUES (?, ?, 'final', ?, 'DONE', ?, 'test', ?, ?, ?)").run(jobId, ev, `k-${jobId}`, outVersion, at, at, at);
    db.prepare("INSERT INTO media_qa_reports (id, edit_version_id, render_job_id, asset_version_id, kind, status, created_by, created_at) VALUES (?, ?, ?, ?, 'technical', 'PASS', 'test', ?)").run(newId("mqa"), ev, jobId, outVersion, at);
    for (const kind of ["editorial", "factual", "rights"]) db.prepare("INSERT INTO media_qa_reports (id, edit_version_id, kind, status, created_by, created_at) VALUES (?, ?, ?, 'PASS', 'test', ?)").run(newId("mqa"), ev, kind, at);
    const dist = hub.media.distribution;
    const m = dist.buildManifest({ contentProjectId: project.id, variants: [{ variantId, platform: "youtube", account: "@ifrimdigital", caption: "Demo — automatizare reală" }] });
    dist.approve({ manifestId: m.id, actor: "owner", approval: { manifestSha256: m.manifestSha256, channel: "owner", sessionId: "ses_test", via: "owner_session" } });
    const { attempt } = await dist.preparePack({ manifestId: m.id, platform: "youtube" });
    assert.equal(attempt.status, "PACK_READY");
    // The revocation (fail-safe, voice channel) re-checks the manifest in the same command.
    const r = (await dispatch(hub, "media.rights.revoke", { rightId: right.id, reason: "licență retrasă" }, "voice")).result;
    assert.equal(r.right.status, "REVOKED");
    assert.equal(r.rechecked.length, 1, JSON.stringify(r.impact?.manifests));
    assert.equal(dist.getManifest(m.id).status, "INVALIDATED");
    assert.equal(dist.getAttempt(attempt.id).status, "CANCELLED", "the open pack is withdrawn at once");
  } finally { await t.cleanup(); }
});
