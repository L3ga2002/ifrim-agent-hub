import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { PassThrough } from "node:stream";
import { tempDir, makeProject } from "./helpers.mjs";
import { createTarReader, tarEntry, tarEnd, writeTar, BLOCK } from "../server/environments/tar.mjs";
import { validateExport, normalizeExportName, applyChanges, selectTransferFiles, stageExportFile, safeTarget, transferStream } from "../server/environments/workspace.mjs";
import { gitListFiles, gitState } from "../server/tools/git.mjs";
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
