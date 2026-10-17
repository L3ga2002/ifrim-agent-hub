import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FIXTURES } from "./helpers.mjs";

const exec = promisify(execFile);
for (const mode of ["transcribe-extract", "transcribe-launch", "ops-shutdown", "ops-db-closed"]) {
  test(`round5 production shutdown consumer: ${mode}`, { timeout: 20000 }, async () => {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const { stdout, stderr } = await exec(process.execPath, ["--unhandled-rejections=strict",
      path.join(FIXTURES, "shutdown-consumers.mjs"), mode], { env, windowsHide: true, timeout: 18000 });
    assert.match(stdout, new RegExp(`SHUTDOWN_CONSUMER_OK ${mode}`));
    assert.doesNotMatch(stdout + stderr, /unhandledRejection|uncaughtException|asynchronous activity/);
  });
}
