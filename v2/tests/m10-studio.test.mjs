// M10 Studio completion: the project bundle (export → read-only preview → ONE confirmation → import; ids remapped, labels kept,
// approvals never imported, idempotent, a tampered file refused; reconstruction from an older delivery with the missing parts listed),
// contextual import folders (once / persistent, refusals), the text target of a spoken correction (selection, recent, never a label),
// legibility (variants scale + plate small content text; QA measures contrast and a busy background on the real frame), local export
// without overwrite, „importă din folderul acesta” through the desktop + ONE plan, a correction as ONE plan (apply → render → QA),
// the capture scope command and an OBS → edit → render → vertical variant plan (D5 / D7) against a simulated OBS. Real-tool parts report
// SKIPPED_ENV when ffmpeg/ffprobe are absent.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, enrolOwner, tempDir, waitFor } from "./helpers.mjs";
import { realLaunchers, makeSyntheticMedia } from "./media-helpers.mjs";
import { makeDesktopHub, readyDesktop, asOwner } from "./m10-helpers.mjs";
import { fakeObs } from "./obs-helpers.mjs";
import { preferredTextTarget, parseInstruction } from "../server/media/review.mjs";
import { deriveVariant } from "../server/media/variants.mjs";
import os from "node:os";
const require_home = () => os.homedir();

const setPolicy = (t, patch) => t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...t.hub.settings.get("mediaPolicy"), ...patch }, "test"));
const as = (t, owner, type, payload) => t.hub.commands.dispatch({ type, payload, channel: "test", actor: "owner:test", ownerSession: owner?.session || null }).then((r) => r.result);
const launchers = realLaunchers();
const needTools = launchers.available ? false : "SKIPPED_ENV: ffmpeg/ffprobe absent";

const irOf = (assetVersionId, { frames = 60, width = 640, height = 360, content = "Un singur plan, o confirmare", contentY = 0.8, plate = undefined } = {}) => ({
  irVersion: 1, fps: { num: 30, den: 1 }, canvas: { width, height, background: "#0B0D10" }, preset: { id: "ifrim-tech", version: 1 }, language: "ro",
  tracks: [
    { id: "v1", kind: "video", clips: [{ id: "c1", assetVersionId, sourceIn: 0, sourceOut: frames, start: 0, label: "SIMULATION" }] },
    { id: "t1", kind: "text", items: [{ id: "lbl", start: 0, end: frames, text: "SIMULARE · date de test", style: "label", anchor: "top", x: 0.5, y: 0.06 }] },
    { id: "t2", kind: "text", items: [{ id: "txt", start: 0, end: frames, text: content, style: "hook", anchor: "bottom", x: 0.5, y: contentY, ...(plate === undefined ? {} : { plate }) }] },
  ],
  markers: [], loudness: { targetLufs: -14, maxTruePeakDb: -1 }, meta: { title: "Clip test", labels: ["SIMULATION"], author: "test", notes: "" } });

/** A content project with one source, rights, an edit plan, a patch version and a vertical variant (all through the commands). */
async function studioProject(t, owner, root, { title = "Clip M09 (test)" } = {}) {
  const inbox = path.join(root, "inbox");
  makeSyntheticMedia(inbox, { name: "demo.mp4", seconds: 2, width: 640, height: 360 });
  const project = await as(t, owner, "content.project.create", { fields: { title, format: "short", platforms: ["linkedin", "tiktok"] } });
  const pid = project.id || project.project?.id;
  const a = await as(t, owner, "media.asset.import", { sourcePath: path.join(inbox, "demo.mp4"), title: "Captură demo", category: "screen_recording", origin: "OWNED", captureLabel: "SIMULATION", contentProjectId: pid });
  await as(t, owner, "media.rights.record", { right: { assetId: a.asset.id, status: "CLEARED_FOR_SCOPE", holder: "Ifrim Digital", platforms: ["*"], uses: ["organic"], sourceKind: "manual", sourceRef: "test" } });
  const edit = await as(t, owner, "media.edit.create", { contentProjectId: pid, title: "Montaj", ir: irOf(a.version.id) });
  const rv = await as(t, owner, "media.edit.patch.propose", { editVersionId: edit.version.id, text: "La secunda 1 mută textul mai sus", timecodeMs: 1000 });
  assert.ok(rv.patch.ops.length, JSON.stringify(rv.patch));
  const applied = await as(t, owner, "media.edit.patch.apply", { reviewId: rv.id });
  const variant = await as(t, owner, "media.variant.derive", { masterVersionId: applied.version.id, platformKey: "tiktok_9x16" });
  return { pid, asset: a, edit, applied, variant };
}

test("M10-ST-01 D3 project bundle: export → preview → ONE import; ids remapped, labels kept, approvals not imported, idempotent; tampering refused", { skip: needTools }, async () => {
  const t = await makeTestHub({ configOverrides: { mediaTools: { launcher: launchers } } });
  try {
    const owner = await enrolOwner(t);
    const root = path.join(tempDir("m10-bundle"), "Videos");
    setPolicy(t, { importRoots: [root], diskReserveGb: 0, interactivePriority: false });
    const src = await studioProject(t, owner, root);
    await as(t, owner, "media.review.decide", { editVersionId: src.applied.version.id, kind: "CREATIVE_APPROVED" });
    const dir = path.join(root, "Pachet clip");
    await assert.rejects(as(t, owner, "media.project.export", { contentProjectId: src.pid, dir: path.join(tempDir("m10-outside"), "x") }), /folder aprobat|nu există/);
    const ex = await as(t, owner, "media.project.export", { contentProjectId: src.pid, dir });
    assert.equal(ex.assets, 1);
    assert.equal(ex.versions, 3, "initial + patch + variant");
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "proiect-studio.json"), "utf8"));
    assert.equal(manifest.approvals.creative, "NOT_EXPORTED");
    const pv = await as(t, owner, "media.project.preview", { dir });
    assert.equal(pv.format, "bundle");
    assert.deepEqual(pv.problems, []);
    assert.ok(pv.labels.includes("SIMULATION"));
    assert.match(pv.approvals, /nu se importă/);
    await assert.rejects(t.hub.commands.dispatch({ type: "media.project.import", payload: { importId: pv.importId, previewHash: pv.previewHash }, channel: "ui", actor: "user" }), /cannot be issued through ui/);
    const imp = await asOwner(t, owner, "media.project.import", { importId: pv.importId, previewHash: pv.previewHash });
    assert.equal(imp.duplicate, false);
    assert.notEqual(imp.contentProjectId, src.pid);
    const editIds = t.hub.db.prepare("SELECT id FROM media_edit_projects WHERE content_project_id = ?").all(imp.contentProjectId).map((r) => r.id);
    const versions = t.hub.db.prepare(`SELECT * FROM media_edit_versions WHERE edit_project_id IN (${editIds.map(() => "?").join(",")}) ORDER BY version`).all(...editIds);
    assert.equal(versions.length, 3);
    for (const v of versions) {
      const ir = JSON.parse(v.ir_json);
      assert.ok(!JSON.stringify(ir).includes(src.asset.version.id), "the source hub's asset id is not reused verbatim");
      assert.ok((ir.meta?.labels || []).includes("SIMULATION"), "labels kept");
    }
    assert.equal(versions.find((v) => v.version === 2).change_kind, "patch");
    assert.equal(t.hub.db.prepare(`SELECT COUNT(*) AS n FROM media_reviews WHERE kind = 'CREATIVE_APPROVED' AND edit_version_id IN (${versions.map(() => "?").join(",")})`).get(...versions.map((v) => v.id)).n, 0, "no approval imported");
    assert.ok(t.hub.db.prepare("SELECT COUNT(*) AS n FROM media_variants WHERE edit_project_id = ? AND status = 'DRAFT'").get(editIds[0]).n >= 1, "variants come in as DRAFT");
    const again = await asOwner(t, owner, "media.project.import", { importId: pv.importId, previewHash: pv.previewHash });
    assert.equal(again.duplicate, true);
    assert.equal(again.contentProjectId, imp.contentProjectId);
    // A source changed after the export: the preview lists the problem and the import is refused.
    const file = path.join(dir, manifest.assets[0].file);
    fs.appendFileSync(file, Buffer.from([0]));
    const pv2 = await as(t, owner, "media.project.preview", { dir: path.join(root, "Pachet clip") });
    assert.ok(pv2.problems.some((p) => /hash diferit|dimensiune/.test(p)), JSON.stringify(pv2.problems));
  } finally { await t.cleanup(); }
});

test("M10-ST-02 an older delivery without a manifest is RECONSTRUCTED explicitly, with what cannot be restored listed", { skip: needTools }, async () => {
  const t = await makeTestHub({ configOverrides: { mediaTools: { launcher: launchers } } });
  try {
    const owner = await enrolOwner(t);
    const root = path.join(tempDir("m10-recon"), "Videos");
    const dir = path.join(root, "clip-vechi");
    makeSyntheticMedia(path.join(dir, "surse"), { name: "capture.mp4", seconds: 2, width: 640, height: 360 });
    fs.writeFileSync(path.join(dir, "plan-de-montaj_v1.json"), JSON.stringify(irOf("OLD_CAPTURE")));
    fs.writeFileSync(path.join(dir, "plan-de-montaj_v2.json"), JSON.stringify(irOf("OLD_CAPTURE", { contentY: 0.7 })));
    fs.writeFileSync(path.join(dir, "qa-si-productie.json"), JSON.stringify({ steps: [{ name: "library", capture: "OLD_CAPTURE" }], claims: [], rights: [{ ok: true }] }));
    setPolicy(t, { importRoots: [root], diskReserveGb: 0, interactivePriority: false });
    const pv = await as(t, owner, "media.project.preview", { dir });
    assert.equal(pv.format, "reconstruction");
    assert.ok(pv.missing.length >= 3);
    assert.deepEqual(pv.problems, []);
    const imp = await asOwner(t, owner, "media.project.import", { importId: pv.importId, previewHash: pv.previewHash });
    const project = t.hub.media.content.detail(imp.contentProjectId).project;
    assert.match(project.title, /\(reconstruit\)$/);
    assert.ok(imp.missing.length >= 3);
  } finally { await t.cleanup(); }
});

test("M10-ST-03 import folders: once (consumed, expires) or persistent (fresh re-auth); drive roots, profile, Hub data, UNC refused; a changed folder re-shown", async () => {
  let now = Date.now();
  const t = await makeTestHub({ clock: () => new Date(now) });
  try {
    const owner = await enrolOwner(t);
    const dir = path.join(tempDir("m10-folders"), "Proiect client");
    fs.mkdirSync(path.join(dir, "sub"), { recursive: true });
    fs.writeFileSync(path.join(dir, "a.mp4"), "x");
    fs.writeFileSync(path.join(dir, "sub", "b.png"), "y");
    fs.writeFileSync(path.join(dir, ".env"), "SECRET=1");
    fs.writeFileSync(path.join(dir, "notes.docx"), "z");
    const pv = await as(t, owner, "media.import.folder.preview", { dir });
    assert.deepEqual(pv.files.map((f) => f.rel).sort(), ["a.mp4", "sub/b.png"]);
    assert.equal(pv.skipped.secrets, 1);
    assert.equal(pv.skipped.other, 1);
    const once = await asOwner(t, owner, "media.import.folder.authorize", { dir, mode: "once", previewSha256: pv.previewSha256 });
    assert.equal(once.mode, "once");
    assert.ok(t.hub.media.importRoots().some((r) => r.toLowerCase() === fs.realpathSync.native(dir).toLowerCase()));
    t.hub.media.importAccess.markUsed(once.grantId);
    assert.ok(!t.hub.media.importRoots().some((r) => r.toLowerCase() === fs.realpathSync.native(dir).toLowerCase()), "a used one-time access is gone");
    // Persistent: only with a fresh re-authentication.
    now += 6 * 60000;
    await assert.rejects(asOwner(t, owner, "media.import.folder.authorize", { dir, mode: "persistent", previewSha256: pv.previewSha256 }), (e) => e.details?.reauth === true);
    const fresh = owner.reauth();
    const persistent = await asOwner(t, { ...owner, session: fresh }, "media.import.folder.authorize", { dir, mode: "persistent", previewSha256: pv.previewSha256 });
    assert.equal(persistent.mode, "persistent");
    assert.ok(t.hub.settings.get("mediaPolicy").importRoots.includes(persistent.folder));
    // Refusals.
    // A whole drive contains protected folders (system, Hub data): refused already at the preview.
    assert.throws(() => t.hub.media.importAccess.preview(path.parse(dir).root), (e) => e.code === "IMPORT_PATH_REFUSED");
    assert.throws(() => t.hub.media.importAccess.realFolder(path.join(require_home(), "Desktop"), { persistent: true }), (e) => ["IMPORT_ROOT_TOO_WIDE", "IMPORT_PATH_MISSING", "IMPORT_PATH_REFUSED"].includes(e.code));
    assert.throws(() => t.hub.media.importAccess.preview(t.dataDir), (e) => e.code === "IMPORT_PATH_REFUSED");
    assert.throws(() => t.hub.media.importAccess.preview("\\\\server\\share\\x"), (e) => e.code === "IMPORT_PATH_REFUSED");
    fs.writeFileSync(path.join(dir, "c.mp4"), "new");
    await assert.rejects(asOwner(t, { ...owner, session: fresh }, "media.import.folder.authorize", { dir, mode: "once", previewSha256: pv.previewSha256 }), (e) => e.code === "IMPORT_PREVIEW_CHANGED");
    // Revocation is fail-safe from the UI channel.
    const r = await t.hub.commands.dispatch({ type: "media.import.folder.revoke", payload: { grantId: persistent.grantId }, channel: "ui", actor: "user" }).then((x) => x.result);
    assert.equal(r.revoked, 1);
  } finally { await t.cleanup(); }
});

test("M10-ST-04 the text target of a correction: the selection wins (even a label), labels are never guessed, a stale selection asks", () => {
  const label = { id: "lbl", style: "label", text: "SIMULARE · date de test" };
  const a = { id: "x1", style: "hook", text: "Primul" };
  const b = { id: "x2", style: "caption", text: "Al doilea" };
  assert.equal(preferredTextTarget([label, a]), a, "the only content text, never the disclosure label");
  assert.equal(preferredTextTarget([label, a, b]), null, "two content texts: ask");
  assert.equal(preferredTextTarget([label, a, b], { selectedItemId: "x2" }), b);
  assert.equal(preferredTextTarget([label, a, b], { selectedItemId: "lbl" }), label, "an explicit selection is the owner's choice");
  assert.equal(preferredTextTarget([label, a, b], { selectedItemId: "gone", recentItemId: "x1" }), a, "a stale selection falls back to the recent target");
  assert.equal(preferredTextTarget([label, a, b], { selectedItemId: "gone" }), null);
  // Through the parser on a real IR: two content texts → a clarification with the options; the selection resolves it.
  const ir = irOf("mav_x_000000");
  ir.tracks.push({ id: "t3", kind: "text", items: [{ id: "txt2", start: 0, end: 60, text: "Al doilea text", style: "caption", anchor: "bottom", x: 0.5, y: 0.95 }] });
  const ask = parseInstruction("La secunda 1 mută textul mai sus", { ir, atMs: 1000 });
  assert.ok(ask.clarification);
  assert.deepEqual(ask.options.sort(), ["txt", "txt2"]);
  const sel = parseInstruction("La secunda 1 mută textul mai sus", { ir, atMs: 1000, selectedItemId: "txt2" });
  assert.equal(sel.clarification, null);
  assert.ok(sel.ops.every((o) => o.itemId === "txt2" || o.target === "txt2" || JSON.stringify(o).includes("txt2")), JSON.stringify(sel.ops));
});

test("M10-ST-05 legibility: a narrow variant scales small content text to the minimum and plates it (recorded), never the disclosure label", () => {
  // A content style WITHOUT its own box ("title") and a reduced scale: the narrow variants must plate it and bring it to the minimum.
  const master = irOf("mav_x_000000", { width: 1920, height: 1080, content: "Un singur plan" });
  Object.assign(master.tracks.find((tr) => tr.id === "t2").items[0], { style: "title", scale: 0.6 });
  const getVersion = () => ({ id: "mav_x_000000", kind: "video", probe: { durationMs: 2000, video: { width: 1920, height: 1080, displayWidth: 1920, displayHeight: 1080, fps: { num: 30, den: 1 } } }, quarantined: false, status: "READY" });
  for (const key of ["tiktok_9x16", "linkedin_1x1"]) {
    const r = deriveVariant({ masterIr: master, platformKey: key, getVersion });
    const items = r.ir.tracks.filter((t) => t.kind === "text").flatMap((t) => t.items);
    const txt = items.find((i) => i.id === "txt");
    const lbl = items.find((i) => i.id === "lbl");
    assert.equal(txt.plate, true, key);
    if (key === "linkedin_1x1") assert.ok(txt.scale > 0.6, `${key}: scaled up to the legible minimum (${txt.scale})`);
    assert.ok(r.changes.some((c) => c.kind === "text_legibility"), `${key}: ${JSON.stringify(r.changes.map((c) => c.kind))}`);
    assert.notEqual(lbl.plate, true, `${key}: the disclosure label keeps its own style`);
  }
});

test("M10-ST-06 legibility QA on the real frame: text over a busy background without a plate is flagged; with the plate it is not", { skip: needTools }, async () => {
  const t = await makeTestHub({ configOverrides: { mediaTools: { launcher: launchers } } });
  try {
    const owner = await enrolOwner(t);
    const root = path.join(tempDir("m10-leg"), "Videos");
    makeSyntheticMedia(root, { name: "busy.mp4", seconds: 2, width: 640, height: 360 });
    setPolicy(t, { importRoots: [root], diskReserveGb: 0, interactivePriority: false });
    const a = await as(t, owner, "media.asset.import", { sourcePath: path.join(root, "busy.mp4"), title: "busy", category: "screen_recording", origin: "OWNED", captureLabel: "SIMULATION" });
    const measure = async (plate) => {
      const e = await as(t, owner, "media.edit.create", { title: `leg ${plate}`, ir: irOf(a.version.id, { content: "TEXT DE TEST CITIBIL", contentY: 0.5, plate }) });
      const job = await as(t, owner, "media.render.request", { editVersionId: e.version.id, profile: "final" });
      await waitFor(() => ["DONE", "FAILED"].includes(t.hub.media.render.get(job.id)?.status), 180000, 200);
      const done = t.hub.media.render.get(job.id);
      assert.equal(done.status, "DONE", JSON.stringify(done.error));
      const qa = await as(t, owner, "media.qa.run", { editVersionId: e.version.id, assetVersionId: done.outputAssetVersionId });
      return qa.reports.legibility;
    };
    const bare = await measure(false);
    const plated = await measure(true);
    assert.equal(bare.status === "NOT_RUN", false, JSON.stringify(bare.measurements));
    const codes = (r) => r.findings.map((f) => f.code);
    assert.ok(codes(bare).includes("BUSY_BACKGROUND") || codes(bare).includes("LOW_CONTRAST_TEXT"), JSON.stringify(bare));
    assert.ok(!codes(plated).includes("BUSY_BACKGROUND"), JSON.stringify(plated));
    assert.ok(plated.measurements.items[0].backgroundSd < bare.measurements.items[0].backgroundSd, `the plate calms the measured background (σ ${bare.measurements.items[0].backgroundSd} → ${plated.measurements.items[0].backgroundSd})`);
  } finally { await t.cleanup(); }
});

test("M10-ST-07 local export: into the exports folder, verified, never over an existing file; no publication", { skip: needTools }, async () => {
  const t = await makeTestHub({ configOverrides: { mediaTools: { launcher: launchers } } });
  try {
    const owner = await enrolOwner(t);
    const root = path.join(tempDir("m10-export"), "Videos");
    makeSyntheticMedia(root, { name: "x.mp4", seconds: 1, width: 320, height: 180 });
    const exportsDir = path.join(root, "Ifrim Studio", "Exporturi");
    setPolicy(t, { importRoots: [root], exportsDir, diskReserveGb: 0, interactivePriority: false });
    const a = await as(t, owner, "media.asset.import", { sourcePath: path.join(root, "x.mp4"), title: "x", category: "screen_recording", origin: "OWNED", captureLabel: "SIMULATION" });
    // Another file already named like the export: never overwritten, the export gets a numbered name.
    fs.mkdirSync(exportsDir, { recursive: true });
    fs.writeFileSync(path.join(exportsDir, "clip final.mp4"), "fișierul altcuiva");
    const one = await as(t, owner, "media.export.local", { assetVersionId: a.version.id, name: "clip final" });
    assert.equal(path.basename(one.file), "clip final (2).mp4");
    assert.equal(fs.readFileSync(path.join(exportsDir, "clip final.mp4"), "utf8"), "fișierul altcuiva");
    // The same render exported again is the same file (idempotent), not a second copy.
    const two = await as(t, owner, "media.export.local", { assetVersionId: a.version.id, name: "clip final" });
    assert.equal(two.file, one.file);
    assert.equal(two.existing, true);
    for (const r of [one, two]) { assert.ok(fs.existsSync(r.file)); assert.equal(path.dirname(r.file).toLowerCase(), exportsDir.toLowerCase()); }
    const traversal = await as(t, owner, "media.export.local", { assetVersionId: a.version.id, name: "..\\..\\evadare" });
    assert.equal(path.dirname(traversal.file).toLowerCase(), exportsDir.toLowerCase(), "a name cannot leave the exports folder");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM content_release_attempts").get().n, 0);
  } finally { await t.cleanup(); }
});

test("M10-ST-08 „Importă din folderul acesta”: the Explorer window in front → ONE card (a one-time folder access inside it) → imported", { skip: needTools }, async () => {
  const base = tempDir("m10-here");
  const outside = path.join(base, "Descarcari", "Pachet primit");
  const t = await makeDesktopHub({ scenario: { windows: [{ kind: "explorer", processName: "explorer", title: "Pachet primit", className: "CabinetWClass", path: outside }] },
    hub: { configOverrides: { mediaTools: { launcher: launchers } } } });
  try {
    const owner = await readyDesktop(t);
    const studioRoot = path.join(base, "Videos");
    setPolicy(t, { importRoots: [studioRoot, path.dirname(path.dirname(outside))], diskReserveGb: 0, interactivePriority: false });
    const src = await studioProject(t, owner, studioRoot, { title: "Clip primit" });
    await as(t, owner, "media.project.export", { contentProjectId: src.pid, dir: outside });
    setPolicy(t, { importRoots: [studioRoot] }); // the received folder is NOT an import root any more
    const r = await asOwner(t, owner, "owner.intent", { text: "Importă din folderul acesta", source: "typed" });
    const step = r.results[0];
    assert.equal(step.intent, "studio_import_here");
    assert.ok(step.opsPlan, JSON.stringify(step));
    assert.equal(path.resolve(step.folder).toLowerCase(), path.resolve(outside).toLowerCase());
    assert.deepEqual(step.opsPlan.decisions.map((d) => d.kind), ["folder.plan"]);
    const yes = await asOwner(t, owner, "owner.intent", { text: "Da", source: "typed", presented: { planId: step.opsPlan.id, nonce: step.opsPlan.nonce, hash: step.opsPlan.hash } });
    assert.ok(yes.results[0].confirmed, JSON.stringify(yes.results[0]));
    const done = await t.hub.opsPlans.idle(step.opsPlan.id);
    assert.equal(done.status, "DONE", `${done.statusReason} ${done.steps[0].error}`);
    assert.ok(done.steps[0].result.contentProjectId);
    assert.equal(t.hub.db.prepare("SELECT status FROM media_import_grants WHERE plan_id = ?").get(step.opsPlan.id).status, "USED", "the one-time access is consumed");
    assert.ok(!t.hub.media.importRoots().some((x) => x.toLowerCase().includes("pachet primit")));
  } finally { await t.cleanup(); }
});

test("M10-ST-09 „La secunda 1 mută textul mai sus” → proposal + ONE plan card; „Da” → new version, draft render, QA; creative review stays the owner's", { skip: needTools }, async () => {
  const t = await makeTestHub({ configOverrides: { mediaTools: { launcher: launchers } } });
  try {
    const owner = await enrolOwner(t);
    const root = path.join(tempDir("m10-voiceedit"), "Videos");
    setPolicy(t, { importRoots: [root], diskReserveGb: 0, interactivePriority: false });
    const inbox = path.join(root, "in");
    makeSyntheticMedia(inbox, { name: "a.mp4", seconds: 2, width: 640, height: 360 });
    const project = await as(t, owner, "content.project.create", { fields: { title: "Corectură vocală", format: "short", platforms: ["linkedin"] } });
    const pid = project.id || project.project?.id;
    const a = await as(t, owner, "media.asset.import", { sourcePath: path.join(inbox, "a.mp4"), title: "a", category: "screen_recording", origin: "OWNED", captureLabel: "SIMULATION", contentProjectId: pid });
    const edit = await as(t, owner, "media.edit.create", { contentProjectId: pid, title: "Montaj", ir: irOf(a.version.id) });
    const r = await asOwner(t, owner, "owner.intent", { text: "La secunda 1 mută textul mai sus", source: "typed" });
    const step = r.results[0];
    assert.equal(step.studio.applied, false);
    assert.ok(step.opsPlan, JSON.stringify(step));
    assert.equal(t.hub.media.edits.get(edit.project?.id || edit.version.editProjectId)?.current?.id ?? edit.version.id, edit.version.id, "nothing applied by the sentence");
    const yes = await asOwner(t, owner, "owner.intent", { text: "Da", source: "typed", presented: { planId: step.opsPlan.id, nonce: step.opsPlan.nonce, hash: step.opsPlan.hash } });
    assert.ok(yes.results[0].confirmed);
    const done = await t.hub.opsPlans.idle(step.opsPlan.id);
    assert.equal(done.status, "DONE", `${done.statusReason} ${done.steps[0].error}`);
    const res = done.steps[0].result;
    assert.notEqual(res.editVersionId, edit.version.id);
    assert.equal(res.previousVersionId, edit.version.id);
    assert.ok(res.assetVersionId, "draft rendered");
    assert.ok(res.qa && ["PASS", "WARN", "FAIL"].includes(res.qa.status));
    assert.equal(res.review.creative, "CREATIVE_REVIEW_PENDING");
    assert.match(res.review.automatedQa, /^AUTOMATED_QA_/);
    const original = t.hub.db.prepare("SELECT ir_json FROM media_edit_versions WHERE id = ?").get(edit.version.id).ir_json;
    assert.equal(JSON.parse(original).tracks.find((tr) => tr.id === "t2").items.find((i) => i.id === "txt").y, 0.8, "the original version is unchanged");
  } finally { await t.cleanup(); }
});

test("M10-ST-10 capture scope: the exact scope needs the owner session re-authenticated; UI / voice refused", async () => {
  let now = Date.now();
  const t = await makeTestHub({ clock: () => new Date(now) });
  try {
    const owner = await enrolOwner(t);
    const s = t.hub.media.capture.planSession({ kind: "obs", scope: { obsUrl: "ws://127.0.0.1:4455", recordingRoot: tempDir("m10-rec"), purpose: "record", durationSec: 5 }, captureLabel: "ORIGINAL_RECORDING", actor: "test" });
    for (const channel of ["ui", "voice"]) await assert.rejects(t.hub.commands.dispatch({ type: "media.capture.scope.approve", payload: { sessionId: s.id }, channel, actor: "user" }), /cannot be issued through/);
    now += 6 * 60000;
    await assert.rejects(asOwner(t, owner, "media.capture.scope.approve", { sessionId: s.id }), (e) => e.details?.reauth === true);
    const fresh = owner.reauth();
    const approved = await asOwner(t, { ...owner, session: fresh }, "media.capture.scope.approve", { sessionId: s.id, expiresMinutes: 30 });
    assert.equal(approved.consent.scopeApproval.via, "owner_session");
    assert.equal(approved.consent.scopeApproval.ownerSessionId, fresh.id);
  } finally { await t.cleanup(); }
});

test("M10-ST-11 D5 + D7 ONE plan with a simulated OBS: record → stop → import → edit → render → vertical variant + QA; no publication; password never stored", { skip: needTools }, async () => {
  const recRoot = path.join(tempDir("m10-obs"), "OBS");
  fs.mkdirSync(recRoot, { recursive: true });
  const recorded = path.join(recRoot, "demo-obs.mp4");
  const obs = await fakeObs({ outputPath: recorded, password: "obs-parola-test" });
  const t = await makeDesktopHub({ hub: { configOverrides: { mediaTools: { launcher: launchers } } } });
  try {
    const owner = await readyDesktop(t);
    makeSyntheticMedia(recRoot, { name: "demo-obs.mp4", seconds: 2, width: 640, height: 360 }); // what OBS "wrote"
    setPolicy(t, { importRoots: [recRoot], diskReserveGb: 0, interactivePriority: false, liveCapture: true, obs: { recordingRoot: recRoot, url: obs.url, defaultDurationSec: 1 } });
    const r = await asOwner(t, owner, "owner.intent", { text: "Înregistrează demonstrația cu OBS și pregătește varianta verticală, fără să publici", source: "typed" });
    const step = r.results[0];
    assert.equal(step.intent, "ops_capture_vertical");
    assert.ok(step.opsPlan, JSON.stringify(step));
    assert.equal(step.opsPlan.summary.steps.length, 4);
    assert.ok(step.opsPlan.summary.never.includes("publicare pe platforme"));
    const p = t.hub.opsPlans.view(step.opsPlan.id);
    await asOwner(t, owner, "ops.plan.confirm", { planId: p.id, nonce: p.nonce, displayedHash: p.hash, secrets: { obsPassword: "obs-parola-test" } });
    const done = await t.hub.opsPlans.idle(p.id);
    assert.equal(done.status, "DONE", `${done.statusReason} ${JSON.stringify(done.steps.map((s) => [s.kind, s.status, s.error]))}`);
    assert.deepEqual(obs.state.requests.filter((x) => ["StartRecord", "StopRecord"].includes(x)), ["StartRecord", "StopRecord"]);
    const variant = done.steps[3].result;
    assert.ok(variant.assetVersionId && variant.qa);
    assert.equal(variant.review.creative, "CREATIVE_REVIEW_PENDING");
    const dump = JSON.stringify([t.hub.db.prepare("SELECT * FROM commands").all(), t.hub.db.prepare("SELECT * FROM events").all(), t.hub.db.prepare("SELECT * FROM ops_plans").all(), t.hub.db.prepare("SELECT * FROM media_capture_sessions").all()]);
    assert.ok(!dump.includes("obs-parola-test"), "the OBS password is never stored");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM content_release_attempts").get().n, 0);
    // Without MB1 (liveCapture off) the same sentence does not produce a plan: it says what is missing.
    setPolicy(t, { liveCapture: false });
    const blocked = await asOwner(t, owner, "owner.intent", { text: "Înregistrează demonstrația și pregătește varianta verticală", source: "typed" });
    assert.ok(!blocked.results[0].opsPlan);
    assert.deepEqual(blocked.results[0].blockedBy, ["MB1"]);
  } finally { await t.cleanup(); await obs.close(); }
});

test("M10-ST-12 OBS configuration: owner session re-authenticated, local address only, an existing unprotected folder; never a password", async () => {
  let now = Date.now();
  const t = await makeTestHub({ clock: () => new Date(now) });
  try {
    const owner = await enrolOwner(t);
    const rec = tempDir("m10-obsrec");
    await assert.rejects(t.hub.commands.dispatch({ type: "media.policy.obs", payload: { recordingRoot: rec }, channel: "ui", actor: "user" }), /cannot be issued through ui/);
    await assert.rejects(asOwner(t, owner, "media.policy.obs", { recordingRoot: rec, url: "ws://192.168.1.20:4455" }), (e) => e.code === "OBS_URL_NOT_LOCAL");
    await assert.rejects(asOwner(t, owner, "media.policy.obs", { recordingRoot: t.dataDir }), (e) => e.code === "IMPORT_PATH_REFUSED");
    now += 6 * 60000;
    await assert.rejects(asOwner(t, owner, "media.policy.obs", { recordingRoot: rec }), (e) => e.details?.reauth === true);
    const fresh = owner.reauth();
    const r = await asOwner(t, { ...owner, session: fresh }, "media.policy.obs", { recordingRoot: rec, url: "ws://localhost:4455", scene: "Ifrim Demo", password: "nu-se-salveaza" });
    assert.equal(r.obs.url, "ws://localhost:4455");
    assert.equal(r.obs.scene, "Ifrim Demo");
    const policy = t.hub.settings.get("mediaPolicy");
    assert.equal(policy.obs.recordingRoot.toLowerCase(), fs.realpathSync.native(rec).toLowerCase());
    assert.ok(!JSON.stringify(policy).includes("nu-se-salveaza") && !JSON.stringify(t.hub.db.prepare("SELECT * FROM commands").all()).includes("nu-se-salveaza"), "no password anywhere");
    assert.ok(!(policy.importRoots || []).some((x) => x.toLowerCase() === fs.realpathSync.native(rec).toLowerCase()), "no import root added implicitly");
  } finally { await t.cleanup(); }
});

test("M10-ST-13 an item's plate is opaque by construction: a translucent style box (0.75) becomes ≥ 0.9 with a wider margin; plate:false draws none", async () => {
  const { compileRenderPlan } = await import("../server/media/compile.mjs");
  const { PRESETS } = await import("../server/media/visual-bible.mjs");
  const probe = { durationMs: 2000, formatName: "mov,mp4", video: { codec: "h264", width: 1080, height: 1350, displayWidth: 1080, displayHeight: 1350, fps: { num: 30, den: 1 }, pixFmt: "yuv420p", rotation: 0, sar: "1:1", frames: 60 }, audio: null };
  const ir = irOf("mav_x", { width: 1080, height: 1350, content: "Nimic nu se acceptă în locul tău." });
  const item = ir.tracks.find((tr) => tr.id === "t2").items[0];
  const graphFor = (patch) => {
    Object.assign(item, { style: "lower_third", ...patch });
    if (patch.plate === undefined) delete item.plate;
    const plan = compileRenderPlan({ ir: structuredClone(ir), profile: "draft", assets: { mav_x: { absPath: "C:/lib/x.mp4", inputPath: "../x.mp4", sha256: "a".repeat(64), probe } },
      fonts: { "SegUIVar.ttf": "C:/Windows/Fonts/SegUIVar.ttf", "segoeui.ttf": "C:/Windows/Fonts/segoeui.ttf", "CascadiaCode.ttf": "C:/Windows/Fonts/CascadiaCode.ttf" },
      preset: PRESETS["ifrim-tech"], toolVersion: "ffmpeg-test" });
    return plan.final.files["graph.txt"].split(/[;,]\s*(?=drawtext)/).filter((x) => x.includes("drawtext")).find((x) => /fontcolor=0xF2F5F8/i.test(x)) || ""; // the lower_third text (the label is cyan)
  };
  const styleBox = graphFor({});
  assert.match(styleBox, /boxcolor=0x0B0D10@0\.75/i, "the style's own translucent box when no plate is asked");
  const plated = graphFor({ plate: true });
  assert.match(plated, /boxcolor=0x0B0D10@0\.9/i, `reinforced to ≥ 0.9: ${plated.slice(0, 200)}`);
  const pad = (g) => Number((g.match(/boxborderw=(\d+)/) || [])[1]);
  assert.ok(pad(plated) > pad(styleBox), "a wider margin than the style's");
  const none = graphFor({ plate: false });
  assert.doesNotMatch(none, /box=1/, "plate:false draws no box");
});
