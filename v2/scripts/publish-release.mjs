// 2.20 — publishes the version in this checkout as a RELEASE for the installed Hubs (update channel, ops/updates.mjs).
// Run by the repository's owner, in the Hub folder, after the version was validated (gate green, live check done):
//   node v2/scripts/publish-release.mjs            → checks and prints what it would do (nothing changes)
//   node v2/scripts/publish-release.mjs --tag      → creates the annotated tag hub-release/<version> on HEAD (local only)
// Then the owner pushes the tag himself:  git push origin hub-release/<version>
// Checks: a clean working tree, HEAD on the release branch (v2-milestone-01 unless --branch), HEAD already on origin (a release
// never points at a commit the testers cannot fetch), a version newer than every published release, the tag not taken.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const branch = argv.includes("--branch") ? argv[argv.indexOf("--branch") + 1] : "v2-milestone-01";
const git = (...args) => { const r = spawnSync("git", ["-c", "core.fsmonitor=false", ...args], { cwd: ROOT, encoding: "utf8", windowsHide: true }); return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() }; };
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };
const version = (/export const HUB_VERSION = "([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, "v2", "server", "config.mjs"), "utf8")) || [])[1];
const num = (v) => (/^(\d+)\.(\d+)\.(\d+)/.exec(v || "") || []).slice(1).map(Number);
const newer = (a, b) => { const x = num(a); const y = num(b); for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

if (!version || num(version).length !== 3) fail(`HUB_VERSION nu este o versiune (${version})`);
const tag = `hub-release/${version}`;
if (git("status", "--porcelain", "--untracked-files=no").out) fail("Există fișiere modificate necomise: un release trebuie să fie exact un commit.");
const current = git("symbolic-ref", "-q", "--short", "HEAD").out;
if (current !== branch) fail(`HEAD este pe ${current || "(detached)"}, nu pe ${branch}.`);
const head = git("rev-parse", "HEAD").out;
git("fetch", "--quiet", "origin", branch);
if (!git("merge-base", "--is-ancestor", head, `origin/${branch}`).ok) fail(`Commit-ul ${head.slice(0, 12)} nu este încă pe origin/${branch}: rulează întâi git push origin ${branch}.`);
const remote = git("ls-remote", "--tags", "--refs", "origin", "refs/tags/hub-release/*");
if (!remote.ok) fail(`Nu pot citi tag-urile de pe origin: ${remote.err.slice(0, 200)}`);
const published = remote.out.split(/\r?\n/).map((l) => l.split("refs/tags/hub-release/")[1]).filter(Boolean);
if (published.includes(version)) fail(`${tag} este deja publicat.`);
const latest = published.sort((a, b) => (newer(a, b) ? 1 : newer(b, a) ? -1 : 0)).at(-1) || null;
if (latest && !newer(version, latest)) fail(`Versiunea ${version} nu este mai nouă decât ultima publicată (${latest}): mărește HUB_VERSION.`);
if (git("rev-parse", "-q", "--verify", `refs/tags/${tag}`).ok) fail(`Tag-ul ${tag} există deja local (git tag -d ${tag} dacă vrei să-l refaci).`);

console.log(`Versiune: ${version}\nCommit: ${head}\nUltima publicată: ${latest || "niciuna"}\nTag: ${tag}`);
if (!argv.includes("--tag")) { console.log("\nNimic nu s-a schimbat. Rulează cu --tag ca să creezi tag-ul local."); process.exit(0); }
const made = git("tag", "-a", tag, "-m", `Ifrim Agent Hub ${version} (release pentru instalările de test)`, head);
if (!made.ok) fail(`git tag a eșuat: ${made.err}`);
console.log(`\n✓ Tag creat local. Publică-l (doar tu):\n  git push origin ${tag}\nHub-urile instalate îl văd la următoarea verificare (zilnic sau „Verifică acum”).`);
