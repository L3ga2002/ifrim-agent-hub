// M10 manual check (not part of the suite): import a real Studio bundle (proiect-studio.json) into a TEST hub exactly like the owner's
// Studio would (preview → one import), then render one variant and print the legibility QA (what it measured and why).
//   node v2/tests/manual/m10-bundle-check.mjs <bundleDir> [platformKey=linkedin_4x5]
import path from "node:path";
import { makeTestHub, waitFor, enrolOwner } from "../helpers.mjs";
import { realLaunchers } from "../media-helpers.mjs";

const dir = path.resolve(process.argv[2] || ".");
const key = process.argv[3] || "linkedin_4x5";
const launchers = realLaunchers();
if (!launchers.available) { console.error("ffmpeg/ffprobe absent"); process.exit(1); }
const t = await makeTestHub({ configOverrides: { mediaTools: { launcher: launchers } } });
try {
  const owner = await enrolOwner(t);
  t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...t.hub.settings.get("mediaPolicy"), importRoots: [path.dirname(dir)], diskReserveGb: 0, interactivePriority: false }, "harness"));
  const as = (type, payload, channel = "test") => t.hub.commands.dispatch({ type, payload, channel, actor: `owner:${owner.session.id}`, ownerSession: owner.session }).then((r) => r.result);
  const pv = await as("media.project.preview", { dir });
  console.log(JSON.stringify({ preview: { format: pv.format, title: pv.title, assets: pv.assets.map((a) => ({ file: a.file, ok: a.ok })), versions: pv.edits.reduce((n, e) => n + e.versions, 0), labels: pv.labels, problems: pv.problems, missing: pv.missing, approvals: pv.approvals } }, null, 2));
  const imp = await as("media.project.import", { importId: pv.importId, previewHash: pv.previewHash }, "owner");
  console.log(JSON.stringify({ imported: { contentProjectId: imp.contentProjectId, duplicate: imp.duplicate } }));
  const editId = t.hub.db.prepare("SELECT id FROM media_edit_projects WHERE content_project_id = ?").get(imp.contentProjectId).id;
  const v = t.hub.db.prepare("SELECT id, version FROM media_edit_versions WHERE edit_project_id = ? AND variant_key = ? ORDER BY version DESC LIMIT 1").get(editId, key);
  if (!v) throw new Error(`nicio versiune ${key} în pachet`);
  const job = await as("media.render.request", { editVersionId: v.id, profile: "final" });
  await waitFor(() => ["DONE", "FAILED"].includes(t.hub.media.render.get(job.id)?.status), 600000, 500);
  const done = t.hub.media.render.get(job.id);
  if (done.status !== "DONE") throw new Error(`randarea a eșuat: ${JSON.stringify(done.error)}`);
  const qa = await as("media.qa.run", { editVersionId: v.id, assetVersionId: done.outputAssetVersionId, platform: key });
  const leg = qa.reports.legibility;
  console.log(JSON.stringify({ variant: key, version: v.version, qa: qa.status, legibility: { status: leg.status, findings: leg.findings.map((f) => ({ code: f.code, severity: f.severity, justified: f.justified, message: f.message })), items: leg.measurements.items } }, null, 2));
} finally { await t.cleanup(); }
