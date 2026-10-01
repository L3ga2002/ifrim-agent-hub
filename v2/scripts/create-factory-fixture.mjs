// Creates a Software Factory demo project (M03 §25–§27) from v2/fixtures/factory as a sanitized TEST project in the
// projects root, and registers it in the running Hub. Fictive data, no secrets, no network. It never overwrites a folder,
// never edits PROJECTS.md and never touches other projects. Run by the OWNER (it creates a folder outside the Hub repo).
// Usage: node v2/scripts/create-factory-fixture.mjs bug-demo|service-request [--dir ifrim-factory-demo-a] [--port 4610] [--no-register]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PROJECTS_ROOT } from "../server/config.mjs";
import { materializeFixture, FACTORY_DEMOS } from "../server/factory/fixtures.mjs";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback; };
const fixture = process.argv[2];
if (!FACTORY_DEMOS[fixture]) { console.error(`Fixture: ${Object.keys(FACTORY_DEMOS).join(" | ")}`); process.exit(2); }
const DIR_NAME = arg("dir", fixture === "bug-demo" ? "ifrim-factory-demo-a" : "ifrim-factory-demo-b");
if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(DIR_NAME)) { console.error("--dir must be a simple lowercase folder name"); process.exit(2); }
const port = arg("port", null) ? Number(arg("port", null)) : null;
const dir = path.join(PROJECTS_ROOT, DIR_NAME);
const HUB = `http://127.0.0.1:${Number(process.env.HUB_V2_PORT || 8011)}`;

if (fs.existsSync(dir)) { console.error(`REFUSED: ${dir} already exists; nothing was changed.`); process.exit(1); }
materializeFixture(fixture, dir, { port });
// The fixture's own acceptance test fails before the work (that is the point); the unit tests must at least load.
try { execFileSync(process.execPath, ["--check", path.join(dir, fixture === "bug-demo" ? "src/requests.js" : "src/server-app.js")], { stdio: "pipe" }); }
catch { console.error("The fixture source does not parse; removing nothing, please report."); process.exit(1); }
const git = (...args) => execFileSync("git", ["-C", dir, "-c", "user.name=Ifrim Agent Hub (test)", "-c", "user.email=hub-test@example.invalid", "-c", "commit.gpgsign=false", ...args], { stdio: "pipe" });
git("init", "-q", "-b", "main");
fs.appendFileSync(path.join(dir, ".gitignore"), ".ifrim/BACKUPS/\n.ifrim/private/\n.ifrim/tmp/\n.env\n.env.*\n");
git("add", ".");
git("commit", "-q", "-m", `Software Factory demo fixture (${fixture})`);
console.log(`Created ${dir} (fixture ${fixture}, git repo)`);

if (!process.argv.includes("--no-register")) {
  const session = await (await fetch(`${HUB}/api/session`)).json();
  const res = await fetch(`${HUB}/api/projects/test`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Token": session.token }, body: JSON.stringify({ path: dir, name: FACTORY_DEMOS[fixture].name }) });
  const body = await res.json();
  if (!res.ok) { console.error(`Hub refused registration (${res.status}): ${body.error?.message || JSON.stringify(body)}`); process.exit(1); }
  const project = body.result || body;
  console.log(`Registered in the Hub: ${project.name} (${project.id}) · execution allowed: ${project.executionAllowed}`);
}
