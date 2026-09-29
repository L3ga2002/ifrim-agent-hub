import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

test("Hub backup ZIP excludes BACKUPS, private runtime and .env files", { skip: process.platform !== "win32" }, async (t) => {
  const source = await fs.readFile(new URL("../apps/api/src/server.mjs", import.meta.url), "utf8");
  const marker = "const script = String.raw`";
  const start = source.indexOf(marker);
  assert.ok(start >= 0, "backup script must remain present");
  const end = source.indexOf("`;", start + marker.length);
  assert.ok(end > start, "backup script must have a closing delimiter");
  const backupScript = source.slice(start + marker.length, end);

  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "hub-backup-filter-test-"));
  t.after(async () => {
    assert.equal(path.dirname(fixture), path.resolve(os.tmpdir()));
    assert.ok(path.basename(fixture).startsWith("hub-backup-filter-test-"));
    await fs.rm(fixture, { recursive: true, force: true });
  });
  const project = path.join(fixture, "project");
  const backups = path.join(project, ".ifrim", "BACKUPS");
  const privateRuntime = path.join(project, ".ifrim", "private");
  await fs.mkdir(backups, { recursive: true });
  await fs.mkdir(privateRuntime, { recursive: true });
  await fs.mkdir(path.join(project, ".ifrim", "private-not"), { recursive: true });
  await fs.mkdir(path.join(project, ".ifrim", "BACKUPS-not"), { recursive: true });
  await fs.mkdir(path.join(project, "src"), { recursive: true });
  await fs.writeFile(path.join(project, "ordinary.txt"), "ordinary canary");
  await fs.writeFile(path.join(project, "src", "module.txt"), "nested ordinary canary");
  await fs.writeFile(path.join(backups, "prior.zip"), "backup canary");
  await fs.writeFile(path.join(privateRuntime, "agent-hub.sqlite"), "private canary");
  await fs.writeFile(path.join(project, ".ifrim", "private-not", "keep.txt"), "ordinary canary");
  await fs.writeFile(path.join(project, ".ifrim", "BACKUPS-not", "keep.txt"), "ordinary canary");
  await fs.writeFile(path.join(project, ".env"), "env canary");
  await fs.writeFile(path.join(project, "src", ".env.local"), "nested env canary");
  let fileSymlinkCreated = false;
  try {
    await fs.symlink(path.join(privateRuntime, "agent-hub.sqlite"), path.join(project, "src", "private-link.sqlite"), "file");
    fileSymlinkCreated = true;
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) throw error;
    t.diagnostic(`file symlink canary unavailable: ${error.code}`);
  }

  const archive = path.join(backups, "fixture.zip");
  const manifestPath = path.join(backups, "fixture.manifest.json");
  await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", backupScript], {
    env: { ...process.env, IFRIM_BACKUP_SOURCE: project, IFRIM_BACKUP_DEST: archive,
      IFRIM_BACKUP_MANIFEST: manifestPath, IFRIM_BACKUP_EXCLUDE_PRIVATE: "1" },
    windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
  });

  const listScript = "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; "
    + "$zip = [System.IO.Compression.ZipFile]::OpenRead($env:IFRIM_TEST_ARCHIVE); "
    + "try { @($zip.Entries | ForEach-Object { $_.FullName }) | ConvertTo-Json -Compress } finally { $zip.Dispose() }";
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-Command", listScript], {
    env: { ...process.env, IFRIM_TEST_ARCHIVE: archive }, windowsHide: true, timeout: 10000,
  });
  const entries = JSON.parse(stdout.trim());
  assert.deepEqual([...entries].sort(), [".ifrim/BACKUPS-not/keep.txt", ".ifrim/private-not/keep.txt", "ordinary.txt", "src/module.txt"]);
  if (fileSymlinkCreated) assert.ok(!entries.includes("src/private-link.sqlite"));

  const manifest = JSON.parse((await fs.readFile(manifestPath, "utf8")).replace(/^\uFEFF/, ""));
  assert.equal(manifest.fileCount, 4);
  assert.equal(manifest.excludedPrivateRuntime, true);
  assert.deepEqual(manifest.skippedFiles, []);
  assert.ok(manifest.zipBytes > 0);

  const otherArchive = path.join(backups, "other-project.zip");
  const otherManifest = path.join(backups, "other-project.manifest.json");
  await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", backupScript], {
    env: { ...process.env, IFRIM_BACKUP_SOURCE: project, IFRIM_BACKUP_DEST: otherArchive,
      IFRIM_BACKUP_MANIFEST: otherManifest, IFRIM_BACKUP_EXCLUDE_PRIVATE: "0" },
    windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
  });
  const other = JSON.parse((await fs.readFile(otherManifest, "utf8")).replace(/^\uFEFF/, ""));
  assert.equal(other.fileCount, 5, "non-Hub backups must retain private files");
  assert.equal(other.excludedPrivateRuntime, false);
  assert.deepEqual(other.skippedFiles, []);
});
