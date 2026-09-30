// Creates the sanitized TEST project used for live validation (M02 §29) and registers it in the running Hub.
// It contains no client data and no secrets: a tiny Node.js contact-form validator with tests, its own git repo and
// the marker file that lets the Hub accept it as a test project. It never overwrites an existing directory that is
// not a Hub test project, never edits PROJECTS.md and never touches other projects.
// Usage: node v2/scripts/create-test-project.mjs [--name "Ifrim Hub Test"] [--dir ifrim-hub-live-test] [--no-register]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PROJECTS_ROOT } from "../server/config.mjs";
import { TEST_PROJECT_MARKER } from "../server/domain/projects.mjs";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback; };
const NAME = arg("name", "Ifrim Hub Test");
const DIR_NAME = arg("dir", "ifrim-hub-live-test");
if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(DIR_NAME)) { console.error("--dir must be a simple lowercase folder name"); process.exit(2); }
const dir = path.join(PROJECTS_ROOT, DIR_NAME);
const PORT = Number(process.env.HUB_V2_PORT || 8011);

const FILES = {
  [TEST_PROJECT_MARKER]: JSON.stringify({ createdBy: "ifrim-agent-hub", purpose: "live-validation", name: NAME, stack: "Node.js (node:test)", note: "Proiect sintetic, fără date reale." }, null, 2) + "\n",
  "README.md": `# ${NAME}\n\nProiect de TEST sanitizat pentru validarea live a Ifrim Agent Hub. Nu conține date reale sau secrete.\n\nConține un validator pentru un formular de contact (nume, email, telefon românesc, mesaj) și testele lui.\n\n\`\`\`\nnpm test\n\`\`\`\n`,
  "package.json": JSON.stringify({ name: DIR_NAME, version: "0.1.0", private: true, type: "module", description: "Sanitized test project for Ifrim Agent Hub live validation", scripts: { test: "node --test" } }, null, 2) + "\n",
  // Hub backups (made by the execution gate before each run) and Hub scratch stay out of the test repo.
  ".gitignore": "node_modules/\n.env\n.env.*\n.ifrim/BACKUPS/\n.ifrim/private/\n.ifrim/tmp/\n",
  "src/validate.js": [
    "// Contact form validation used by the demo landing page.",
    "const EMAIL = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/;",
    "// Romanian mobile numbers: 07xx xxx xxx or +40 7xx xxx xxx (spaces and dashes allowed).",
    "const RO_MOBILE = /^(?:\\+40|0)7\\d{8}$/;",
    "",
    "export function normalizePhone(value) {",
    "  return String(value || \"\").replace(/[\\s-]/g, \"\");",
    "}",
    "",
    "/** Returns { ok, errors } where errors maps field names to Romanian messages. */",
    "export function validateContact(form = {}) {",
    "  const errors = {};",
    "  if (!form.name || form.name.length < 2) errors.name = \"Numele trebuie să aibă cel puțin 2 caractere\";",
    "  if (!EMAIL.test(String(form.email || \"\").trim())) errors.email = \"Adresa de email nu este validă\";",
    "  if (form.phone && !RO_MOBILE.test(normalizePhone(form.phone))) errors.phone = \"Numărul de telefon nu este un mobil românesc valid\";",
    "  if (!form.message || String(form.message).trim().length < 10) errors.message = \"Mesajul trebuie să aibă cel puțin 10 caractere\";",
    "  return { ok: Object.keys(errors).length === 0, errors };",
    "}",
    "",
  ].join("\n"),
  "test/validate.test.js": [
    "import test from \"node:test\";",
    "import assert from \"node:assert/strict\";",
    "import { validateContact, normalizePhone } from \"../src/validate.js\";",
    "",
    "const valid = { name: \"Ana Popescu\", email: \"ana@example.com\", phone: \"0722 123 456\", message: \"Aș dori o ofertă pentru site.\" };",
    "",
    "test(\"a complete form is valid\", () => {",
    "  assert.deepEqual(validateContact(valid), { ok: true, errors: {} });",
    "});",
    "",
    "test(\"phone is optional but must be a Romanian mobile when present\", () => {",
    "  assert.equal(validateContact({ ...valid, phone: \"\" }).ok, true);",
    "  assert.equal(validateContact({ ...valid, phone: \"+40 722-123-456\" }).ok, true);",
    "  assert.ok(validateContact({ ...valid, phone: \"0212345678\" }).errors.phone);",
    "});",
    "",
    "test(\"email and message are required\", () => {",
    "  const r = validateContact({ ...valid, email: \"ana@\", message: \"scurt\" });",
    "  assert.ok(r.errors.email);",
    "  assert.ok(r.errors.message);",
    "});",
    "",
    "test(\"normalizePhone removes spaces and dashes\", () => {",
    "  assert.equal(normalizePhone(\"0722 123-456\"), \"0722123456\");",
    "});",
    "",
  ].join("\n"),
};

function create() {
  if (fs.existsSync(dir)) {
    if (!fs.existsSync(path.join(dir, TEST_PROJECT_MARKER))) {
      console.error(`REFUSED: ${dir} exists and is not a Hub test project; nothing was changed.`);
      process.exit(1);
    }
    console.log(`Test project already exists: ${dir}`);
    return;
  }
  for (const [rel, text] of Object.entries(FILES)) {
    const file = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  // The project's own tests must pass before it is committed.
  execFileSync(process.execPath, ["--test"], { cwd: dir, stdio: "pipe" });
  const git = (...args) => execFileSync("git", ["-C", dir, "-c", "user.name=Ifrim Agent Hub (test)", "-c", "user.email=hub-test@example.invalid", "-c", "commit.gpgsign=false", ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "Sanitized test project for Hub live validation");
  console.log(`Created ${dir} (git repo, tests pass)`);
}

async function register() {
  const base = `http://127.0.0.1:${PORT}`;
  const session = await (await fetch(`${base}/api/session`)).json();
  const res = await fetch(`${base}/api/projects/test`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Token": session.token }, body: JSON.stringify({ path: dir, name: NAME }) });
  const body = await res.json();
  if (!res.ok) { console.error(`Hub refused registration (${res.status}): ${body.error?.message || JSON.stringify(body)}`); process.exit(1); }
  const project = body.result || body;
  console.log(`Registered in the Hub: ${project.name} (${project.id}) · execution allowed: ${project.executionAllowed}${project.alreadyRegistered ? " · already registered" : ""}`);
}

create();
if (!process.argv.includes("--no-register")) await register();
