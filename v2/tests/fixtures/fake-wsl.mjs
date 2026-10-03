#!/usr/bin/env node
// Simulated wsl.exe + ifrim-runner distro for PASS_SIMULATED tests (M05). It never starts WSL, a model or a network call.
// Linux paths are mapped under --fake-root (/home/runner/x → <root>/home/runner/x). Options (before the wsl arguments):
//   --fake-root=<dir>      the simulated distro filesystem (required)
//   --fake-state=<file>    JSON overrides for the inspection facts and behaviours (read on every call, so tests can change it)
//   --fake-log=<file>      JSONL log: every invocation (argv, Linux env names, Windows env names), reaps, releases
//   --fake-codex=<json>    JSON array: the argv prefix that starts fake-codex.mjs (node + script + scenario options)
//   --fake-claude=<json>   (M07, optional) the argv prefix that starts fake-claude.mjs for the reviewer inside bwrap; by default
//                          fake-claude.mjs next to this file, with the scenario "claudeScenario" of the state (or "ok") and the
//                          log/queue files claude.log / claude.queue next to the state file (where tests/helpers.mjs puts them)
// Understood: `--terminate <distro>`, and `-d D -u U --cd C --exec /usr/bin/env -i K=V… <command…>` with the commands the
// Hub uses: the versioned bash scripts (by their marker), tar -x / tar -c, find -printf, codex app-server / sandbox,
// bwrap (preview host, reviewer: M06-A/M07), mkdir/rm (preflight), /bin/true.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createTarReader, tarEntry, tarEnd } from "../../server/environments/tar.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The reviewer binary inside the reviewer sandbox (sandbox-profiles.mjs CLAUDE_IN_SANDBOX): mapped to fake-claude.mjs here. */
const CLAUDE_IN_SANDBOX = "/opt/claude/node_modules/@anthropic-ai/claude-code/bin/claude.exe";

const all = process.argv.slice(2);
const opt = (name) => (all.find((a) => a.startsWith(`--fake-${name}=`)) || "").split("=").slice(1).join("=");
const args = all.filter((a) => !a.startsWith("--fake-"));
const ROOT = opt("root");
const LOG = opt("log");
const STATE_FILE = opt("state");
const CODEX = opt("codex") ? JSON.parse(opt("codex")) : null;
const CLAUDE = opt("claude") ? JSON.parse(opt("claude")) : null;
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
    const all = argv[2] === "all";
    // M07: the real reaper in "all" mode counts every process of the user but its own; another reaper running at the same
    // time is one of them (the reap race). Each in-flight reaper holds a lock file; "reapDelayMs" widens the window.
    fs.mkdirSync(ROOT, { recursive: true });
    const lock = path.join(ROOT, `.reaping-${process.pid}`);
    fs.writeFileSync(lock, ws);
    try {
      if (st.reapDelayMs) await new Promise((r) => setTimeout(r, st.reapDelayMs));
      const pids = readPids();
      const mine = (pids[ws] || []).filter(alive);
      for (const pid of mine) { try { process.kill(pid); } catch { /* gone */ } }
      await new Promise((r) => setTimeout(r, mine.length ? 200 : 0));
      const others = all ? fs.readdirSync(ROOT).filter((n) => n.startsWith(".reaping-") && n !== path.basename(lock)).length : 0;
      const remaining = st.reapLeaves ? 1 : (pids[ws] || []).filter(alive).length + others;
      pids[ws] = []; writePids(pids);
      log({ reap: ws, found: mine.length, remaining, all, concurrent: others });
      out(`found=${mine.length}\nkilled_forced=0\nremaining=${remaining}\n`);
      return 0;
    } finally { fs.rmSync(lock, { force: true }); }
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
    // M07: the prelude (the production argv as bash arrays) must come with the script; without it C18–C20 could not run.
    if (!/^LO_ARGS=\(/m.test(script) || !/^E2E_ARGS=\(/m.test(script) || !/^RV_ARGS=\(/m.test(script)) { out("fake-wsl: canary prelude missing\n"); return 3; }
    const lines = ["C1", "C1b", "C2", "C2b", "C3", "C3b", "C4", "C4b", "C4c", "C4d", "C5", "C6", "C6b", "C7a", "C7b", "C7c", "C7d", "C7e", "C8", "C9", "C10a", "C10b", "C10c", "C11", "C12a", "C12b", "C12c", "C13", "C13b", ...(st.noC18 ? [] : ["C18a", "C18b", "C18c", "C18d", "C18e", "C18f", "C18g", "C18h", "C18i"]),
      ...(st.noC19 ? [] : ["C19a", "C19b", "C19c", "C19d", "C19e", "C19f", "C19g", "C19h", "C19i"]), ...(st.noC20 ? [] : ["C20a", "C20b", "C20c", "C20d", "C20e", "C20f", "C20g", "C20h", "C20i", "C20j", "C20k"])]
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
  if (marker === "env:previewhost") {
    const dir = map(argv[0]);
    // v2 (M07): every host file is one quoted heredoc (the host, the shared E2E core, the redaction).
    const files = [...script.matchAll(/^cat > "\$D\/([a-z0-9.-]+)" <<'(IFRIM_HOST_\d+_EOF)'\n([\s\S]*?)\n\2$/gm)];
    if (!files.some((m) => m[1] === "preview-host.mjs")) { out("error=no host\n"); return 2; }
    fs.mkdirSync(dir, { recursive: true });
    for (const [, name, , body] of files) fs.writeFileSync(path.join(dir, name), `${body}\n`);
    log({ previewHostFiles: files.map((m) => m[1]) });
    out("ok=1\n");
    return 0;
  }
  if (marker === "env:reviewercleanup") {
    if (!/^[0-9a-f-]{36}$/.test(argv[0] || "")) { out("error=invalid session id\n"); return 2; }
    log({ reviewerCleanup: argv[0] });
    out(`removed=${st.reviewerCleanupLeft ? 0 : 1}\nhistory_lines=0\nleft=${st.reviewerCleanupLeft ? 1 : 0}\n`);
    return 0;
  }
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

/**
 * The simulated Playwright inside the distro (M07): a wrapper module at /home/runner/tools/pw/node_modules/playwright that
 * requires tests/fixtures/fake-playwright.cjs with this state file. Written when a bwrap call binds the Playwright dir.
 */
function writeFakePlaywright(source) {
  const dir = path.join(map(source), "node_modules", "playwright");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "playwright", version: "1.61.0", main: "index.js" }));
  fs.writeFileSync(path.join(dir, "index.js"), `module.exports = require(${JSON.stringify(path.join(HERE, "fake-playwright.cjs"))})(${JSON.stringify(STATE_FILE)});\n`);
}

/**
 * Simulated bwrap (NO namespace on Windows): binds are mapped to the fake root, the program runs in the mapped /work with the
 * --setenv variables; stdin is passed through (the preview host reads its E2E commands there, the reviewer its prompt). The
 * reviewer binary (CLAUDE_IN_SANDBOX) is fake-claude.mjs, with only the sandbox's variables (plus SystemRoot for Node).
 */
async function bwrap() {
  const a = command.slice(1);
  const binds = {}; const envs = {};
  let i = 0;
  while (i < a.length && a[i].startsWith("--")) {
    const flag = a[i];
    if (["--bind", "--ro-bind", "--ro-bind-try", "--symlink"].includes(flag)) { if (flag !== "--symlink") binds[a[i + 2]] = a[i + 1]; i += 3; }
    else if (flag === "--setenv") { envs[a[i + 1]] = a[i + 2]; i += 3; }
    else if (["--proc", "--dev", "--tmpfs", "--chdir"].includes(flag)) i += 2;
    else i += 1;
  }
  const prog = a.slice(i);
  log({ bwrap: { flags: a.slice(0, i), program: prog.slice(0, 3), envNames: Object.keys(envs).sort() } });
  if (st.bwrapFails) { process.stderr.write("bwrap: simulated failure\n"); return 1; }
  if (binds["/pw/pkg"]) writeFakePlaywright(binds["/pw/pkg"]);
  // An argument that names a bound path (the host script under /hub, Playwright under /pw/pkg) is the mapped source path.
  const dests = Object.keys(binds).sort((x, y) => y.length - x.length);
  const fix = (x) => {
    if (x === "/usr/local/bin/node") return process.execPath;
    const dest = dests.find((d) => x === d || x.startsWith(`${d}/`));
    if (dest) return path.join(map(binds[dest]), ...x.slice(dest.length).split("/").filter(Boolean));
    return x.startsWith("/home/runner") ? map(x) : x;
  };
  let exe; let argvOut; let env;
  if (prog[0] === CLAUDE_IN_SANDBOX) {
    const prefix = CLAUDE || [process.execPath, path.join(HERE, "fake-claude.mjs"), `--fake-scenario=${st.claudeScenario || "ok"}`,
      ...(STATE_FILE ? [`--fake-log=${path.join(path.dirname(STATE_FILE), "claude.log")}`, `--fake-scenario-queue=${path.join(path.dirname(STATE_FILE), "claude.queue")}`] : [])];
    [exe, ...argvOut] = [...prefix, "--fake-log-env", ...prog.slice(1)];
    env = { ...envs, SystemRoot: process.env.SystemRoot || "C:\\Windows" };
  } else {
    exe = fix(prog[0]);
    argvOut = prog.slice(1).map(fix);
    env = { ...process.env, ...envs, PATH: process.env.PATH };
  }
  const child = spawn(exe, argvOut, { cwd: map(binds["/work"]), stdio: ["pipe", "inherit", "inherit"], windowsHide: true, env });
  register(binds["/work"], child.pid);
  child.stdin.on("error", () => { /* the program ended first */ });
  process.stdin.on("error", () => { /* the caller closed it */ });
  process.stdin.pipe(child.stdin);
  const stopChild = () => { try { child.kill(); } catch { /* gone */ } };
  process.on("SIGTERM", stopChild); process.on("exit", stopChild);
  return await new Promise((resolve) => child.on("close", (code) => resolve(code ?? 1)));
}

async function main() {
  const exe = command[0];
  if (exe === "/bin/bash") return bashScript();
  if (exe === "/usr/bin/tar") return tar();
  if (exe === "/usr/bin/find") return find();
  if (exe === "/usr/local/bin/codex") return codex();
  if (exe === "/usr/bin/bwrap") return bwrap();
  if (exe === "/bin/true") return 0;
  if (exe === "/bin/mkdir") { fs.mkdirSync(map(command[command.length - 1]), { recursive: true }); return 0; }
  if (exe === "/bin/rm") { fs.rmSync(map(command[command.length - 1]), { recursive: true, force: true }); return 0; }
  console.error(`fake-wsl: unsupported command ${exe}`);
  return 127;
}

main().then((code) => { process.exitCode = code; }, (error) => { console.error(`fake-wsl: ${error.stack || error.message}`); process.exitCode = 1; });
