// R2 canary for the ifrim-runner WSL2 distro (M04_R2_ISOLATION_OPTIONS.md §6). Run from the Hub root:
//   node v2/tests/manual/r2-wsl-canary.mjs
// Driver on Windows: fictive tree in %TEMP%, a loopback listener, the in-distro checks, the token search (C17)
// and the restart check (C15). Fictive data only; nothing real is read. PASS_LOCAL = every check as expected.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tok = `CANARY_${crypto.randomBytes(6).toString("hex")}`;
const tree = fs.mkdtempSync(path.join(os.tmpdir(), "ifrim-r2-canary-"));
fs.mkdirSync(path.join(tree, "alt-client", "src"), { recursive: true });
fs.mkdirSync(path.join(tree, "fake-home", ".codex"), { recursive: true });
fs.writeFileSync(path.join(tree, "alt-client", ".env"), `SECRET=${tok}_A\n`);
fs.writeFileSync(path.join(tree, "alt-client", "src", "client.txt"), `${tok}_B\n`);
fs.writeFileSync(path.join(tree, "fake-home", ".codex", "config.toml"), "# fictive\n");
const guess = `/mnt/${tree[0].toLowerCase()}/${tree.slice(3).split(path.sep).join("/")}`;

const server = net.createServer((s) => { s.end(`${tok}_C\n`); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const wsl = (args, input) => spawnSync("wsl.exe", args, { input, encoding: "utf8", timeout: 600000, env: (() => { const e = { ...process.env, MSYS_NO_PATHCONV: "1" }; delete e.WSLENV; return e; })() /* the Hub launches wsl.exe with a clean environment (no WSLENV) */ });
const script = fs.readFileSync(path.join(here, "r2-wsl-canary.sh"), "utf8");
const run1 = wsl(["-d", "ifrim-runner", "--", "bash", "-s", tok, guess, String(port)], script);
const out1 = `${run1.stdout || ""}${run1.stderr || ""}`.replace(/\0/g, "");

// C15: restart the distro, wait until it stops, repeat C1-C4
spawnSync("wsl.exe", ["--terminate", "ifrim-runner"]);
await new Promise((r) => setTimeout(r, 9000));
const quick = `${script.split("# C5:")[0]}\nrm -rf "$WS" "$ALT" ~/.codex/canary-marker\n`;
const run2 = wsl(["-d", "ifrim-runner", "--", "bash", "-s", tok, guess, String(port)], quick);
const out2 = `${run2.stdout || ""}${run2.stderr || ""}`.replace(/\0/g, "").split("\n").filter((l) => /^C[1-4]/.test(l)).map((l) => l.replace(/^C/, "C15/C")).join("\n");

server.close();
fs.rmSync(tree, { recursive: true, force: true });

const all = `${out1}\n${out2}`;
// C17: none of the fictive tokens may appear in any output
const leaks = ["A", "B", "C", "D", "E", "F"].filter((s) => all.includes(`${tok}_${s}`));
console.log(out1.trim());
console.log(out2.trim());
console.log(`C17 ${leaks.length ? "FAIL" : "PASS"} token search in all outputs (expected 0 leaks, got ${leaks.length}${leaks.length ? `: ${leaks.join(",")}` : ""})`);
const lines = all.split("\n").filter((l) => /^C\d+[a-z]? (PASS|FAIL)/.test(l) || /^C15\//.test(l));
const fails = lines.filter((l) => / FAIL /.test(l)).length + (leaks.length ? 1 : 0);
console.log(`SUMMARY ${fails ? "FAIL" : "PASS_LOCAL"} · ${lines.length + 1} checks · ${fails} failed · fictive tree removed · listener closed`);
