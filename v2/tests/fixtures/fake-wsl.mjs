#!/usr/bin/env node
// Simulated wsl.exe + ifrim-runner distro for PASS_SIMULATED tests (M05). It never starts WSL, a model or a network call.
// Linux paths are mapped under --fake-root (/home/runner/x → <root>/home/runner/x). Options (before the wsl arguments):
//   --fake-root=<dir>      the simulated distro filesystem (required)
//   --fake-state=<file>    JSON overrides for the inspection facts and behaviours (read on every call, so tests can change it)
//   --fake-log=<file>      JSONL log: every invocation (argv, Linux env names, Windows env names), reaps, releases
//   --fake-codex=<json>    JSON array: the argv prefix that starts fake-codex.mjs (node + script + scenario options)
// Understood: `--terminate <distro>`, and `-d D -u U --cd C --exec /usr/bin/env -i K=V… <command…>` with the commands the
// Hub uses: the versioned bash scripts (by their marker), tar -x / tar -c, find -printf, codex app-server / sandbox,
// mkdir/rm (preflight), /bin/true.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { createTarReader, tarEntry, tarEnd } from "../../server/environments/tar.mjs";

const all = process.argv.slice(2);
const opt = (name) => (all.find((a) => a.startsWith(`--fake-${name}=`)) || "").split("=").slice(1).join("=");
const args = all.filter((a) => !a.startsWith("--fake-"));
const ROOT = opt("root");
const LOG = opt("log");
const STATE_FILE = opt("state");
const CODEX = opt("codex") ? JSON.parse(opt("codex")) : null;
const log = (entry) => { if (LOG) fs.appendFileSync(LOG, `${JSON.stringify({ at: Date.now(), ...entry })}\n`); };
const state = () => { try { return STATE_FILE ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {}; } catch { return {}; } };
const map = (p) => (typeof p === "string" && p.startsWith("/") ? path.join(ROOT, ...p.split("/").filter(Boolean)) : p);
const PIDS = () => path.join(ROOT, ".fake-pids.json");
const readPids = () => { try { return JSON.parse(fs.readFileSync(PIDS(), "utf8")); } catch { return {}; } };
const writePids = (v) => { fs.mkdirSync(ROOT, { recursive: true }); fs.writeFileSync(PIDS(), JSON.stringify(v)); };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wsOf = (linuxPath) => (String(linuxPath).match(/^\/home\/runner\/ws\/hub\/[^/]+/) || [null])[0];
function register(linuxCwd, pid) { const ws = wsOf(linuxCwd); if (!ws) return; const p = readPids(); (p[ws] ||= []).push(pid); writePids(p); }
const out = (text) => process.stdout.write(text);

if (!ROOT) { console.error("fake-wsl: --fake-root required"); process.exit(2); }
if (args[0] === "--terminate") { log({ terminate: args[1] }); process.exit(0); }

// -d D -u U --cd C --exec /usr/bin/env -i K=V … cmd …
const take = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const distro = take("-d");
const user = take("-u");
const cwd = take("--cd");
const execAt = args.indexOf("--exec");
if (execAt < 0 || args[execAt + 1] !== "/usr/bin/env" || args[execAt + 2] !== "-i") { console.error("fake-wsl: expected --exec /usr/bin/env -i"); process.exit(2); }
let i = execAt + 3;
const linuxEnv = {};
while (i < args.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[i])) { const eq = args[i].indexOf("="); linuxEnv[args[i].slice(0, eq)] = args[i].slice(eq + 1); i += 1; }
const command = args.slice(i);
log({ distro, user, cwd, command: command.slice(0, 80), linuxEnv: Object.keys(linuxEnv).sort(), windowsEnv: Object.keys(process.env).sort() });
const st = state();
if (st.distroMissing) { process.stderr.write("There is no distribution with the supplied name.\n"); process.exit(1); }

const readStdin = () => new Promise((resolve) => { const chunks = []; process.stdin.on("data", (c) => chunks.push(c)); process.stdin.on("end", () => resolve(Buffer.concat(chunks))); });

const FACTS = {
  schema: "1", user: "runner", uid: "1000", groups: "runner", os: "Ubuntu 24.04.5 LTS (simulat)", kernel: "6.6.114.1-microsoft-standard-WSL2",
  wslconf: "b8890b2f40e0327e", "wslconf.automount.enabled": "false", "wslconf.automount.mountFsTab": "false", "wslconf.interop.enabled": "false",
  "wslconf.interop.appendWindowsPath": "false", "wslconf.user.default": "runner", "wslconf.gpu.enabled": "false", codex_version: "0.159.2",
  codex_path: "/usr/local/lib/codex/bin/codex", codex_sha: "1748767b230ebfc3", codex_owner: "root", config: "4a7c12306a171922",
  profiles: "ifrim_runner_ro,ifrim_runner_rw,", mcp_servers: "", mcp_inline: "0", config_keys: "default_permissions,", forced_login_method: "",
  auth_present: "yes", auth_mode: "600", node_version: "v24.21.0", bwrap: "0.9.0", tar: "1.35", privileged_group: "no", sudo: "refused",
  mnt_drives: "", drvfs_mounts: "0", interop_cmd: "absent", path_windows: "no", workspaces: "0", disk_free_kb: "36000000", done: "1",
};

async function bashScript() {
  const script = (await readStdin()).toString("utf8");
  const argv = command.slice(command.indexOf("--") + 1);
  const marker = (script.match(/^# ifrim-(env|c14):([a-z0-9]+)/m) || []).slice(1).join(":");
  log({ script: marker || "unknown", args: argv });
  if (marker === "env:inspect") {
    const facts = { ...FACTS, ...(st.facts || {}) };
    out(Object.entries(facts).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
    return 0;
  }
  if (marker === "env:prepare") {
    const ws = argv[0];
    if (!/^\/home\/runner\/ws\/hub\/./.test(ws)) { out("error=workspace outside the Hub root\n"); return 2; }
    if (fs.existsSync(map(ws))) { out("error=workspace exists\n"); return 3; }
    if (st.prepareFails) { out("error=simulated failure\n"); return 1; }
    if (st.prepareDelayMs) await new Promise((r) => setTimeout(r, st.prepareDelayMs));
    fs.mkdirSync(path.join(map(ws), "repo", ".ifrim-tmp"), { recursive: true });
    out("ok=1\n");
    return 0;
  }
  if (marker === "env:reap") {
    const ws = argv[0];
    const pids = readPids();
    const mine = (pids[ws] || []).filter(alive);
    for (const pid of mine) { try { process.kill(pid); } catch { /* gone */ } }
    await new Promise((r) => setTimeout(r, mine.length ? 200 : 0));
    const remaining = st.reapLeaves ? 1 : (pids[ws] || []).filter(alive).length;
    pids[ws] = []; writePids(pids);
    log({ reap: ws, found: mine.length, remaining });
    out(`found=${mine.length}\nkilled_forced=0\nremaining=${remaining}\n`);
    return 0;
  }
  if (marker === "env:release") {
    const ws = argv[0];
    if ((readPids()[ws] || []).some(alive)) { out("error=process still uses the workspace\n"); return 4; }
    fs.rmSync(map(ws), { recursive: true, force: true });
    log({ release: ws });
    out("ok=1\n");
    return 0;
  }
  if (marker === "env:canary") {
    const lines = ["C1", "C1b", "C2", "C2b", "C3", "C3b", "C4", "C4b", "C4c", "C4d", "C5", "C6", "C6b", "C7a", "C7b", "C7c", "C7d", "C7e", "C8", "C9", "C10a", "C10b", "C10c", "C11", "C12a", "C12b", "C12c", "C13", "C13b"]
      .map((id) => `${id} ${(st.canaryFail || []).includes(id) ? "FAIL" : "PASS"} simulat`);
    const f = { ...FACTS, ...(st.facts || {}) };
    out(`${lines.join("\n")}\nFINGERPRINT distro=ifrim-runner wslconf=${f.wslconf} codex=${f.codex_version} config=${f.config} kernel=${f.kernel}\n`);
    return 0;
  }
  if (marker === "c14:clean") {
    const repo = map(argv[0]);
    fs.writeFileSync(path.join(repo, "src", "app.js"), "export const value = 2; // schimbat\n");
    fs.writeFileSync(path.join(repo, "docs", "pagină nouă.md"), "pagină nouă cu diacritice: ăîșțâ\n");
    fs.writeFileSync(path.join(repo, "crlf.txt"), "linia 1\r\nlinia 2 modificată\r\n");
    fs.writeFileSync(path.join(repo, "img", "nou.png"), Buffer.from("89504e470d0a1a0a0000000d49484452000000", "hex"));
    fs.rmSync(path.join(repo, "docs", "notă veche.md"), { force: true });
    fs.mkdirSync(path.join(repo, "node_modules", "x"), { recursive: true }); fs.writeFileSync(path.join(repo, "node_modules", "x", "a.js"), "ignorat\n");
    return 0;
  }
  if (marker === "c14:hostile") { fs.writeFileSync(path.join(map(argv[0]), "..", ".fake-hostile"), "1"); return 0; }
  out(`fake-wsl: unknown script ${marker}\n`);
  return 127;
}

function walk(dir, rel = "") {
  const files = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) files.push(...walk(dir, r));
    else files.push(r);
  }
  return files;
}

async function tar() {
  const dirAt = command.indexOf("-C");
  const dir = map(command[dirAt + 1]);
  if (command.includes("-x")) {
    const reader = createTarReader({ onFile: (entry, data) => {
      const rel = entry.rawName.replace(/^\.\//, "");
      const file = path.join(dir, ...rel.split("/"));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, data);
    } });
    for await (const chunk of process.stdin) reader.push(chunk);
    const r = reader.end();
    return r.complete ? 0 : 2;
  }
  // tar -c: the workspace as GNU tar would stream it (".ifrim-tmp" excluded), plus the hostile entries when marked.
  if (st.exportDelayMs) await new Promise((r) => setTimeout(r, st.exportDelayMs));
  const parts = [tarEntry({ name: "./", type: "5", mode: 0o755 })];
  const hostile = fs.existsSync(path.join(dir, "..", ".fake-hostile"));
  // The hostile util.js entry replaces the walked one (GNU tar archives a file once, with its current mode).
  for (const rel of walk(dir).filter((r) => !r.startsWith(".ifrim-tmp/") && !(hostile && ["src/util.js", "AGENTS.md", "test/acceptance.test.mjs"].includes(r)))) {
    parts.push(tarEntry({ name: `./${rel}`, data: fs.readFileSync(path.join(dir, ...rel.split("/"))), mode: 0o644 }));
  }
  if (hostile) {
    const add = (o) => parts.push(tarEntry(o));
    add({ name: "./evil-link", type: "2", linkname: "/home/runner/.codex/auth.json" });
    add({ name: "./evil-dir-link", type: "2", linkname: "/etc" });
    add({ name: "./hard-link.js", type: "1", linkname: "./src/util.js" });
    add({ name: "./pipe-fifo", type: "6" });
    add({ name: "./.env.local", data: Buffer.from("SECRET=fictiv\n") });
    add({ name: "./AGENTS.md", data: Buffer.from("# instrucțiuni fictive\n# modificat\n") });
    add({ name: "./test/acceptance.test.mjs", data: Buffer.from("// test protejat (fictiv)\n// modificat\n") });
    add({ name: "./README.MD", data: Buffer.from("dublura\n") });
    add({ name: "./con.txt", data: Buffer.from("x\n") });
    add({ name: "./trail.", data: Buffer.from("x\n") });
    add({ name: "./a:b.txt", data: Buffer.from("x\n") });
    add({ name: "./back\\slash.txt", data: Buffer.from("x\n") });
    add({ name: "./tool.exe", data: Buffer.from([0x4d, 0x5a, 0, 0, 1, 2]) });
    add({ name: "./src/util.js", data: fs.readFileSync(path.join(dir, "src", "util.js")), mode: 0o755 });
    add({ name: "./.codex/config.toml", data: Buffer.from('model_provider = "x"\n') });
    add({ name: "./big.bin", data: Buffer.alloc(17000000) });
    add({ name: "./GIT~1/hooks/pre-commit", data: Buffer.from("#!/bin/sh\necho hook\n"), mode: 0o755 });
    add({ name: "./sub/.GIT/config", data: Buffer.from("[core]\n\tfsmonitor = evil\n") });
    add({ name: "./src/.git", data: Buffer.from("gitdir: ../evil\n") });
    add({ name: "./Node_Modules/.bin/x.cmd", data: Buffer.from("echo x\n") });
    add({ name: "./src/CLAUDE.md", data: Buffer.from("# instrucțiuni ascunse\n") });
    add({ name: "./.github/workflows/ci.yml", data: Buffer.from("on: push\n") });
    add({ name: "./x.scf", data: Buffer.from("[Shell]\nIconFile=\\\\attacker\\x\n") });
  }
  if (st.exportExtra) for (const e of st.exportExtra) parts.push(tarEntry({ name: e.name, data: Buffer.from(e.data || ""), type: e.type || "0", linkname: e.linkname || "", mode: e.mode || 0o644 }));
  parts.push(tarEnd());
  // A later duplicate replaces an earlier entry on extraction; here the Hub must see both (the hostile util.js mode change).
  for (const p of parts) { if (!process.stdout.write(p)) await new Promise((r) => process.stdout.once("drain", r)); }
  return 0;
}

function find() {
  const dir = map(command[1]);
  const files = walk(dir).filter((r) => !r.startsWith(".ifrim-tmp/"));
  out(files.map((r) => `${fs.statSync(path.join(dir, ...r.split("/"))).size}\n`).join(""));
  return 0;
}

const mapArgs = (list) => (list[0] === "/bin/true" ? [process.execPath, "-e", "0"]
  : list.map((a) => (a === "/usr/local/bin/node" ? process.execPath : typeof a === "string" && a.startsWith("/home/runner") ? map(a) : a)));

function mapDeep(value) {
  if (typeof value === "string") return value.startsWith("/home/runner") ? map(value) : value;
  if (Array.isArray(value)) return value.map(mapDeep);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapDeep(v)]));
  return value;
}

async function codex() {
  if (!CODEX) { console.error("fake-wsl: --fake-codex not configured"); return 2; }
  if (command[1] === "sandbox") {
    const sep = command.indexOf("--");
    const run = mapArgs(command.slice(sep + 1));
    const profile = command[command.indexOf("-P") + 1];
    const dir = map(command[command.indexOf("-C") + 1]);
    log({ sandbox: { profile, cwd: command[command.indexOf("-C") + 1], command: command.slice(sep + 1), nodeOptions: linuxEnv.NODE_OPTIONS ?? null } });
    // M05 pre-probe: a canned output (TAP as measured in ifrim-runner) to exercise the BLOCKED/FAIL classification.
    if (typeof st.sandboxOutput === "string") { process.stdout.write(st.sandboxOutput); return st.sandboxExit ?? 1; }
    if (st.sandboxSocketRefusal) { process.stderr.write("Error: listen EPERM: operation not permitted 127.0.0.1:4000\n"); return 1; }
    const child = spawn(run[0], run.slice(1), { cwd: dir, stdio: ["ignore", "inherit", "inherit"], windowsHide: true });
    register(cwd, child.pid);
    return await new Promise((resolve) => child.on("close", (code) => resolve(code ?? 1)));
  }
  if (command.includes("app-server")) {
    const codexArgs = command.slice(1);
    const child = spawn(CODEX[0], [...CODEX.slice(1), ...codexArgs], { cwd: map(cwd), stdio: ["pipe", "inherit", "inherit"], windowsHide: true });
    register(cwd, child.pid);
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", (line) => { let msg; try { msg = JSON.parse(line); } catch { return; } child.stdin.write(`${JSON.stringify(mapDeep(msg))}\n`); });
    rl.on("close", () => { try { child.stdin.end(); } catch { /* gone */ } });
    return await new Promise((resolve) => child.on("close", (code) => resolve(code ?? 1)));
  }
  console.error("fake-wsl: unsupported codex command");
  return 2;
}

async function main() {
  const exe = command[0];
  if (exe === "/bin/bash") return bashScript();
  if (exe === "/usr/bin/tar") return tar();
  if (exe === "/usr/bin/find") return find();
  if (exe === "/usr/local/bin/codex") return codex();
  if (exe === "/bin/true") return 0;
  if (exe === "/bin/mkdir") { fs.mkdirSync(map(command[command.length - 1]), { recursive: true }); return 0; }
  if (exe === "/bin/rm") { fs.rmSync(map(command[command.length - 1]), { recursive: true, force: true }); return 0; }
  console.error(`fake-wsl: unsupported command ${exe}`);
  return 127;
}

main().then((code) => { process.exitCode = code; }, (error) => { console.error(`fake-wsl: ${error.stack || error.message}`); process.exitCode = 1; });
