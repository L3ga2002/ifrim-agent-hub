// Run outside node:test under strict rejection semantics: a dropped rejection must crash.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, FIXTURES, tempDir, waitFor } from "../helpers.mjs";
import { fakeLaunchers } from "../media-helpers.mjs";
import { createMediaTranscriber, makeFfmpegExtractor } from "../../server/media/transcribe.mjs";
import { createExecutors } from "../../server/ops/executors.mjs";
import { HubError } from "../../server/core/errors.mjs";

const mode = process.argv[2];
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const problems = [];
process.on("unhandledRejection", (error) => problems.push(error.message));
process.on("uncaughtExceptionMonitor", (error) => problems.push(error.message));
const h = await makeTestHub({ configOverrides: { mediaTools: { launcher: { ...fakeLaunchers(),
  whisperCli: { executable: process.execPath, prefixArgs: [path.join(FIXTURES, "fake-whisper-cli.mjs")] } }, ffmpeg: null, ffprobe: null } } });
const { hub } = h;
const sourceDir = tempDir("shutdown-consumer-source");
const entered = deferred(), release = deferred();
let closing;
try {
  if (mode.startsWith("transcribe")) {
    const file = path.join(sourceDir, mode === "transcribe-extract" ? "input.mp4" : "input.mp3");
    fs.writeFileSync(file, mode === "transcribe-extract"
      ? Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(2048)])
      : Buffer.concat([Buffer.from("ID3"), Buffer.from([4, 0, 0, 0, 0, 0, 0]), Buffer.alloc(256, 0x55)]));
    let checks = 0;
    const extract = makeFfmpegExtractor(hub.media.tools);
    const transcriber = createMediaTranscriber({ db: hub.db, bus: hub.bus, config: h.config, settings: hub.settings,
      supervisor: hub.supervisor, tools: hub.media.tools,
      extractAudio: async (...args) => { entered.resolve(); await release.promise; return extract(...args); },
      voiceEngine: { verifyIntegrity: async () => {
        if (++checks === 2) { entered.resolve(); await release.promise; }
        return { ok: true, fixture: true };
      }, activity: () => ({ running: false, pending: 0 }), paths: { stt: path.join(h.dataDir, "synthetic-placeholder") } } });
    // Same consumption as media-commands: the returned .done is deliberately never handled.
    const transcript = (await transcriber.start({ absPath: file, allowedRoots: [sourceDir], actor: "test", channel: "test" })).transcript;
    await entered.promise;
    const factoryClose = hub.factory.close;
    hub.factory.close = async () => {
      release.resolve();
      await waitFor(() => !transcriber.status().running, 5000);
      assert.equal(transcriber.get(transcript.id).status, "running");
      assert.equal(transcriber.get(transcript.id).error, null);
      transcriber.recover();
      assert.match(transcriber.get(transcript.id).error, /^INTERRUPTED:/);
      return factoryClose();
    };
    closing = hub.close();
    await closing;
  } else {
    // The cancellation consumer must await both a launch refusal and a late DB read failure.
    const executors = createExecutors({ settings: hub.settings, media: { render: {
      request: () => ({ id: "synthetic-render" }), get: () => ({ status: "RUNNING" }),
      cancel: async () => {
        entered.resolve(); await release.promise;
        if (mode === "ops-shutdown") throw new HubError("policy", "shutdown fixture", { code: "HUB_SHUTDOWN" });
        return hub.db.prepare("SELECT 1").get();
      },
    } } });
    const controller = new AbortController(); controller.abort("test stop");
    const outcome = executors["media.render"].run({ params: { editVersionId: "synthetic-edit" }, planId: "synthetic-plan",
      abort: controller.signal, authorize: () => {} }).then(() => ({ unexpected: true }), (error) => error);
    await entered.promise;
    closing = hub.close(); await closing;
    release.resolve();
    const error = await outcome;
    if (mode === "ops-shutdown") assert.equal(error.code, "HUB_SHUTDOWN");
    else assert.match(error.message, /database.*not open/i);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.deepEqual(problems, []);
  assert.throws(() => hub.db.prepare("SELECT 1"), /database.*not open/i, "hub.close reached DB close");
  console.log(`SHUTDOWN_CONSUMER_OK ${mode}`);
} finally {
  release.resolve();
  if (closing) await closing;
  await h.cleanup();
  fs.rmSync(sourceDir, { recursive: true, force: true });
}
