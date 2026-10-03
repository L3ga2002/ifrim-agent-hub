import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { PassThrough } from "node:stream";
import { tempDir, makeProject } from "./helpers.mjs";
import { createTarReader, tarEntry, tarEnd, writeTar, BLOCK } from "../server/environments/tar.mjs";
import { validateExport, normalizeExportName, applyChanges, selectTransferFiles, stageExportFile, safeTarget, transferStream, ignoreCandidates } from "../server/environments/workspace.mjs";
import { gitListFiles, gitState, gitCheckIgnored } from "../server/tools/git.mjs";
import { takeGitSnapshot } from "../server/factory/snapshot.mjs";

// M05 §15–§17 (T06–T09, T19): the transfer selection, the strict tar reader, the C14 export validator and the apply step,
// with hand-made hostile archives (names a Linux file system cannot even hold) and real files on Windows.
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const made = [];
const scratch = (label) => { const d = tempDir(label); made.push(d); return d; };
test.afterEach(() => { for (const d of made.splice(0)) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* held */ } } });

/** Reads hand-made tar parts through the reader + staging exactly like collectExport does. */
function readParts(parts, { baseline = {}, limits } = {}) {
  const stagingDir = scratch("staging");
  const staged = {};
  const reader = createTarReader({ ...(limits ? { limits } : {}), onFile: stageExportFile({ stagingDir, baseline, staged }) });
  const buf = Buffer.concat(parts);
  // Feed in odd-sized chunks: the reader must not depend on block-aligned input.
  for (let i = 0; i < buf.length; i += 777) reader.push(buf.subarray(i, i + 777));
  return { read: reader.end(), staged, stagingDir };
}
const file = (name, text, extra = {}) => tarEntry({ name, data: Buffer.from(text), ...extra });
const base = (entries) => Object.fromEntries(Object.entries(entries).map(([rel, text]) => [rel, { sha256: sha(Buffer.from(text)), size: Buffer.byteLength(text), mode: 0o644 }]));

test("M05-EXP-01 names that would escape or misbehave on Windows are refused one by one (T07)", () => {
  const cases = [["/etc/passwd", /absolută/], ["../x.js", /\.\./], ["src/../../x.js", /\.\./], ["a\\b.txt", /backslash/], ["C:/x.txt", /„:”/], ["a:b.txt", /„:”/],
    ["con", /rezervat/], ["src/aux.js", /rezervat/], ["COM1.txt", /rezervat/], ["x.", /punct sau spațiu/], ["x ", /punct sau spațiu/], ["a//b", /segment gol/],
    ["a\u0001b", /control/], ["<script>.js", /interzis/], [`${"a".repeat(256)}.txt`, /255 octeți/]];
  for (const [name, why] of cases) {
    const n = normalizeExportName(name);
    assert.ok(n.problem && why.test(n.problem), `${JSON.stringify(name)} → ${JSON.stringify(n)}`);
  }
  assert.deepEqual(normalizeExportName("./src/ok file ăîș.js"), { rel: "src/ok file ăîș.js" });
  assert.deepEqual(normalizeExportName("./"), { root: true });
});

test("M05-EXP-02 the validator refuses every non-regular entry, protected path and collision; a clean archive is accepted (T07)", () => {
  const baseline = base({ "README.md": "# r\n", "src/app.js": "a\n", "test/acceptance.test.mjs": "t\n", "AGENTS.md": "x\n" });
  const parts = [
    tarEntry({ name: "./", type: "5" }),
    file("./README.md", "# r\n"), file("./src/app.js", "b\n"), file("./test/acceptance.test.mjs", "changed\n"), file("./AGENTS.md", "x\n"),
    tarEntry({ name: "./link", type: "2", linkname: "/etc/passwd" }), tarEntry({ name: "./hard", type: "1", linkname: "./src/app.js" }),
    tarEntry({ name: "./dev", type: "3" }), tarEntry({ name: "./fifo", type: "6" }),
    file("./.env", "SECRET=1\n"), file("./.git/config", "[core]\n"), file("./.ifrim/private/x", "p\n"), file("./.codex/config.toml", "x\n"), file("./CLAUDE.md", "c\n"),
    file("./Readme.md", "dup\n"), file("./x.txt", "1\n"), file("./x.txt/inner", "2\n"),
    file("./caf\u00e9.txt", "nfc\n"), file("./cafe\u0301.txt", "nfd\n"),
    tarEntry({ name: "./tool.exe", data: Buffer.from([0x4d, 0x5a, 0, 1]) }),
    tarEntry({ name: "./node_modules/x/index.js", data: Buffer.from("ignored\n") }),
    tarEnd(),
  ];
  const { read, staged } = readParts(parts, { baseline });
  const v = validateExport({ read, baseline, staged, protectedPaths: ["test/acceptance.test.mjs"] });
  assert.equal(v.ok, false);
  const why = (p) => v.refused.filter((r) => r.path === p).map((r) => r.reason).join(" | ");
  assert.match(why("test/acceptance.test.mjs"), /test de acceptanță protejat/);
  assert.match(why("link"), /symlink/); assert.match(why("hard"), /hardlink/); assert.match(why("dev"), /chardev/); assert.match(why("fifo"), /fifo/);
  assert.match(why(".env"), /protejat/);
  // .git inside the workspace (a writer may run git init) is ignored like a build folder: counted, never applied.
  assert.ok(!v.changes.some((c) => c.path.startsWith(".git/")) && !why(".git/config")); assert.match(why(".ifrim/private/x"), /control|Hub/); assert.match(why(".codex/config.toml"), /control|configurație de agent/);
  assert.match(why("CLAUDE.md"), /control/);
  assert.match(why("Readme.md"), /majuscule/);
  assert.match(why("x.txt/inner"), /sub un fișier/);
  assert.ok(why("cafe\u0301.txt") || why("caf\u00e9.txt"), "Unicode normalization collision refused");
  assert.match(why("tool.exe"), /binar/);
  assert.equal(v.stats.ignoredRegenerable, 2, "node_modules and .git output are ignored, not applied");

  // The same project with only allowed changes passes, with an explicit deletion.
  const clean = readParts([file("./README.md", "# r\n"), file("./src/app.js", "b\n"), file("./test/acceptance.test.mjs", "t\n"), file("./AGENTS.md", "x\n"),
    file("./docs/nou fișier.md", "ăîșț\r\n"), tarEntry({ name: "./img/a.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]) }), tarEnd()], { baseline });
  const ok = validateExport({ read: clean.read, baseline, staged: clean.staged, protectedPaths: ["test/acceptance.test.mjs"] });
  assert.equal(ok.ok, true, JSON.stringify(ok.refused));
  assert.deepEqual(ok.changes.map((c) => `${c.status}:${c.path}`).sort(), ["added:docs/nou fișier.md", "added:img/a.png", "modified:src/app.js"]);
  const gone = readParts([file("./README.md", "# r\n"), file("./test/acceptance.test.mjs", "t\n"), file("./AGENTS.md", "x\n"), tarEnd()], { baseline });
  const del = validateExport({ read: gone.read, baseline, staged: gone.staged, protectedPaths: ["test/acceptance.test.mjs"] });
  assert.deepEqual(del.changes.map((c) => `${c.status}:${c.path}`), ["deleted:src/app.js"]);
});

test("M05-EXP-03 the reader stops on what would make the rest ambiguous: checksum, global pax, long names, sizes, truncation, limits (T07)", () => {
  const ok = file("./a.txt", "a\n");
  const corrupt = Buffer.from(ok); corrupt[0] ^= 0xff;
  const longName = tarEntry({ name: "./x", type: "L", data: Buffer.alloc(0) });
  const symlinkWithSize = Buffer.from(tarEntry({ name: "./s", type: "0", data: Buffer.from("abc") }));
  symlinkWithSize[156] = "2".charCodeAt(0);
  // fix the checksum of the edited header
  let sum = 0; for (let i = 0; i < BLOCK; i += 1) sum += i >= 148 && i < 156 ? 0x20 : symlinkWithSize[i];
  Buffer.from(`${sum.toString(8).padStart(6, "0")}\0 `).copy(symlinkWithSize, 148);
  const cases = [
    [[corrupt, tarEnd()], /checksum/],
    [[tarEntry({ name: "./g", type: "g", data: Buffer.alloc(0) }), tarEnd()], /pax-global|nesuportat/],
    [[longName, tarEnd()], /nesuportat/],
    [[symlinkWithSize, tarEnd()], /mărime nenulă/],
    [[tarEntry({ name: "./p", pax: { size: "-5" } }), tarEnd()], /mărime pax invalidă/],
    [[ok], /trunchiată|terminat fără/],
  ];
  for (const [parts, why] of cases) {
    const { read } = readParts(parts);
    assert.equal(read.complete, false);
    assert.ok(read.problems.some((p) => why.test(p)), `${why} in ${JSON.stringify(read.problems)}`);
  }
  const many = readParts([...Array.from({ length: 6 }, (_, i) => file(`./f${i}`, "x")), tarEnd()], { limits: { maxEntries: 5, maxFileBytes: 1024, maxTotalBytes: 1 << 20, maxPaxBytes: 4096 } });
  assert.ok(many.read.aborted && /intrări/.test(many.read.aborted));
  const big = readParts([file("./big.bin", "x".repeat(5000)), tarEnd()], { limits: { maxEntries: 10, maxFileBytes: 1024, maxTotalBytes: 1 << 20, maxPaxBytes: 4096 } });
  assert.ok(big.read.entries[0].problems.some((p) => /peste limita/.test(p)));
  const v = validateExport({ read: big.read, baseline: {}, staged: big.staged });
  assert.ok(v.refused.some((r) => r.path === "big.bin"));
});

test("M05-EXP-04 apply: human edits are conflicts (nothing written), links are never followed, a failure rolls back (T08)", () => {
  const root = scratch("apply");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "a.js"), "base a\n");
  fs.writeFileSync(path.join(root, "src", "b.js"), "base b\n");
  const stagingDir = scratch("apply-staging");
  const blob = (text) => { const b = Buffer.from(text); fs.mkdirSync(path.join(stagingDir, "blobs"), { recursive: true }); fs.writeFileSync(path.join(stagingDir, "blobs", sha(b)), b); return { sha256: sha(b), size: b.length }; };
  const mod = (p, before, after) => ({ path: p, status: "modified", before: { sha256: sha(Buffer.from(before)), size: before.length }, after: blob(after) });
  // A human edited src/a.js after the transfer.
  fs.writeFileSync(path.join(root, "src", "a.js"), "human edit\n");
  const conflict = applyChanges({ projectRoot: root, stagingDir, changes: [mod("src/a.js", "base a\n", "writer a\n"), mod("src/b.js", "base b\n", "writer b\n")] });
  assert.equal(conflict.applied, 0);
  assert.match(conflict.conflicts[0].reason, /modificat în proiect după transfer/);
  assert.equal(fs.readFileSync(path.join(root, "src", "b.js"), "utf8"), "base b\n", "nothing written when any path conflicts");
  assert.equal(fs.readFileSync(path.join(root, "src", "a.js"), "utf8"), "human edit\n");
  // An added file that appeared meanwhile, and a different-case twin.
  fs.writeFileSync(path.join(root, "README.md"), "x\n");
  const added = applyChanges({ projectRoot: root, stagingDir, changes: [{ path: "Readme.md", status: "added", before: null, after: blob("y\n") }] });
  assert.equal(added.applied, 0);
  // A junction inside the project pointing outside: never written through.
  const outside = scratch("outside");
  fs.symlinkSync(outside, path.join(root, "linked"), "junction");
  assert.throws(() => safeTarget(fs.realpathSync.native(root), "linked/x.js"), /legătură|junction/);
  const viaLink = applyChanges({ projectRoot: root, stagingDir, changes: [{ path: "linked/x.js", status: "added", before: null, after: blob("z\n") }] });
  assert.equal(viaLink.applied, 0);
  assert.equal(fs.readdirSync(outside).length, 0);
  // Rollback: the second write fails (its staged content is missing) → the first is restored.
  fs.writeFileSync(path.join(root, "src", "a.js"), "base a\n");
  const missing = { path: "src/new.js", status: "added", before: null, after: { sha256: "0".repeat(64), size: 3 } };
  const rolled = applyChanges({ projectRoot: root, stagingDir, changes: [mod("src/a.js", "base a\n", "writer a\n"), missing] });
  assert.equal(rolled.rolledBack, true);
  assert.equal(fs.readFileSync(path.join(root, "src", "a.js"), "utf8"), "base a\n");
  assert.equal(fs.existsSync(path.join(root, "src", "new.js")), false);
  // And a clean apply writes exactly the validated bytes (CRLF and diacritics kept).
  const good = applyChanges({ projectRoot: root, stagingDir, changes: [mod("src/a.js", "base a\n", "writer a\r\n"), { path: "docs/nouă pagină.md", status: "added", before: null, after: blob("ăîșț\r\n") }] });
  assert.equal(good.applied, 2);
  assert.equal(fs.readFileSync(path.join(root, "src", "a.js"), "utf8"), "writer a\r\n");
  assert.equal(fs.readFileSync(path.join(root, "docs", "nouă pagină.md"), "utf8"), "ăîșț\r\n");
});

test("M05-EXP-05 transfer selection keeps uncommitted work, excludes private and secret data, and never touches the index (T06)", async () => {
  const root = makeProject(scratch("transfer"));
  fs.writeFileSync(path.join(root, "README.md"), "# modificat necomis\n");
  fs.writeFileSync(path.join(root, "new.js"), "untracked\n");
  fs.writeFileSync(path.join(root, ".gitignore"), "ignored.txt\n");
  fs.writeFileSync(path.join(root, "ignored.txt"), "gitignored\n");
  fs.writeFileSync(path.join(root, ".env"), "SECRET=1\n");
  fs.writeFileSync(path.join(root, "server.pem"), "key\n");
  for (const [rel, text] of [[".ifrim/private/data.sqlite", "db"], ["node_modules/x/i.js", "dep"], [".codex/config.toml", "x"], [".claude/settings.json", "{}"]]) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  const statusBefore = execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" });
  const selection = await selectTransferFiles(root);
  const rels = selection.files.map((f) => f.rel).sort();
  assert.deepEqual(rels, [".gitignore", "README.md", "new.js", "src/app.js"]);
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" }), statusBefore, "the index and working tree are untouched");
  // What is sent is what is recorded: the uncommitted README content.
  const manifest = {};
  const out = new PassThrough();
  const chunks = [];
  out.on("data", (c) => chunks.push(c));
  await writeTar(out, transferStream(selection, manifest));
  assert.equal(manifest["README.md"].sha256, sha(Buffer.from("# modificat necomis\n")));
  const { read } = readParts([Buffer.concat(chunks)]);
  assert.deepEqual(read.entries.map((e) => e.rawName).sort(), rels);
});

test("M05-EXP-06 no program from the repository's config runs while the Hub reads git (fsmonitor) (T09)", async () => {
  const root = makeProject(scratch("fsmonitor"));
  const marker = path.join(root, "FSMONITOR_RAN");
  const fwd = (p) => p.split(path.sep).join("/");
  const script = path.join(root, "hook.cjs");
  fs.writeFileSync(script, `require("fs").writeFileSync(${JSON.stringify(marker)}, "ran"); process.exit(1);\n`);
  // A repository can name any program as its fsmonitor; git runs it for status with the caller's rights (measured: yes,
  // from Node on this machine, for a "node.exe script" command).
  execFileSync("git", ["-C", root, "config", "core.fsmonitor", `"${fwd(process.execPath)}" "${fwd(script)}"`]);
  // Control: a plain git status runs it — so the check below is a real one.
  try { execFileSync("git", ["-C", root, "status", "--porcelain"], { stdio: "ignore" }); } catch { /* the hook exits 1 */ }
  const controlRan = fs.existsSync(marker);
  assert.equal(controlRan, true, "control: without the Hub's override git runs the repository's fsmonitor program");
  fs.rmSync(marker, { force: true });
  await gitListFiles(root);
  await gitState(root);
  takeGitSnapshot(root, {});
  assert.equal(fs.existsSync(marker), false, `the Hub's git reads never ran core.fsmonitor (control run: ${controlRan})`);
});

test("M05-EXP-07 tar round trip keeps names (spaces, diacritics, long paths) and bytes (CRLF, binary) exactly (T19)", async () => {
  const files = [
    { name: "docs/notă cu spații.md", data: Buffer.from("linia 1\r\nlinia 2\r\n") },
    { name: `${"adânc/".repeat(20)}fișier.txt`, data: Buffer.from("deep\n") },
    { name: "img/logo.png", data: crypto.randomBytes(3000) },
    { name: "gol.txt", data: Buffer.alloc(0) },
  ];
  const out = new PassThrough();
  const chunks = [];
  out.on("data", (c) => chunks.push(c));
  await writeTar(out, (async function* g() { for (const f of files) yield f; })());
  const seen = {};
  const reader = createTarReader({ onFile: (entry, data) => { seen[entry.rawName] = sha(data); } });
  reader.push(Buffer.concat(chunks));
  const read = reader.end();
  assert.equal(read.complete, true, JSON.stringify(read.problems));
  for (const f of files) assert.equal(seen[f.name], sha(f.data), f.name);
});

/**
 * Runs `fn` with git's per-user configuration pointed at an empty folder, so a global excludes file on the machine running the
 * tests cannot change what the project's ignore rules leave out (the Hub's git child gets HOME/USERPROFILE from the allowlist).
 */
async function withIsolatedGitHome(fn) {
  const home = scratch("git-home");
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
const SQLITE = Buffer.concat([Buffer.from("SQLite format 3\0"), crypto.randomBytes(64)]);

test("M07-EXP-08 new BINARY files the project's ignore rules exclude (a test database under data/) are left out and listed; text files and every other check stay as before", async () => {
  // Found live (M07 D6): the project's tests left data/*.sqlite in the copy and the whole export was refused as "binary".
  await withIsolatedGitHome(async () => {
    const project = makeProject(scratch("ignore"));
    fs.writeFileSync(path.join(project, ".gitignore"), "data/\n*.log\n");
    const baseline = base({ "README.md": "# Fixture project\n", "src/app.js": "export const answer = 42;\n", ".gitignore": "data/\n*.log\n" });
    const collect = async (extra, { gitignore = "data/\n*.log\n" } = {}) => {
      const parts = [file("./README.md", "# Fixture project\n"), file("./src/app.js", "export const answer = 43;\n"), file("./.gitignore", gitignore),
        tarEntry({ name: "./data/persist-1.sqlite", data: SQLITE }), file("./data/notes.txt", "runtime\n"), file("./server.log", "log\n"), ...extra, tarEnd()];
      const { read, staged } = readParts(parts, { baseline });
      // Exactly like collectExport: the candidates are binary non-asset files only, asked of the project on Windows.
      const candidates = ignoreCandidates({ read, baseline, staged });
      const rules = await gitCheckIgnored(project, candidates);
      return { v: validateExport({ read, baseline, staged, projectIgnored: rules.ignored }), candidates, rules };
    };
    const clean = await collect([]);
    assert.equal(clean.v.ok, true, JSON.stringify(clean.v.refused));
    assert.deepEqual(clean.candidates, ["data/persist-1.sqlite"], "text files are never asked: they keep their normal path");
    assert.equal(clean.rules.error, null);
    assert.deepEqual(clean.v.changes.map((c) => `${c.status}:${c.path}`), ["added:data/notes.txt", "added:server.log", "modified:src/app.js"], "text files in ignored folders are applied as before M07");
    assert.equal(clean.v.stats.ignoredByProject, 1);
    assert.deepEqual(clean.v.stats.ignoredByProjectFiles, ["data/persist-1.sqlite"]);

    // Ignored by the project is not a pass for anything else: control names, secret-like files, links, assets and other binaries.
    const hostile = await collect([file("./data/CLAUDE.md", "x\n"), file("./data/.env.local", "K=1\n"), tarEntry({ name: "./data/link", type: "2", linkname: "/etc/passwd" }),
      tarEntry({ name: "./tool.exe", data: Buffer.from([0x4d, 0x5a, 0, 1]) }), tarEntry({ name: "./[d]ata/x.sqlite", data: SQLITE })]);
    assert.equal(hostile.v.ok, false);
    const why = (p) => hostile.v.refused.filter((r) => r.path === p).map((r) => r.reason).join(" | ");
    assert.match(why("data/CLAUDE.md"), /control/);
    assert.match(why("data/.env.local"), /protejat/);
    assert.match(why("data/link"), /symlink/);
    assert.match(why("tool.exe"), /binar/);
    assert.ok(!hostile.candidates.includes("[d]ata/x.sqlite"), "a name with glob characters is never asked of git");
    assert.match(why("[d]ata/x.sqlite"), /binar/, "so it keeps the normal refusal");

    // The rules come from the project on Windows, never from the copy: a .gitignore the writer edits in the copy changes nothing.
    const edited = await collect([tarEntry({ name: "./src/blob.bin", data: SQLITE })], { gitignore: "data/\n*.log\nsrc/\n" });
    assert.match(edited.v.refused.map((r) => `${r.path}: ${r.reason}`).join(" "), /src\/blob\.bin: fișier binar/);
    assert.ok(!edited.v.stats.ignoredByProjectFiles.includes("src/blob.bin"));
  });
});

test("M07-EXP-09 the validator leaves out only what is eligible, whatever set it is given; git failures leave nothing out and are reported", async () => {
  // A hand-made set (another caller, a future source): guarded, control, secret-like, text and baseline files are never left out.
  const baseline = base({ "src/app.js": "a\n" });
  const parts = [file("./src/app.js", "a\n"), file("./data/CLAUDE.md", "x\n"), file("./data/.env.local", "K=1\n"), file("./data/notes.txt", "n\n"), tarEntry({ name: "./data/x.sqlite", data: SQLITE }),
    tarEntry({ name: "./img/logo.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]) }), tarEnd()];
  const { read, staged } = readParts(parts, { baseline });
  const v = validateExport({ read, baseline, staged, projectIgnored: new Set(["data/CLAUDE.md", "data/.env.local", "data/notes.txt", "data/x.sqlite", "img/logo.png", "src/app.js"]) });
  const why = (p) => v.refused.filter((r) => r.path === p).map((r) => r.reason).join(" | ");
  assert.match(why("data/CLAUDE.md"), /control/);
  assert.match(why("data/.env.local"), /protejat/);
  assert.deepEqual(v.stats.ignoredByProjectFiles, ["data/x.sqlite"]);
  assert.deepEqual(v.changes.map((c) => `${c.status}:${c.path}`).sort(), ["added:data/notes.txt", "added:img/logo.png"], "text and asset files take the normal path");

  // Binary files that were SENT IN (baseline) are never left out — a left-out baseline file would read as a deletion — and binary
  // control, secret-like or shell-active names are refused, not left out, whatever the set says (M07 review round 2).
  const SQL = Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.alloc(32, 1)]);
  const binBase = { "src/app.js": { sha256: sha(Buffer.from("a\n")), size: 2, mode: 0o644 }, "data/seed.sqlite": { sha256: sha(SQL), size: SQL.length, mode: 0o644 }, "data/kept.sqlite": { sha256: sha(SQL), size: SQL.length, mode: 0o644 } };
  const changedSql = Buffer.concat([SQL, Buffer.from([9, 9])]);
  const b = readParts([file("./src/app.js", "a\n"), tarEntry({ name: "./data/seed.sqlite", data: changedSql }), tarEntry({ name: "./data/kept.sqlite", data: SQL }),
    tarEntry({ name: "./data/.env.local", data: SQL }), tarEntry({ name: "./data/server.key", data: SQL }), tarEntry({ name: "./data/desktop.ini", data: SQL }), tarEntry({ name: "./data/x.lnk", data: SQL }), tarEnd()], { baseline: binBase });
  const bv = validateExport({ read: b.read, baseline: binBase, staged: b.staged, projectIgnored: new Set(["data/seed.sqlite", "data/kept.sqlite", "data/.env.local", "data/server.key", "data/desktop.ini", "data/x.lnk"]) });
  const bwhy = (p) => bv.refused.filter((r) => r.path === p).map((r) => r.reason).join(" | ");
  assert.equal(bv.stats.ignoredByProject, 0, "nothing of these is left out");
  assert.match(bwhy("data/seed.sqlite"), /binar/, "a changed sent-in binary keeps the binary refusal");
  assert.ok(!bv.changes.some((c) => c.status === "deleted"), "no left-out file ever reads as a deletion");
  assert.ok(!bv.changes.some((c) => c.path === "data/kept.sqlite"), "an unchanged sent-in binary is no change");
  for (const p of ["data/.env.local", "data/server.key", "data/desktop.ini", "data/x.lnk"]) assert.ok(bwhy(p), `${p} refused`);

  // A pathspec git refuses for the whole batch (a file inside a registered submodule): nothing is left out, and the error is named.
  await withIsolatedGitHome(async () => {
    const project = makeProject(scratch("submodule"));
    fs.writeFileSync(path.join(project, ".gitignore"), "data/\n");
    execFileSync("git", ["-C", project, "update-index", "--add", "--cacheinfo", `160000,${"a".repeat(40)},sub`], { stdio: "pipe" });
    const r = await gitCheckIgnored(project, ["sub/new.bin", "data/x.sqlite"]);
    assert.equal(r.ignored.size, 0);
    assert.match(String(r.error), /check-ignore a ieșit cu 128/);
    const ok = await gitCheckIgnored(project, ["data/x.sqlite"]);
    assert.deepEqual([...ok.ignored], ["data/x.sqlite"]);
    assert.equal(ok.error, null);
    // Not a repository root (a folder inside another repository): never asked, nothing ignored, and the evidence says why.
    const plain = scratch("plain");
    const noRepo = await gitCheckIgnored(plain, ["data/x.sqlite"]);
    assert.equal(noRepo.ignored.size, 0);
    assert.match(String(noRepo.error), /nu are un depozit git propriu/);
    assert.deepEqual(await gitCheckIgnored(plain, []), { ignored: new Set(), error: null }, "no candidate, nothing to say");
  });
});
