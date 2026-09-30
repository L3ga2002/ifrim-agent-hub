// Creates the simulator's synthetic demo project (no client data). Lives in v2/scripts on purpose: the Hub server
// (v2/server) never runs a mutating git command; this setup script does, only inside .ifrim/tmp/v2-sim.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** A tiny synthetic git project (no client data) with one uncommitted change, so the diff inspector has content. */
export function prepareDemoProject(dir) {
  if (fs.existsSync(path.join(dir, ".git"))) return dir;
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  put("README.md", "# Proiect demo (SIMULARE)\n\nProiect sintetic pentru revizia vizuală a Hub-ului. Nu conține date reale.\n");
  put("src/app.js", "export function contactForm(fields) {\n  return fields.filter((f) => f.required).map((f) => f.name);\n}\n");
  put("src/app.test.js", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { contactForm } from './app.js';\ntest('required fields', () => assert.deepEqual(contactForm([{ name: 'email', required: true }]), ['email']));\n");
  put("package.json", JSON.stringify({ name: "demo-project", private: true, type: "module", scripts: { test: "node --test src" } }, null, 2));
  const git = (...args) => execFileSync("git", ["-C", dir, "-c", "user.email=sim@example.invalid", "-c", "user.name=Simulator", "-c", "commit.gpgsign=false", ...args], { stdio: "pipe" });
  git("init", "-q"); git("add", "."); git("commit", "-q", "-m", "demo project");
  put("src/app.js", "export function contactForm(fields) {\n  return fields.filter((f) => f.required).map((f) => f.name.trim());\n}\n");
  return dir;
}

