// M09 distribution + analytics (contract §5.7): manifests bound by hashes, approval invalidation (T10), manual packs,
// OUTCOME_UNKNOWN reconcile without a second post / partial success / NEEDS_AUTH (T11), schedules with DST and no backlog at
// restart (T12), metrics missing ≠ zero / definitions per platform / pre-registered experiments (T13), apiRelease refused.
// Deterministic: a migrated temp DB (media-helpers), files written by the test, rights/QA injected. No tool, no model, no network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { makeMediaEnv, fakeLaunchers } from "./media-helpers.mjs";
import { createContent } from "../server/media/content.mjs";
import { createDistribution, createFixtureAdapter, zonedToUtc, utcToZoned, PLATFORM_REGISTRY } from "../server/media/distribution.mjs";
import { createAnalytics, METRIC_REGISTRY } from "../server/media/analytics.mjs";
import { newId } from "../server/core/ids.mjs";

const T0 = Date.parse("2026-10-20T10:00:00.000Z");
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function setup({ graceMinutes = 15, qa = null } = {}) {
  let nowMs = T0;
  const clock = () => new Date(nowMs);
  const env = makeMediaEnv({ launchers: fakeLaunchers(), clock });
  const { db, bus, settings, config } = env;
  const mediaDir = config.mediaDir;
  fs.mkdirSync(mediaDir, { recursive: true });
  const paths = {
    root: mediaDir,
    packDir: (id) => path.join(mediaDir, "packs", id),
    relOf: (abs) => path.relative(mediaDir, abs).split(path.sep).join("/"),
    resolveRel: (rel) => path.join(mediaDir, ...String(rel).split("/")),
  };
  const rightsState = { allowed: true, requiresDisclosure: false };
  const rights = { calls: [], evaluateAssets(q) { this.calls.push(q); return { allowed: rightsState.allowed, requiresDisclosure: rightsState.requiresDisclosure, reasons: rightsState.allowed ? [] : ["Drept revocat"] }; } };
  const content = createContent({ db, bus, clock, settings });
  const make = (opts = {}) => createDistribution({ db, bus, clock, paths, rights, settings, qa, graceMinutes, ...opts });
  const dist = make();
  const analytics = createAnalytics({ db, bus, clock });
  const project = content.createProject({ title: "Demo distribuție", platforms: ["youtube", "instagram", "tiktok"] }, "owner");
  const at = () => clock().toISOString();
  const editProjectId = newId("mep");
  db.prepare("INSERT INTO media_edit_projects (id, content_project_id, title, current_version, created_by, created_at, updated_at) VALUES (?, ?, ?, 0, 'test', ?, ?)").run(editProjectId, project.id, "Montaj", at(), at());
  let editN = 0;

  function seedAsset({ bytes = crypto.randomBytes(2048), ext = ".mp4", kind = "video", category = "render" } = {}) {
    const assetId = newId("mas"); const versionId = newId("mav");
    const rel = `renders/${versionId}${ext}`;
    fs.mkdirSync(path.join(mediaDir, "renders"), { recursive: true });
    fs.writeFileSync(path.join(mediaDir, rel), bytes);
    db.prepare("INSERT INTO media_assets (id, content_project_id, kind, category, title, origin, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'x', 'OWNED', 'test', ?, ?)").run(assetId, project.id, kind, category, at(), at());
    db.prepare("INSERT INTO media_asset_versions (id, asset_id, version, sha256, bytes, rel_path, is_original, status, created_by, created_at) VALUES (?, ?, 1, ?, ?, ?, 0, 'READY', 'test', ?)").run(versionId, assetId, sha(bytes), bytes.length, rel, at());
    return { versionId, file: path.join(mediaDir, rel), sha256: sha(bytes) };
  }
  function seedEditVersion(ir = { fps: { num: 30, den: 1 }, tracks: [] }) {
    editN += 1;
    const id = newId("mev");
    db.prepare("INSERT INTO media_edit_versions (id, edit_project_id, version, ir_json, ir_sha256, change_kind, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'initial', 'test', ?)").run(id, editProjectId, editN, JSON.stringify(ir), sha(JSON.stringify(ir)), at());
    return id;
  }
  function render(editVersionId, { profile = "final", qaStatus = "PASS" } = {}) {
    const asset = seedAsset();
    const jobId = newId("mrj");
    db.prepare("INSERT INTO media_render_jobs (id, edit_version_id, profile, idempotency_key, status, output_asset_version_id, created_by, created_at, updated_at, finished_at) VALUES (?, ?, ?, ?, 'DONE', ?, 'test', ?, ?, ?)")
      .run(jobId, editVersionId, profile, `k-${jobId}`, asset.versionId, at(), at(), at());
    // QA bound to what is packed (M09 review): the technical report of THIS render file + the IR-level kinds of this edit version.
    if (qaStatus) {
      db.prepare("INSERT INTO media_qa_reports (id, edit_version_id, render_job_id, asset_version_id, kind, status, created_by, created_at) VALUES (?, ?, ?, ?, 'technical', ?, 'test', ?)").run(newId("mqa"), editVersionId, jobId, asset.versionId, qaStatus, at());
      for (const kind of ["editorial", "factual", "rights"]) db.prepare("INSERT INTO media_qa_reports (id, edit_version_id, kind, status, created_by, created_at) VALUES (?, ?, ?, 'PASS', 'test', ?)").run(newId("mqa"), editVersionId, kind, at());
    }
    return { jobId, ...asset };
  }
  function seedVariant(platformKey, opts = {}) {
    const editVersionId = seedEditVersion(opts.ir);
    const variantId = newId("mva");
    db.prepare("INSERT INTO media_variants (id, edit_project_id, master_version_id, platform_key, variant_version_id, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'RENDERED', 'test', ?, ?)")
      .run(variantId, editProjectId, editVersionId, platformKey, editVersionId, at(), at());
    const r = opts.noRender ? null : render(editVersionId, opts);
    return { variantId, editVersionId, render: r };
  }
  function setPolicy(patch) { bus.transaction(() => settings.set("mediaPolicy", { ...settings.get("mediaPolicy"), ...patch }, "test")); }
  const approveIt = (m) => dist.approve({ manifestId: m.id, actor: "owner", approval: { manifestSha256: m.manifestSha256, channel: "owner", sessionId: "ses_test", via: "owner_session" } });
  return { env, db, bus, settings, clock, set: (ms) => { nowMs = ms; }, get now() { return nowMs; }, paths, rights, rightsState, content, dist, make, analytics, project,
    seedAsset, seedEditVersion, render, seedVariant, setPolicy, approveIt, mediaDir };
}

const variantInput = (v, platform, extra = {}) => ({ variantId: v.variantId, platform, account: "@ifrimdigital", caption: `Demo ${platform} — automatizare reală`, ...extra });
const events = (db, type) => db.prepare("SELECT * FROM events WHERE type = ? ORDER BY seq").all(type);
function insertAttempt(db, { manifestId, platform, status, postedAt = null, route = "api" }) {
  const id = newId("cra");
  const ext = postedAt ? JSON.stringify({ postedAt, url: `https://www.youtube.com/watch?v=${id}` }) : "{}";
  db.prepare("INSERT INTO content_release_attempts (id, manifest_id, platform, route, idempotency_key, status, external_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'test', ?, ?)")
    .run(id, manifestId, platform, route, `test:${id}`, status, ext, "2026-10-20T10:00:00.000Z", "2026-10-20T10:00:00.000Z");
  return id;
}

test("M09-DS-01 platform registry: documented statuses only, nothing VERIFIED_LIVE, X cost-blocked, TikTok Direct Post unsupported", () => {
  const ops = Object.values(PLATFORM_REGISTRY.platforms).flatMap((p) => Object.values(p.operations));
  assert.ok(ops.length >= 15);
  assert.ok(ops.every((o) => o.status !== "VERIFIED_LIVE"), "nothing may be VERIFIED_LIVE in M09");
  assert.equal(PLATFORM_REGISTRY.platforms.x.operations.api_upload.status, "COST_BLOCKED");
  assert.equal(PLATFORM_REGISTRY.platforms.tiktok.operations.api_upload.status, "POLICY_UNSUPPORTED");
  const refs = new Set(ops.map((o) => o.docRef).filter(Boolean));
  for (const r of refs) assert.match(r, /^S1[0-7]$/);
  assert.deepEqual(Object.keys(PLATFORM_REGISTRY.platforms).sort(), ["instagram", "linkedin", "tiktok", "x", "youtube"]);
});

test("M09-DS-02 manifest hashes are bound; approval needs the exact sha, final render, QA run without FAIL and rights per platform", (t) => {
  const s = setup(); t.after(() => s.env.cleanup());
  const yt = s.seedVariant("youtube_16x9");
  const cover = s.seedAsset({ ext: ".jpg", kind: "image", category: "thumbnail" });
  const m = s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(yt, "youtube", { coverVersionId: cover.versionId })] });
  assert.equal(m.status, "DRAFT");
  const v = m.body.variants[0];
  assert.equal(v.media.sha256, yt.render.sha256, "media sha = the final render file");
  assert.equal(v.captionSha256, sha(Buffer.from(v.caption, "utf8")));
  assert.equal(v.cover.sha256, cover.sha256);
  assert.match(m.manifestSha256, /^[a-f0-9]{64}$/);
  // wrong / missing sha
  assert.throws(() => s.dist.approve({ manifestId: m.id, approval: { manifestSha256: "0".repeat(64) } }), (e) => e.code === "APPROVAL_SHA_MISMATCH");
  assert.throws(() => s.dist.approve({ manifestId: m.id }), (e) => e.code === "APPROVAL_SHA_MISMATCH");
  // rights denied
  s.rightsState.allowed = false;
  assert.throws(() => s.approveIt(m), (e) => e.code === "MANIFEST_NOT_APPROVABLE" && /drepturile/.test(e.message));
  s.rightsState.allowed = true;
  // AI disclosure required by rights
  s.rightsState.requiresDisclosure = true;
  assert.throws(() => s.approveIt(m), /declarare AI/);
  s.rightsState.requiresDisclosure = false;
  const ok = s.approveIt(m);
  assert.equal(ok.manifest.status, "APPROVED");
  assert.equal(ok.manifest.approval.manifestSha256, m.manifestSha256);
  assert.equal(ok.manifest.approval.via, "owner_session");
  assert.equal(s.approveIt(m).alreadyApproved, true);
  assert.equal(events(s.db, "content.manifest.approved").length, 1);
});

test("M09-DS-03 approval refused without a final render, with QA FAIL, or with QA not run", (t) => {
  const s = setup(); t.after(() => s.env.cleanup());
  const none = s.seedVariant("youtube_16x9", { noRender: true });
  const m1 = s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(none, "youtube")] });
  assert.equal(m1.body.variants[0].media, null);
  assert.throws(() => s.approveIt(m1), /randare finală/);
  const draftOnly = s.seedVariant("youtube_16x9", { profile: "draft" });
  const m2 = s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(draftOnly, "youtube")] });
  assert.equal(m2.body.variants[0].media, null, "a draft render is never distributable");
  assert.equal(s.dist.getManifest(m1.id).status, "SUPERSEDED", "one live manifest per project");
  const failed = s.seedVariant("youtube_16x9", { qaStatus: "FAIL" });
  const m3 = s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(failed, "youtube")] });
  assert.throws(() => s.approveIt(m3), /QA are rezultat FAIL/);
  const noQa = s.seedVariant("youtube_16x9", { qaStatus: null });
  const m4 = s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(noQa, "youtube")] });
  assert.throws(() => s.approveIt(m4), /QA nu a rulat/);
  // M09 review: a PASS on ANOTHER file of the same edit version (a draft, an older render) never satisfies the final render.
  const elsewhere = s.seedVariant("youtube_16x9", { qaStatus: null });
  const otherAsset = s.render(elsewhere.editVersionId ?? elsewhere.versionId, { profile: "draft", qaStatus: null });
  s.env.db.prepare("INSERT INTO media_qa_reports (id, edit_version_id, asset_version_id, kind, status, created_by, created_at) VALUES (?, ?, ?, 'technical', 'PASS', 'test', ?)")
    .run(`mqa_x${Date.now().toString(36)}`, elsewhere.editVersionId ?? elsewhere.versionId, otherAsset.versionId, new Date().toISOString());
  const m6 = s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(elsewhere, "youtube")] });
  assert.throws(() => s.approveIt(m6), /QA nu a rulat/);
  // an injected QA dependency is honoured when the library holds no report at all
  const s2 = setup({ qa: { summary: () => ({ status: "FAIL" }) } }); t.after(() => s2.env.cleanup());
  const v = s2.seedVariant("youtube_16x9", { qaStatus: null });
  const m5 = s2.dist.buildManifest({ contentProjectId: s2.project.id, variants: [variantInput(v, "youtube")] });
  assert.throws(() => s2.approveIt(m5), /FAIL/);
  // input validation
  assert.throws(() => s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(failed, "myspace")] }), /Platformă necunoscută/);
  assert.throws(() => s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(failed, "youtube", { account: "EAA" + "x".repeat(50) })] }), (e) => e.code === "ACCOUNT_LOOKS_LIKE_SECRET");
  assert.throws(() => s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(failed, "youtube"), variantInput(noQa, "youtube")] }), /de două ori/);
});

test("M09-DS-04 T10 approval invalidated after caption / cover / account / variant / schedule change (new DRAFT each time)", (t) => {
  const s = setup(); t.after(() => s.env.cleanup());
  const yt = s.seedVariant("youtube_16x9");
  const yt2 = s.seedVariant("youtube_16x9");
  const cover1 = s.seedAsset({ ext: ".jpg", kind: "image", category: "thumbnail" });
  const cover2 = s.seedAsset({ ext: ".jpg", kind: "image", category: "thumbnail" });
  let m = s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(yt, "youtube", { coverVersionId: cover1.versionId, scheduleAt: "2026-10-26T18:00" })] });
  const cases = [
    ["caption", { caption: "Text nou" }, "text"],
    ["cover", { coverVersionId: cover2.versionId }, "copertă"],
    ["account", { account: "@alt_cont" }, "cont"],
    ["variant", { variantId: yt2.variantId }, "variantă"],
    ["schedule", { scheduleAt: "2026-10-27T19:30" }, "programare"],
  ];
  for (const [label, changes, word] of cases) {
    const approved = s.approveIt(m).manifest;
    assert.equal(approved.status, "APPROVED", label);
    const r = s.dist.amendManifest({ manifestId: approved.id, platform: "youtube", changes });
    assert.equal(r.previous.status, "INVALIDATED", `${label}: approval invalidated`);
    assert.match(r.previous.reason, new RegExp(word));
    assert.equal(s.dist.getManifest(approved.id).status, "INVALIDATED");
    assert.equal(r.manifest.status, "DRAFT", `${label}: a new draft needs a new approval`);
    assert.notEqual(r.manifest.manifestSha256, approved.manifestSha256);
    assert.throws(() => s.dist.approve({ manifestId: r.manifest.id, approval: { manifestSha256: approved.manifestSha256 } }), (e) => e.code === "APPROVAL_SHA_MISMATCH", "old approval cannot be reused");
    m = r.manifest;
  }
  const last = s.dist.getManifest(m.id).body.variants[0];
  assert.equal(last.schedule.utc, "2026-10-27T17:30:00.000Z", "19:30 Bucharest winter time = 17:30Z");
  assert.equal(last.variantId, yt2.variantId);
  assert.equal(events(s.db, "content.manifest.invalidated").length, 5);
});

test("M09-DS-05 checkInvalidation: re-render, variant re-derivation, rights revocation and tampering invalidate; open packs are cancelled", async (t) => {
  const s = setup(); t.after(() => s.env.cleanup());
  const yt = s.seedVariant("youtube_16x9");
  let m = s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(yt, "youtube")] });
  s.approveIt(m);
  assert.equal(s.dist.checkInvalidation(m.id).valid, true);
  const pack = await s.dist.preparePack({ manifestId: m.id, platform: "youtube" });
  assert.equal(pack.attempt.status, "PACK_READY");
  s.render(yt.editVersionId); // a newer final render → different media sha
  const c = s.dist.checkInvalidation(m.id);
  assert.equal(c.valid, false);
  assert.equal(c.status, "INVALIDATED");
  assert.ok(c.reasons.some((r) => r.code === "MEDIA_CHANGED"));
  assert.equal(s.dist.getAttempt(pack.attempt.id).status, "CANCELLED", "the old pack is no longer valid");
  await assert.rejects(s.dist.preparePack({ manifestId: m.id, platform: "youtube" }), (e) => e.category === "conflict");

  m = s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(yt, "youtube")] });
  s.approveIt(m);
  s.rightsState.allowed = false;
  const r2 = s.dist.checkInvalidation(m.id);
  assert.ok(r2.reasons.some((r) => r.code === "RIGHTS_CHANGED"));
  assert.equal(r2.status, "INVALIDATED");
  s.rightsState.allowed = true;

  m = s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(yt, "youtube")] });
  s.approveIt(m);
  const other = s.seedEditVersion();
  s.db.prepare("UPDATE media_variants SET variant_version_id = ? WHERE id = ?").run(other, yt.variantId);
  assert.ok(s.dist.checkInvalidation(m.id).reasons.some((r) => r.code === "VARIANT_CHANGED"));
  s.db.prepare("UPDATE media_variants SET variant_version_id = ? WHERE id = ?").run(yt.editVersionId, yt.variantId);

  m = s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(yt, "youtube")] });
  s.approveIt(m);
  const body = s.dist.getManifest(m.id).body;
  body.variants[0].caption = "modificat direct în baza de date";
  s.db.prepare("UPDATE content_manifests SET body_json = ? WHERE id = ?").run(JSON.stringify(body), m.id);
  assert.ok(s.dist.checkInvalidation(m.id).reasons.some((r) => r.code === "MANIFEST_TAMPERED"));
});

test("M09-DS-06 manual pack is complete and hash-bound; idempotent; tampering refused", async (t) => {
  const s = setup(); t.after(() => s.env.cleanup());
  const yt = s.seedVariant("youtube_16x9");
  const cover = s.seedAsset({ ext: ".png", kind: "image", category: "thumbnail" });
  const m = s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(yt, "youtube", { coverVersionId: cover.versionId, scheduleAt: "2026-10-25T03:30", scheduleFold: "later", disclosure: { aiGenerated: true, text: "Voce generată cu AI" } })] });
  await assert.rejects(s.dist.preparePack({ manifestId: m.id, platform: "youtube" }), (e) => e.code === "MANIFEST_NOT_VALID", "a DRAFT gets no pack");
  s.approveIt(m);
  const r = await s.dist.preparePack({ manifestId: m.id, platform: "youtube" });
  assert.equal(r.existing, false);
  const a = r.attempt;
  assert.equal(a.status, "PACK_READY");
  assert.equal(a.idempotencyKey, `${m.id}:youtube:pack`);
  assert.equal(a.scheduledFor, "2026-10-25T01:30:00.000Z");
  const dir = s.paths.resolveRel(a.external.packRelPath);
  const names = fs.readdirSync(dir).sort();
  assert.deepEqual(names, ["caption.txt", "checklist.md", "cover.png", "manifest.json", "video.mp4"]);
  const manifestJson = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  assert.equal(manifestJson.manifestSha256, m.manifestSha256);
  for (const f of manifestJson.files) assert.equal(sha(fs.readFileSync(path.join(dir, f.name))), f.sha256, f.name);
  assert.equal(sha(fs.readFileSync(path.join(dir, "video.mp4"))), yt.render.sha256);
  const checklist = fs.readFileSync(path.join(dir, "checklist.md"), "utf8");
  assert.match(checklist, /AI: DA/);
  assert.match(checklist, /Voce generată cu AI/);
  assert.match(checklist, /## Drepturi/);
  assert.match(checklist, /## Pași/);
  assert.match(checklist, /03:30 \(Europe\/Bucharest, \+02:00; UTC 2026-10-25T01:30:00.000Z\)/);
  assert.match(checklist, /nu publică nimic automat/);
  assert.ok(!fs.existsSync(`${dir}.partial`));
  const again = await s.dist.preparePack({ manifestId: m.id, platform: "youtube" });
  assert.equal(again.existing, true);
  assert.equal(again.attempt.id, a.id);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM content_release_attempts").get().n, 1, "dedupe: one attempt per manifest/platform");
  fs.appendFileSync(path.join(dir, "caption.txt"), " editat");
  await assert.rejects(s.dist.preparePack({ manifestId: m.id, platform: "youtube" }), (e) => e.code === "PACK_DAMAGED");
  await assert.rejects(s.dist.preparePack({ manifestId: m.id, platform: "tiktok" }), (e) => e.category === "not_found");
});

test("M09-DS-07 a source file changed on disk after approval: pack refused and manifest invalidated", async (t) => {
  const s = setup(); t.after(() => s.env.cleanup());
  const yt = s.seedVariant("youtube_16x9");
  const m = s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(yt, "youtube")] });
  s.approveIt(m);
  fs.writeFileSync(yt.render.file, crypto.randomBytes(100));
  await assert.rejects(s.dist.preparePack({ manifestId: m.id, platform: "youtube" }), (e) => e.code === "PACK_HASH_MISMATCH");
  assert.equal(s.dist.getManifest(m.id).status, "INVALIDATED");
  const att = s.dist.listAttempts({ manifestId: m.id })[0];
  assert.equal(att.status, "FAILED");
  assert.ok(!fs.existsSync(s.paths.packDir(att.id)), "no partial pack is left as a pack");
});

test("M09-DS-08 recordManual: URL validated per platform, PUBLISHED with manual evidence, idempotent", async (t) => {
  const s = setup(); t.after(() => s.env.cleanup());
  const yt = s.seedVariant("youtube_16x9");
  const m = s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(yt, "youtube")] });
  s.approveIt(m);
  const { attempt } = await s.dist.preparePack({ manifestId: m.id, platform: "youtube" });
  assert.throws(() => s.dist.recordManual({ attemptId: attempt.id, url: "https://www.tiktok.com/@x/video/1" }), (e) => e.code === "URL_PLATFORM_MISMATCH");
  assert.throws(() => s.dist.recordManual({ attemptId: attempt.id, url: "http://youtube.com/watch?v=1" }), (e) => e.code === "URL_INVALID");
  assert.throws(() => s.dist.recordManual({ attemptId: attempt.id, url: "https://youtube.com.evil.example/watch" }), (e) => e.code === "URL_PLATFORM_MISMATCH");
  assert.throws(() => s.dist.recordManual({ attemptId: attempt.id, url: "https://www.youtube.com/watch?v=abc", postedAt: "2027-01-01T00:00:00Z" }), /viitor/);
  s.set(T0 + 3600000);
  const r = s.dist.recordManual({ attemptId: attempt.id, url: "https://www.youtube.com/watch?v=abc" });
  assert.equal(r.attempt.status, "PUBLISHED");
  assert.equal(r.attempt.evidence[0].kind, "manual");
  assert.equal(r.attempt.external.url, "https://www.youtube.com/watch?v=abc");
  assert.equal(s.dist.recordManual({ attemptId: attempt.id, url: "https://www.youtube.com/watch?v=abc" }).duplicate, true);
  assert.throws(() => s.dist.recordManual({ attemptId: attempt.id, url: "https://www.youtube.com/watch?v=zzz" }), (e) => e.code === "ALREADY_RECORDED");
  assert.throws(() => s.dist.cancel({ attemptId: attempt.id }), /nu se mai anulează/);
});

test("M09-DS-09 T11 reconcile OUTCOME_UNKNOWN by lookup only: published / not_found / unknown / token expired → NEEDS_AUTH", async (t) => {
  const s = setup(); t.after(() => s.env.cleanup());
  const yt = s.seedVariant("youtube_16x9");
  const m = s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(yt, "youtube")] });
  const a1 = insertAttempt(s.db, { manifestId: m.id, platform: "youtube", status: "OUTCOME_UNKNOWN" });
  const pub = createFixtureAdapter({ status: [{ state: "published", url: "https://www.youtube.com/watch?v=x1", externalId: "x1" }] });
  const r1 = await s.dist.reconcile({ attemptId: a1, adapter: pub });
  assert.equal(r1.attempt.status, "PUBLISHED");
  assert.equal(r1.outcome, "PUBLISHED");
  assert.deepEqual(pub.calls, { status: 1, upload: 0, post: 0 }, "a status lookup only — never a second post");
  const again = await s.dist.reconcile({ attemptId: a1, adapter: pub });
  assert.equal(again.lookedUp, false);
  assert.equal(pub.calls.status, 1);

  const a2 = insertAttempt(s.db, { manifestId: m.id, platform: "youtube", status: "OUTCOME_UNKNOWN" });
  const nf = createFixtureAdapter({ status: [{ state: "not_found" }] });
  const r2 = await s.dist.reconcile({ attemptId: a2, adapter: nf });
  assert.equal(r2.attempt.status, "FAILED");
  assert.match(r2.attempt.error, /Nu se repostează automat/);
  assert.equal(nf.calls.upload + nf.calls.post, 0);

  const a3 = insertAttempt(s.db, { manifestId: m.id, platform: "youtube", status: "OUTCOME_UNKNOWN" });
  const unk = createFixtureAdapter({ status: [{ state: "unknown" }] });
  assert.equal((await s.dist.reconcile({ attemptId: a3, adapter: unk })).attempt.status, "OUTCOME_UNKNOWN");
  const half = createFixtureAdapter({ status: [{ state: "published" }] }); // no url / id: not trusted
  assert.equal((await s.dist.reconcile({ attemptId: a3, adapter: half })).attempt.status, "OUTCOME_UNKNOWN");

  const exp = createFixtureAdapter({ authExpired: true });
  const r4 = await s.dist.reconcile({ attemptId: a3, adapter: exp });
  assert.equal(r4.outcome, "NEEDS_AUTH");
  assert.equal(r4.attempt.status, "OUTCOME_UNKNOWN", "token expiry never turns into success or failure");
  assert.match(r4.attempt.error, /NEEDS_AUTH/);
  assert.equal(events(s.db, "content.release.needs_auth").length, 1);
  assert.throws(() => s.dist.cancel({ attemptId: a3 }), /reconciliază/);
  await assert.rejects(s.dist.reconcile({ attemptId: a3 }), /adaptor/);
  const ready = insertAttempt(s.db, { manifestId: m.id, platform: "youtube", status: "PACK_READY", route: "manual_pack" });
  await assert.rejects(s.dist.reconcile({ attemptId: ready, adapter: unk }), (e) => e.code === "ATTEMPT_STATE");
});

test("M09-DS-10 T11 partial success is kept: each platform keeps its outcome; invalidation never reverts a publication", async (t) => {
  const s = setup(); t.after(() => s.env.cleanup());
  const yt = s.seedVariant("youtube_16x9"); const ig = s.seedVariant("reels_9x16"); const tt = s.seedVariant("tiktok_9x16");
  const m = s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(yt, "youtube"), variantInput(ig, "instagram"), variantInput(tt, "tiktok")] });
  s.approveIt(m);
  const pY = await s.dist.preparePack({ manifestId: m.id, platform: "youtube" });
  const pI = await s.dist.preparePack({ manifestId: m.id, platform: "instagram" });
  const pT = await s.dist.preparePack({ manifestId: m.id, platform: "tiktok" });
  s.dist.recordManual({ attemptId: pY.attempt.id, url: "https://youtu.be/abc" });
  s.dist.recordManual({ attemptId: pT.attempt.id, url: "https://www.tiktok.com/@ifrim/video/123" });
  const st = s.dist.releaseStatus(m.id);
  assert.equal(st.overall, "PARTIAL");
  assert.equal(st.published, 2);
  assert.equal(st.byPlatform.instagram.status, "PACK_READY");
  const amended = s.dist.amendManifest({ manifestId: m.id, platform: "instagram", changes: { caption: "Text corectat" } });
  assert.equal(amended.previous.status, "INVALIDATED");
  assert.equal(s.dist.getAttempt(pY.attempt.id).status, "PUBLISHED");
  assert.equal(s.dist.getAttempt(pT.attempt.id).status, "PUBLISHED");
  assert.equal(s.dist.getAttempt(pI.attempt.id).status, "CANCELLED");
  assert.equal(s.dist.releaseStatus(m.id).overall, "PARTIAL");
});

test("M09-DS-11 T12 time zones and DST through Intl: 2026-10-25 ambiguous, 2027-03-28 nonexistent", (t) => {
  assert.throws(() => zonedToUtc("2026-10-25T03:30", "Europe/Bucharest"), (e) => e.code === "SCHEDULE_AMBIGUOUS" && /apare de două ori/.test(e.message));
  assert.equal(zonedToUtc("2026-10-25T03:30", "Europe/Bucharest", { fold: "earlier" }).utc, "2026-10-25T00:30:00.000Z");
  const later = zonedToUtc("2026-10-25T03:30", "Europe/Bucharest", { fold: "later" });
  assert.equal(later.utc, "2026-10-25T01:30:00.000Z");
  assert.equal(later.offset, "+02:00");
  assert.equal(zonedToUtc("2026-10-25T04:30", "Europe/Bucharest").utc, "2026-10-25T02:30:00.000Z");
  assert.throws(() => zonedToUtc("2027-03-28T03:30", "Europe/Bucharest"), (e) => e.code === "SCHEDULE_NONEXISTENT" && /nu există/.test(e.message));
  assert.equal(zonedToUtc("2027-03-28T04:00", "Europe/Bucharest").utc, "2027-03-28T01:00:00.000Z");
  assert.equal(zonedToUtc("2027-03-28T02:59", "Europe/Bucharest").utc, "2027-03-28T00:59:00.000Z");
  assert.equal(utcToZoned("2026-10-25T00:30:00Z").local, "2026-10-25T03:30");
  assert.equal(utcToZoned("2026-10-25T01:30:00Z").local, "2026-10-25T03:30");
  assert.throws(() => zonedToUtc("2026-02-30T10:00"), (e) => e.code === "SCHEDULE_FORMAT");
  assert.throws(() => zonedToUtc("2026-10-25T10:00", "Mars/Olympus"), (e) => e.code === "TIMEZONE_INVALID");
  const s = setup(); t.after(() => s.env.cleanup());
  const yt = s.seedVariant("youtube_16x9");
  assert.throws(() => s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(yt, "youtube", { scheduleAt: "2027-03-28T03:30" })] }), (e) => e.code === "SCHEDULE_NONEXISTENT");
  assert.throws(() => s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(yt, "youtube", { scheduleAt: "2026-10-25T03:30" })] }), (e) => e.code === "SCHEDULE_AMBIGUOUS");
  assert.throws(() => s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(yt, "youtube", { scheduleAt: "2026-10-19T10:00" })] }), (e) => e.code === "SCHEDULE_PAST");
  const m = s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(yt, "youtube", { scheduleAt: "2027-03-28T04:15" })] });
  assert.deepEqual({ utc: m.body.variants[0].schedule.utc, offset: m.body.variants[0].schedule.offset, tz: m.body.variants[0].schedule.timezone },
    { utc: "2027-03-28T01:15:00.000Z", offset: "+03:00", tz: "Europe/Bucharest" });
});

test("M09-DS-12 T12 missed schedule: tick and restart never dispatch a backlog → MISSED_NEEDS_DECISION; late manual record allowed", async (t) => {
  const s = setup({ graceMinutes: 10 }); t.after(() => s.env.cleanup());
  const yt = s.seedVariant("youtube_16x9"); const ig = s.seedVariant("reels_9x16");
  const m = s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(yt, "youtube", { scheduleAt: "2026-10-25T03:30", scheduleFold: "later" }), variantInput(ig, "instagram", { scheduleAt: "2026-10-26T12:00" })] });
  s.approveIt(m);
  const pY = await s.dist.preparePack({ manifestId: m.id, platform: "youtube" });
  const pI = await s.dist.preparePack({ manifestId: m.id, platform: "instagram" });
  const upl = insertAttempt(s.db, { manifestId: m.id, platform: "youtube", status: "UPLOADING" });
  assert.deepEqual(s.dist.tick("2026-10-25T01:35:00Z").missed, [], "inside the grace window");
  assert.equal(s.dist.tick("2026-10-25T00:45:00Z").missed.length, 0, "the earlier 03:30 (summer) is not the scheduled one");
  // the Hub was off for days; autoPublish even switched ON — still nothing is sent
  s.setPolicy({ autoPublish: true });
  s.set(Date.parse("2026-10-28T09:00:00Z"));
  const restarted = s.make();
  const r = restarted.recover();
  assert.equal(r.dispatched, 0);
  assert.deepEqual(r.missed.sort(), [pY.attempt.id, pI.attempt.id].sort());
  assert.deepEqual(r.interrupted, [upl]);
  assert.equal(restarted.getAttempt(upl).status, "OUTCOME_UNKNOWN", "an interrupted upload is reconciled, not re-uploaded");
  const missed = restarted.getAttempt(pY.attempt.id);
  assert.equal(missed.status, "MISSED_NEEDS_DECISION");
  assert.match(missed.error, /03:30 Europe\/Bucharest/);
  assert.match(missed.error, /nu publică automat/);
  assert.equal(restarted.tick().missed.length, 0, "idempotent");
  const late = restarted.recordManual({ attemptId: pY.attempt.id, url: "https://www.youtube.com/watch?v=late", postedAt: "2026-10-27T10:00:00Z" });
  assert.equal(late.attempt.status, "PUBLISHED");
  assert.equal(late.attempt.evidence[0].late, true);
  assert.equal(restarted.cancel({ attemptId: pI.attempt.id, reason: "nu mai e relevant" }).attempt.status, "CANCELLED");
  assert.equal(events(s.db, "content.release.missed").length, 2);
});

test("M09-DS-13 apiRelease always refuses in M09 with the precise missing conditions (even with every switch ON)", (t) => {
  const s = setup(); t.after(() => s.env.cleanup());
  const yt = s.seedVariant("youtube_16x9");
  const m = s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(yt, "youtube")] });
  let err;
  try { s.dist.apiRelease({ manifestId: m.id, platform: "youtube" }); } catch (e) { err = e; }
  assert.equal(err.category, "policy");
  assert.equal(err.code, "API_RELEASE_REFUSED");
  const codes = err.details.missing.map((x) => x.code);
  for (const c of ["API_RELEASE_NOT_IMPLEMENTED", "LIVE_UPLOAD_OFF", "AUTO_PUBLISH_OFF", "PLATFORM_NOT_VERIFIED", "ACCOUNT_NOT_CONNECTED", "UPLOAD_CONFIRMATION_MISSING", "MANIFEST_NOT_APPROVED"]) assert.ok(codes.includes(c), c);
  s.setPolicy({ liveUpload: true, autoPublish: true });
  s.approveIt(m);
  try { s.dist.apiRelease({ manifestId: m.id, platform: "youtube" }); assert.fail("must refuse"); } catch (e) {
    assert.equal(e.code, "API_RELEASE_REFUSED");
    const c2 = e.details.missing.map((x) => x.code);
    assert.ok(c2.includes("API_RELEASE_NOT_IMPLEMENTED"));
    assert.ok(!c2.includes("LIVE_UPLOAD_OFF") && !c2.includes("MANIFEST_NOT_APPROVED"));
    assert.match(e.message, /DOCUMENTED \(S14\)/);
  }
  assert.throws(() => s.dist.apiRelease({ platform: "x" }), /COST_BLOCKED/);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM content_release_attempts").get().n, 0, "no attempt is created");
  assert.equal(events(s.db, "content.release.api_refused").length, 3);
});

test("M09-DS-14 T13 manual metrics: robust CSV (quotes, ; and ,), missing ≠ zero, definitions per platform, dedupe, fixtures labelled", async (t) => {
  const s = setup(); t.after(() => s.env.cleanup());
  const yt = s.seedVariant("youtube_16x9"); const ig = s.seedVariant("reels_9x16");
  const m = s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(yt, "youtube"), variantInput(ig, "instagram")] });
  s.approveIt(m);
  const pY = (await s.dist.preparePack({ manifestId: m.id, platform: "youtube" })).attempt;
  const pI = (await s.dist.preparePack({ manifestId: m.id, platform: "instagram" })).attempt;
  s.set(T0 + 3600000);
  s.dist.recordManual({ attemptId: pY.id, url: "https://www.youtube.com/watch?v=1" });
  s.dist.recordManual({ attemptId: pI.id, url: "https://www.instagram.com/reel/abc/" });
  const csv = "﻿Data;Vizualizări;\"Durată medie; secunde\";Aprecieri;Comentarii\r\n21.10.2026;\"1.234\";\"12,5\";0;\r\n2026-10-22;N/A;13;abc;7\r\n";
  const imp = s.analytics.importManual({ platform: "youtube", attemptId: pY.id, csvText: csv,
    mapping: { Data: "@date", "Vizualizări": "views", "Durată medie; secunde": "averageViewDuration", Aprecieri: "likes", Comentarii: "comments" } });
  assert.equal(imp.delimiter, ";");
  assert.equal(imp.decimal, ",");
  assert.equal(imp.rows, 2);
  assert.equal(imp.values + imp.unavailable, 8);
  const rows = s.analytics.snapshots({ attemptId: pY.id });
  const pick = (key, day) => rows.find((r) => r.metricKey === key && r.dataThrough === day);
  assert.equal(pick("views", "2026-10-21").value, 1234);
  assert.equal(pick("averageViewDuration", "2026-10-21").value, 12.5);
  assert.equal(pick("likes", "2026-10-21").value, 0, "an explicit 0 stays 0");
  assert.equal(pick("comments", "2026-10-21").value, null, "an empty cell is missing, not zero");
  assert.match(pick("comments", "2026-10-21").unavailableReason, /goală/);
  assert.equal(pick("views", "2026-10-22").value, null);
  assert.match(pick("likes", "2026-10-22").unavailableReason, /nenumerică/);
  assert.ok(rows.every((r) => r.source === "manual_import"));
  const dup = s.analytics.importManual({ platform: "youtube", attemptId: pY.id, csvText: csv,
    mapping: { Data: "@date", "Vizualizări": "views", "Durată medie; secunde": "averageViewDuration", Aprecieri: "likes", Comentarii: "comments" } });
  assert.equal(dup.duplicate, true);
  assert.equal(s.analytics.snapshots({ attemptId: pY.id }).length, rows.length);
  // comma file with a quoted thousands value
  const igImp = s.analytics.importManual({ platform: "instagram", attemptId: pI.id, csvText: "Views,Reach,Saves\n\"1,500\",900,\n", mapping: { Views: "views", Reach: "reach", Saves: "saves" } });
  assert.equal(igImp.decimal, ".");
  assert.equal(s.analytics.snapshots({ attemptId: pI.id, metricKey: "views" })[0].value, 1500);
  // definitions never mixed
  assert.throws(() => s.analytics.importManual({ platform: "instagram", attemptId: pI.id, csvText: "a\n1\n", mapping: { a: "averageViewDuration" } }), (e) => e.code === "METRIC_UNKNOWN");
  assert.throws(() => s.analytics.importManual({ platform: "youtube", attemptId: pI.id, csvText: "a\n1\n", mapping: { a: "views" } }), (e) => e.code === "PLATFORM_MISMATCH");
  assert.throws(() => s.analytics.importManual({ platform: "youtube", attemptId: pY.id, csvText: "a\n1\n", mapping: { b: "views" } }), (e) => e.code === "MAPPING_COLUMN_MISSING");
  s.analytics.recordFixture({ platform: "youtube", attemptId: pY.id, metrics: { views: 99999 } });
  const sum = s.analytics.summary(s.project.id);
  const ytItem = sum.items.find((i) => i.platform === "youtube");
  const igItem = sum.items.find((i) => i.platform === "instagram");
  assert.ok(ytItem && igItem, "one entry per platform; no cross-platform total");
  assert.ok(!("total" in sum) && !("totals" in sum));
  assert.equal(ytItem.metrics.views.value, null, "latest real views missing stays null — the fixture does not fill it");
  assert.equal(ytItem.fixtureMetrics.views.value, 99999);
  assert.equal(ytItem.fixtureMetrics.views.label, "DATE DE TEST (fixture)");
  assert.equal(ytItem.metrics.averageViewDuration.definition.sourceRef, "S15");
  assert.equal(igItem.metrics.views.definition.availability, "unknown");
  assert.equal(igItem.metrics.saves.value, null);
  assert.equal(METRIC_REGISTRY.platforms.youtube.views.availability, "documented");
  const plan = s.analytics.snapshotPlan(pY.id);
  assert.deepEqual(plan.targets.map((x) => x.target), ["1h", "6h", "24h", "72h", "7d", "30d"]);
  assert.match(plan.note, /nu garanții/);
});

test("M09-DS-15 T13 experiments: pre-registered sha, immutable, INCONCLUSIVE under minimum sample or with missing data; insight rules", (t) => {
  const s = setup(); t.after(() => s.env.cleanup());
  const yt = s.seedVariant("youtube_16x9", { ir: { fps: { num: 30, den: 1 }, tracks: [{ id: "v1", kind: "video", clips: [{ id: "c1", sourceIn: 0, sourceOut: 90, start: 0, speed: 1, shotId: "s1" }, { id: "c2", sourceIn: 0, sourceOut: 150, start: 90, speed: 1, shotId: "s2" }] }] } });
  const m = s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(yt, "youtube")] });
  const posted = "2026-10-20T10:00:00.000Z";
  const A = [1, 2, 3].map(() => insertAttempt(s.db, { manifestId: m.id, platform: "youtube", status: "PUBLISHED", postedAt: posted }));
  const B = [1, 2, 3].map(() => insertAttempt(s.db, { manifestId: m.id, platform: "youtube", status: "PUBLISHED", postedAt: posted }));
  const arms = [{ id: "A", label: "Hook clasic", attemptIds: A }, { id: "B", label: "Hook cu rezultat", attemptIds: B }];
  assert.throws(() => s.analytics.registerExperiment({ title: "Hook", variable: "hook", arms, primaryMetric: { platform: "youtube", key: "views" } }), (e) => e.code === "MIN_SAMPLE_REQUIRED");
  assert.throws(() => s.analytics.registerExperiment({ title: "Hook", variable: "hook", arms, primaryMetric: { platform: "instagram", key: "averageViewDuration" }, analysisRule: { minSamplePerArm: 3 } }), (e) => e.code === "METRIC_UNKNOWN");
  const exp = s.analytics.registerExperiment({ title: "Hook", variable: "hook", arms, primaryMetric: { platform: "youtube", key: "views" }, window: { target: "72h" }, analysisRule: { minSamplePerArm: 3 }, design: "randomized_native" });
  assert.equal(exp.status, "REGISTERED");
  assert.match(exp.registeredSha256, /^[a-f0-9]{64}$/);
  assert.equal(s.analytics.verifyExperiment(exp.id), true);
  const at72 = "2026-10-23T11:00:00.000Z";
  const put = (aid, v) => s.analytics.recordFixture({ platform: "youtube", attemptId: aid, metrics: { views: v }, observedAt: at72 });
  // only fixtures exist → real analysis treats them as missing
  [100, 110, 105].forEach((v, i) => put(A[i], v));
  [200, 210, 190].forEach((v, i) => put(B[i], v));
  const inc = s.analytics.analyzeExperiment(exp.id);
  assert.equal(inc.status, "INCONCLUSIVE");
  assert.ok(inc.result.reasons.some((r) => /n=0/.test(r)));
  assert.ok(inc.result.reasons.some((r) => /nu se tratează ca zero/.test(r)));
  const fx = s.analytics.analyzeExperiment(exp.id, { includeFixtures: true });
  assert.equal(fx.status, "CLOSED");
  assert.equal(fx.result.fixture, true);
  assert.equal(fx.result.label, "DATE DE TEST (fixture)");
  const ins = s.analytics.proposeInsight({ hypothesis: "Un hook cu rezultatul la început crește vizualizările", dataRefs: [{ kind: "experiment", ref: exp.id }], experimentId: exp.id });
  assert.throws(() => s.analytics.setInsightStatus(ins.id, "EXPERIMENT_SUPPORTED"), (e) => e.code === "FIXTURE_DATA");
  // an observational experiment with real data
  const C = [1, 2].map(() => insertAttempt(s.db, { manifestId: m.id, platform: "youtube", status: "PUBLISHED", postedAt: posted }));
  const D = [1, 2].map(() => insertAttempt(s.db, { manifestId: m.id, platform: "youtube", status: "PUBLISHED", postedAt: posted }));
  const obs = s.analytics.registerExperiment({ title: "Durată", variable: "durată", arms: [{ id: "C", attemptIds: C }, { id: "D", attemptIds: D }], primaryMetric: { platform: "youtube", key: "views" }, analysisRule: { minSamplePerArm: 2 } });
  s.analytics.importManual({ platform: "youtube", attemptId: C[0], csvText: "v\n100\n", mapping: { v: "views" }, observedAt: at72 });
  const short = s.analytics.analyzeExperiment(obs.id);
  assert.equal(short.status, "INCONCLUSIVE", "missing data → inconclusive");
  for (const [aid, v] of [[C[1], 120], [D[0], 300], [D[1], 320]]) s.analytics.importManual({ platform: "youtube", attemptId: aid, csvText: `v\n${v}\n`, mapping: { v: "views" }, observedAt: at72 });
  const closed = s.analytics.analyzeExperiment(obs.id);
  assert.equal(closed.status, "CLOSED");
  assert.match(closed.result.interpretation, /asociere, nu o cauză/);
  assert.equal(s.analytics.analyzeExperiment(obs.id).result.analyzedAt, closed.result.analyzedAt, "a CLOSED result is not recomputed");
  const ins2 = s.analytics.proposeInsight({ hypothesis: "Videourile scurte au mai multe vizualizări", dataRefs: [{ kind: "experiment", ref: obs.id }], sample: { base: 4 }, experimentId: obs.id });
  assert.throws(() => s.analytics.setInsightStatus(ins2.id, "EXPERIMENT_SUPPORTED"), (e) => e.code === "OBSERVATIONAL_ONLY");
  assert.equal(s.analytics.setInsightStatus(ins2.id, "OBSERVED_ASSOCIATION").status, "OBSERVED_ASSOCIATION");
  assert.throws(() => s.analytics.setInsightStatus(ins.id, "OBSERVED_ASSOCIATION"), (e) => e.code === "NUMBER_NEEDS_BASE");
  assert.throws(() => s.analytics.proposeInsight({ hypothesis: "Hook-ul nou aduce 40% mai multe vizualizări" }), (e) => e.code === "NUMBER_NEEDS_BASE");
  assert.ok(s.analytics.proposeInsight({ hypothesis: "Hook-ul nou aduce 40% mai multe vizualizări", sample: { base: 6 }, units: "procent", result: { metric: "youtube:views", value: 40 } }).id);
  s.analytics.setInsightStatus(ins2.id, "RETIRED");
  assert.throws(() => s.analytics.setInsightStatus(ins2.id, "HYPOTHESIS"), /RETIRED/);
  // tampering with a registered protocol is detected
  s.db.prepare("UPDATE content_experiments SET analysis_rule_json = ? WHERE id = ?").run(JSON.stringify({ minSamplePerArm: 1, alpha: 0.5, test: "welch_t" }), exp.id);
  assert.equal(s.analytics.verifyExperiment(exp.id), false);
  const exp2 = s.analytics.registerExperiment({ title: "Hook 2", variable: "hook", arms: [{ id: "A", attemptIds: [] }, { id: "B", attemptIds: [] }], primaryMetric: { platform: "youtube", key: "views" }, analysisRule: { minSamplePerArm: 2 } });
  s.db.prepare("UPDATE content_experiments SET arms_json = ? WHERE id = ?").run(JSON.stringify([{ id: "A", label: "A", description: "", attemptIds: A }, { id: "B", label: "B", description: "", attemptIds: B }]), exp2.id);
  assert.throws(() => s.analytics.analyzeExperiment(exp2.id), (e) => e.code === "EXPERIMENT_TAMPERED");
  // scene diagnostics: hypotheses only
  s.analytics.importManual({ platform: "youtube", attemptId: A[0], csvText: "avg\n\"4,2\"\n", mapping: { avg: "averageViewDuration" }, decimal: "," });
  const insightsBefore = s.db.prepare("SELECT COUNT(*) AS n FROM content_insights").get().n;
  const diag = s.analytics.sceneDiagnostics({ attemptId: A[0], editVersionId: yt.editVersionId });
  assert.equal(diag.kind, "hypotheses");
  assert.ok(diag.items.length >= 1);
  assert.ok(diag.items.every((i) => i.status === "HYPOTHESIS"));
  assert.equal(diag.items[0].clipId, "c2");
  assert.match(diag.disclaimer, /Ipoteze, nu concluzii/);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM content_insights").get().n, insightsBefore, "diagnostics never write insights");
  const none = s.analytics.sceneDiagnostics({ attemptId: B[2], editVersionId: yt.editVersionId });
  assert.equal(none.items.length, 0);
  assert.match(none.reason, /Nu există/);
});

test("M09-DS-16 (review R5/R6) a pack withdrawn by invalidation: a post made BEFORE the withdrawal is recorded truthfully; a later one is refused; record re-checks the manifest", async (t) => {
  const s = setup(); t.after(() => s.env.cleanup());
  const yt = s.seedVariant("youtube_16x9");
  const m = s.dist.buildManifest({ contentProjectId: s.project.id, variants: [variantInput(yt, "youtube")] });
  s.approveIt(m);
  const { attempt } = await s.dist.preparePack({ manifestId: m.id, platform: "youtube" });
  // The owner posts at +10 min; at +20 min the right is revoked: recordManual re-checks the APPROVED manifest first, so the pack
  // is withdrawn at that moment (no separate checkInvalidation call needed).
  s.set(T0 + 20 * 60000);
  s.rightsState.allowed = false;
  assert.throws(() => s.dist.recordManual({ attemptId: attempt.id, url: "https://www.youtube.com/watch?v=late" }), /retras/, "a post made now (after the withdrawal) is refused");
  assert.equal(s.dist.getManifest(m.id).status, "INVALIDATED");
  assert.equal(s.dist.getAttempt(attempt.id).status, "CANCELLED");
  s.set(T0 + 25 * 60000);
  const r = s.dist.recordManual({ attemptId: attempt.id, url: "https://www.youtube.com/watch?v=early", postedAt: new Date(T0 + 10 * 60000).toISOString() });
  assert.equal(r.attempt.status, "PUBLISHED", "history is never rewritten: the earlier post is recorded");
  const ev = r.attempt.evidence.at(-1);
  assert.equal(ev.recordedAfterWithdrawal, true);
  assert.equal(ev.withdrawnAt, new Date(T0 + 20 * 60000).toISOString());
});
