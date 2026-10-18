import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, FIXTURES, tempDir } from "./helpers.mjs";
import { fakeLaunchers } from "./media-helpers.mjs";
import { insertEditVersion } from "../server/media/review.mjs";
import { createCapture } from "../server/media/capture.mjs";
import { createRenderQueue } from "../server/media/render.mjs";
import { createMediaTranscriber } from "../server/media/transcribe.mjs";

const probe = { format: { format_name: "mov,mp4", duration: "2.0", size: "4096" }, streams: [
  { index: 0, codec_type: "video", codec_name: "h264", width: 640, height: 360, avg_frame_rate: "30/1", pix_fmt: "yuv420p", nb_frames: "60" },
] };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

for (const kind of ["pin", "ingest", "qa", "render", "capture", "transcribe-extract", "transcribe-launch"]) test(`round4 HUB_SHUTDOWN during ${kind} persists no content verdict`, async (t) => {
  const launchers = { ...fakeLaunchers({ FAKE_FFPROBE_JSON: JSON.stringify(probe) }),
    whisperCli: { executable: process.execPath, prefixArgs: [path.join(FIXTURES, "fake-whisper-cli.mjs")] } };
  const h = await makeTestHub({ configOverrides: { mediaTools: { launcher: launchers, ffmpeg: null, ffprobe: null } } });
  t.after(() => h.cleanup());
  const { media, db, bus, settings } = h.hub;
  bus.transaction(() => settings.set("mediaPolicy", { ...settings.get("mediaPolicy"), diskReserveGb: 0 }, "test"));
  const sourceDir = tempDir("shutdown-source");
  t.after(() => fs.rmSync(sourceDir, { recursive: true, force: true }));
  const file = path.join(sourceDir, "input.mp4");
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(2048)]));
  const ingest = () => media.assets.ingestFile({ sourcePath: file, allowedRoots: [sourceDir], origin: "OWNED", actor: "test" });
  const source = await ingest();
  const ir = { irVersion: 1, fps: { num: 30, den: 1 }, canvas: { width: 640, height: 360, background: "#0B0D10" },
    preset: { id: "ifrim-tech", version: 1 }, language: "ro",
    tracks: [{ id: "v1", kind: "video", clips: [{ id: "c1", assetVersionId: source.version.id, sourceIn: 0, sourceOut: 30, start: 0 }] }],
    markers: [], meta: { title: "Synthetic", labels: [], author: "", notes: "" } };
  const at = new Date().toISOString();
  db.prepare("INSERT INTO media_edit_projects (id, title, current_version, created_by, created_at, updated_at) VALUES ('round4', 'Synthetic', 0, 'test', ?, ?)").run(at, at);
  const version = insertEditVersion(db, bus, () => new Date(), { editProjectId: "round4", ir, changeKind: "initial", actor: "test" });
  let job;
  const render = createRenderQueue({ db, bus, settings, paths: media.paths, tools: media.tools, assets: media.assets,
    resolveToolVersion: async () => "fake-ffmpeg-1" });
  if (kind === "render") {
    job = render.request({ editVersionId: version.id, profile: "draft", actor: "test" });
  }
  const capture = createCapture({ db, bus, settings, config: h.config, paths: media.paths, assets: media.assets, tools: media.tools,
    launch: async () => h.hub.supervisor.start({ key: "capture-refused", executable: process.execPath,
      args: [path.join(FIXTURES, "cleanup-bounded.mjs"), "--blocker"], cwd: FIXTURES }) });
  const entered = deferred(), release = deferred();
  h.hub.desktop.close = async () => { entered.resolve(); await release.promise; };
  const closing = h.hub.close();
  try {
    await entered.promise;
    if (kind.startsWith("transcribe-")) {
      if (kind === "transcribe-launch") fs.writeFileSync(file, Buffer.concat([Buffer.from("ID3"), Buffer.from([4, 0, 0, 0, 0, 0, 0]), Buffer.alloc(256, 0x55)]));
      const transcriber = createMediaTranscriber({ db, bus, config: h.config, settings, supervisor: h.hub.supervisor, tools: media.tools,
        voiceEngine: { verifyIntegrity: async () => ({ ok: true, fixture: true }), activity: () => ({ running: false, pending: 0 }),
          paths: { stt: path.join(h.dataDir, "synthetic-model-placeholder") } } });
      const work = await transcriber.start({ absPath: file, allowedRoots: [sourceDir], actor: "test", channel: "test" });
      assert.equal((await work.done).status, "running");
      assert.equal(transcriber.get(work.transcript.id).status, "running", "boot owns interrupted transcription");
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'media.transcript.failed'").get().n, 0);
    } else if (kind === "render") {
      const done = await render.tick().done;
      assert.ok(done && !["FAILED", "DONE", "CANCELLED"].includes(done.status), JSON.stringify(done));
      assert.equal(done.error, null);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'media.render.failed'").get().n, 0);
      render.recover();
      assert.equal(render.get(job.id).status, "INTERRUPTED");
    } else {
      const work = kind === "pin" ? () => media.tools.pin({ actor: "test" })
        : kind === "ingest" ? () => { fs.appendFileSync(file, "new bytes"); return ingest(); }
          : kind === "qa" ? () => media.qa.run({ editVersionId: version.id, assetVersionId: source.version.id, actor: "test" })
            : () => capture.captureBrowserDemo({ actor: "test", origin: "http://127.0.0.1:19199", allowOrigin: async () => true,
              captureLabel: "SIMULATION", steps: [{ goto: "/" }] });
      await assert.rejects(work(), (error) => error.code === "HUB_SHUTDOWN");
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM media_qa_reports").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM media_asset_versions WHERE status = 'QUARANTINED'").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'media.capture.failed'").get().n, 0);
    if (kind === "capture") assert.equal(capture.list()[0].status, "RECORDING", "boot owns interruption recovery");
    assert.deepEqual(h.hub.supervisor.list(), []);
  } finally { release.resolve(); await closing; }
});
