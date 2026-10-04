#!/usr/bin/env node
// M09 test-mode proxy for the REAL media tools. The Hub supervisor spawns only node or files under tests/fixtures in test mode,
// so media tests run the real ffmpeg / ffprobe / whisper-cli through this script: it starts the binary named by IFRIM_REAL_TOOL
// (an absolute path chosen by the test helper) with the same argv and cwd, no shell, streaming stdio and the exit code.
// Exit 127 when the binary is absent (the tests then report SKIPPED_ENV instead of passing).
import { spawn } from "node:child_process";
import fs from "node:fs";

const tool = process.env.IFRIM_REAL_TOOL;
if (!tool || !fs.existsSync(tool)) {
  process.stderr.write("REAL_TOOL_MISSING\n");
  process.exit(127);
}
const child = spawn(tool, process.argv.slice(2), { stdio: "inherit", windowsHide: true, shell: false });
const forward = (signal) => { try { child.kill(signal); } catch { /* already gone */ } };
process.on("SIGTERM", () => forward("SIGTERM"));
process.on("SIGINT", () => forward("SIGINT"));
child.on("error", (error) => { process.stderr.write(`REAL_TOOL_ERROR ${error.message}\n`); process.exit(126); });
child.on("close", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
