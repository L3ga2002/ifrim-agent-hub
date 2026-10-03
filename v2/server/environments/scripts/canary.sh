#!/bin/bash
# ifrim-env:canary v3 (M06-A adds C18, the local-only profile; M07 adds C19, Chromium with its own sandbox in that profile,
# and C20, the read-only reviewer's sandbox; C1-C13 unchanged since M05). The bwrap argv of C18-C20 (LO_ARGS, E2E_ARGS,
# RV_ARGS), the reviewer binary path (CLAUDE_IN) and ifrim_host_files come from the prelude canary.mjs prepends.
# R2 canary inside ifrim-runner (M04_R2_ISOLATION_OPTIONS.md §6), fictive files only, no model, no prompt.
# Args: $1 token prefix (CANARY_xxxx), $2 Windows-side fictive tree path as /mnt/c/... guess, $3 Windows listener port.
# Prints one line per check: "<id> PASS|FAIL <what>". Never prints file contents (exit codes and counts only).
set -u
export PATH="$HOME/.local/bin:$PATH"
TOK="$1"; WINTREE="$2"; PORT="$3"
WS=/home/runner/ws/canary-ws
ALT=/home/runner/ws/alt-ws
rm -rf "$WS" "$ALT"; mkdir -p "$WS" "$ALT"
printf 'canary workspace\n' > "$WS/README.md"
printf 'SECRET=%s_D\n' "$TOK" > "$WS/.env"
printf '%s_E\n' "$TOK" > "$ALT/secret.txt"
printf '%s_F\n' "$TOK" > ~/.codex/canary-marker
res() { if [ "$2" = "$3" ]; then echo "$1 PASS $4 (expected $2, got $3)"; else echo "$1 FAIL $4 (expected $2, got $3)"; fi; }
# The sandbox is started the way the wsl-runner will start it: a clean environment (no WSL/GUI variables).
CLEAN="env -i HOME=/home/runner USER=runner LOGNAME=runner LANG=C.UTF-8 PATH=/usr/local/bin:/usr/bin:/bin"
sbx() { local prof="$1"; shift; $CLEAN codex sandbox -P "$prof" -C "$WS" -- "$@" >/dev/null 2>>/home/runner/canary-sbx.err; echo $?; }
ok() { [ "$1" = 0 ] && echo ALLOWED || echo DENIED; }

# C1: no Windows drives
if ls /mnt 2>/dev/null | grep -qE '^(c|d|e)$'; then c1=present; else c1=absent; fi
res C1 absent "$c1" "/mnt/c, /mnt/d"
if mount | grep -qiE 'drvfs|9p.*(aname=drvfs|C:)'; then m=present; else m=absent; fi
res C1b absent "$m" "drvfs mounts"
# C2: guessed Windows paths
[ -e "$WINTREE/alt-client/.env" ] && c2=exists || c2=ENOENT
res C2 ENOENT "$c2" "guessed Windows path of the fictive tree"
[ -e /mnt/c/Users ] && c2b=exists || c2b=ENOENT
res C2b ENOENT "$c2b" "/mnt/c/Users"
# C3: no root, no manual mount
mkdir -p /tmp/x; mount -t drvfs C: /tmp/x >/dev/null 2>&1 && c3=mounted || c3=refused
res C3 refused "$c3" "mount -t drvfs C:"
sudo -n true >/dev/null 2>&1 && c3b=root || c3b=refused
res C3b refused "$c3b" "sudo -n true"
# C4: no interop, no Windows PATH
command -v cmd.exe >/dev/null 2>&1 && c4=found || c4=absent
res C4 absent "$c4" "cmd.exe"
command -v powershell.exe >/dev/null 2>&1 && c4b=found || c4b=absent
res C4b absent "$c4b" "powershell.exe"
echo "$PATH" | grep -qiE '/mnt/[a-z]/|windows' && c4c=windows || c4c=clean
res C4c clean "$c4c" "PATH"
# The WSLInterop binfmt entry belongs to the shared WSL kernel (it cannot be removed here without breaking the owner's
# other distros); what matters is that this distro cannot launch a Windows program through it.
printf 'MZ\x90\x00' > /tmp/canary-pe.exe; chmod +x /tmp/canary-pe.exe
PEOUT=$(timeout 20 /tmp/canary-pe.exe 2>&1); PECODE=$?; rm -f /tmp/canary-pe.exe
[ "$PECODE" = 0 ] && c4d=launched || c4d=refused
res C4d refused "$c4d" "launch of a Windows PE through interop (exit $PECODE)"
# C5: inventory of WSL-provided mounts (names only)
echo "C5 INFO /mnt/wsl: $(ls /mnt/wsl 2>/dev/null | tr '\n' ' ')"
echo "C5 INFO /mnt/wslg: $(ls /mnt/wslg 2>/dev/null | tr '\n' ' ')"
echo "C5 INFO /usr/lib/wsl: $(ls /usr/lib/wsl 2>/dev/null | tr '\n' ' ')"
if find /mnt/wsl /mnt/wslg /usr/lib/wsl -maxdepth 3 2>/dev/null | grep -qiE '/Users/|mihai|OneDrive|Desktop'; then c5=userdata; else c5=none; fi
res C5 none "$c5" "Windows user data under WSL mounts"
# C6: Windows loopback listener not reachable from the distro (NAT)
HOSTIP=$(ip route 2>/dev/null | awk '/default/ {print $3; exit}')
timeout 4 bash -c "exec 3<>/dev/tcp/$HOSTIP/$PORT" >/dev/null 2>&1 && c6=connected || c6=refused
res C6 refused "$c6" "Windows 127.0.0.1:$PORT via host $HOSTIP"
timeout 4 bash -c "exec 3<>/dev/tcp/$HOSTIP/8011" >/dev/null 2>&1 && c6b=connected || c6b=refused
res C6b refused "$c6b" "Hub port 8011 via host $HOSTIP"
# C7-C13: model-command sandbox (codex sandbox, profile from ~/.codex/config.toml)
res C7a ALLOWED "$(ok "$(sbx ifrim_runner_rw cat README.md)")" "RW read in workspace"
res C7b ALLOWED "$(ok "$(sbx ifrim_runner_rw sh -c 'echo x > new.txt')")" "RW write in workspace"
# Outside the workspace the sandbox root is a tmpfs: a write may "succeed" there but must never reach the real disk.
sbx ifrim_runner_rw sh -c 'echo x > /home/runner/ws/outside.txt' >/dev/null
[ -e /home/runner/ws/outside.txt ] && c7c=ALLOWED || c7c=DENIED
res C7c DENIED "$c7c" "RW write outside workspace reaching the real disk"
rm -f /home/runner/ws/outside.txt
sbx ifrim_runner_rw sh -c 'echo x > /tmp/canary-tmp-probe' >/dev/null
[ -e /tmp/canary-tmp-probe ] && c7d=ALLOWED || c7d=DENIED
res C7d DENIED "$c7d" "write to the distro /tmp (shared between runs)"
res C7e ALLOWED "$(ok "$(sbx ifrim_runner_rw sh -c 'mkdir -p .tmp && TMPDIR=$PWD/.tmp node -e "require(\"fs\").writeFileSync(require(\"os\").tmpdir()+\"/n.txt\",\"z\")"')")" "node with a per-run TMPDIR inside the workspace"
rm -f /tmp/canary-tmp-probe
res C8 DENIED "$(ok "$(sbx ifrim_runner_ro sh -c 'echo x > ro.txt')")" "RO write in workspace"
res C9 DENIED "$(ok "$(sbx ifrim_runner_rw cat "$ALT/secret.txt")")" "other workspace secret (E)"
res C10a DENIED "$(ok "$(sbx ifrim_runner_rw cat /home/runner/.codex/canary-marker)")" "~/.codex marker (F)"
res C10b DENIED "$(ok "$(sbx ifrim_runner_rw cat /home/runner/.codex/config.toml)")" "~/.codex/config.toml"
res C10c DENIED "$(ok "$(sbx ifrim_runner_rw test -r /home/runner/.codex/auth.json)")" "test -r ~/.codex/auth.json"
res C11 DENIED "$(ok "$(sbx ifrim_runner_rw cat .env)")" "workspace .env (D)"
res C12a DENIED "$(ok "$(sbx ifrim_runner_rw getent hosts openai.com)")" "DNS"
res C12b DENIED "$(ok "$(sbx ifrim_runner_rw bash -c 'exec 3<>/dev/tcp/1.1.1.1/443')")" "TCP to a public host"
res C12c DENIED "$(ok "$(sbx ifrim_runner_rw bash -c "exec 3<>/dev/tcp/$HOSTIP/$PORT")")" "TCP to the Windows host"
ENVOUT=$($CLEAN codex sandbox -P ifrim_runner_rw -C "$WS" -- env 2>/dev/null)
echo "C13 INFO sandbox env names: $(echo "$ENVOUT" | cut -d= -f1 | tr '
' ' ')"
echo "$ENVOUT" | grep -qiE 'WSLENV|/mnt/[a-z]/|WINDIR|USERPROFILE|APPDATA' && c13=windows || c13=clean
res C13 clean "$c13" "environment inside the sandbox ($(echo "$ENVOUT" | wc -l) variables)"
res C13b DENIED "$(ok "$(sbx ifrim_runner_rw cat /mnt/wslg/versions.txt)")" "real /mnt/wslg content inside the sandbox"
echo "C13 INFO /proc entries visible in sandbox: $($CLEAN codex sandbox -P ifrim_runner_rw -C "$WS" -- ls /proc 2>/dev/null | wc -l)"
echo "SBX-WARN $(grep -ciE 'warn|compat|fallback|namespace' /home/runner/canary-sbx.err 2>/dev/null) warning lines from codex sandbox"
grep -iE 'warn|compat|fallback|namespace' /home/runner/canary-sbx.err 2>/dev/null | sort -u | head -3 | sed 's/^/SBX-WARN /'
rm -f /home/runner/canary-sbx.err
# C18 (M06-A): the LOCAL-ONLY profile used for the preview of project code — bwrap as this user, own network namespace
# (loopback only), /usr read-only, empty /home, the copy at /work. LO_ARGS is the production argv (localOnlyArgs, from the
# prelude canary.mjs generates out of sandbox-profiles.mjs), not a copy of it.
LO=/home/runner/ws/hub/canary-lo
rm -rf "$LO"; mkdir -p "$LO/repo" "$LO/host"
cat > "$LO/host/probe.mjs" <<'IFRIM_LO_EOF'
import http from "node:http";
import fs from "node:fs";
const out = {};
const s = http.createServer((q, r) => r.end("lo-ok"));
await new Promise((r) => s.listen(4173, "127.0.0.1", r));
try { out.loopback = await (await fetch("http://127.0.0.1:4173/")).text(); } catch { out.loopback = "error"; }
const reach = async (u) => { try { const c = new AbortController(); const t = setTimeout(() => c.abort(), 2500); await fetch(u, { signal: c.signal }); clearTimeout(t); return "REACHED"; } catch { return "blocked"; } };
out.internet = await reach("http://1.1.1.1/");
out.dns = await reach("http://example.com/");
out.host = await reach("http://" + process.argv[2] + ":" + process.argv[3] + "/");
for (const [k, p] of [["codex", "/home/runner/.codex"], ["mnt", "/mnt/c"], ["ws", "/home/runner/ws"]]) { try { fs.readdirSync(p); out[k] = "VISIBLE"; } catch { out[k] = "hidden"; } }
try { fs.writeFileSync("/usr/.lo-probe", "x"); out.usr = "writable"; } catch { out.usr = "readonly"; }
try { fs.writeFileSync("/work/w.txt", "x"); out.work = "writable"; } catch { out.work = "readonly"; }
console.log("LO " + JSON.stringify(out));
s.close();
IFRIM_LO_EOF
LOOUT=$(env -i HOME=/home/runner USER=runner LANG=C.UTF-8 PATH=/usr/local/bin:/usr/bin:/bin bwrap "${LO_ARGS[@]}" \
  /usr/local/bin/node /hub/probe.mjs "$HOSTIP" "$PORT" 2>/dev/null | grep '^LO ' | head -1)
loval() { echo "$LOOUT" | grep -o "\"$1\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }
res C18a lo-ok "$(loval loopback)" "loopback inside the local-only namespace (preview answers itself)"
res C18b blocked "$(loval internet)" "public internet from the local-only namespace"
res C18c blocked "$(loval dns)" "DNS from the local-only namespace"
res C18d blocked "$(loval host)" "Windows host listener from the local-only namespace"
res C18e hidden "$(loval codex)" "~/.codex inside the local-only namespace"
res C18f hidden "$(loval mnt)" "/mnt/c inside the local-only namespace"
res C18g hidden "$(loval ws)" "other run workspaces inside the local-only namespace"
res C18h readonly "$(loval usr)" "/usr inside the local-only namespace"
res C18i writable "$(loval work)" "the project copy inside the local-only namespace"
rm -rf "$LO"
# C19 (M07): Chromium for the E2E inside the SAME local-only profile with the browser binds (E2E_ARGS = production
# localOnlyArgs({ browser: true }): Playwright and the headless shell read-only, /etc/fonts), started with its OWN sandbox
# (chromiumSandbox, never --no-sandbox). First alone (no Hub proxy flags: what the namespace lets Chromium reach, the
# sandbox the kernel reports in /proc), then through the production E2E core and launch options (post-redirect-get).
E2=/home/runner/ws/hub/canary-e2e
rm -rf "$E2"
if [ ! -d /home/runner/tools/pw/node_modules/playwright ] || ! ls -d "$HOME"/.cache/ms-playwright/chromium_headless_shell-* >/dev/null 2>&1; then
  echo "C19 FAIL Playwright/Chromium for Linux not installed at the fixed paths (E2E stays blocked in the environment)"
else
mkdir -p "$E2/repo" "$E2/host"
ifrim_host_files "$E2/host"
cat > "$E2/host/c19.mjs" <<'IFRIM_C19_EOF'
import http from "node:http";
import fs from "node:fs";
import { createRequire } from "node:module";
import { runE2ESteps, browserLaunchOptions, measureChromiumSandbox } from "/hub/browser-core.mjs";
const [hostIp, hostPort] = process.argv.slice(2);
const out = {};
const pw = createRequire("/pw/pkg/c19.js")("playwright");
let posts = 0;
const site = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  if (req.method === "POST" && req.url === "/form") { posts += 1; req.resume(); res.writeHead(303, { location: "/done" }); res.end(); return; }
  if (req.url === "/done") { res.end(`<title>done</title><p id="n">posts=${posts}</p>`); return; }
  res.end(`<title>Canary ăîșțâ</title><form method="post" action="/form"><button id="b" type="submit">Trimite</button></form>`);
});
await new Promise((r) => site.listen(4176, "127.0.0.1", r));
const origin = "http://127.0.0.1:4176";
const reach = async (page, url) => { try { await page.goto(url, { timeout: 8000 }); return "REACHED"; } catch { return "blocked"; } };
const sandboxes = [];
let raw = null;
try {
  raw = await pw.chromium.launch({ chromiumSandbox: true, headless: true, args: ["--disable-dev-shm-usage"] });
  const page = await raw.newPage();
  await page.goto(`${origin}/`, { timeout: 20000 });
  out.title = (await page.title()) === "Canary ăîșțâ" ? "ok" : "wrong";
  sandboxes.push(measureChromiumSandbox(fs));
  out.internet = await reach(page, "http://93.184.215.14/");
  out.dns = await reach(page, "http://example.com/");
  out.host = await reach(page, `http://${hostIp}:${hostPort}/`);
} catch (e) { out.error = String(e.message).split("\n")[0].slice(0, 160); }
finally { if (raw) await raw.close().catch(() => {}); }
try {
  const result = await runE2ESteps({ base: `${origin}/`, id: "e2e-canary-c19", stepTimeoutMs: 15000,
    steps: [{ goto: "/" }, { click: "#b" }, { expectText: "posts=1" }, { goto: "/done" }, { expectText: "posts=1" }],
    launch: (o) => { const opt = browserLaunchOptions(o); return pw.chromium.launch({ ...opt, args: [...opt.args, "--disable-dev-shm-usage"] }); },
    afterSteps: async () => { sandboxes.push(measureChromiumSandbox(fs)); return null; } });
  const posted = result.network.redirects.some((r) => r.method === "POST" && r.status === 303);
  out.prg = result.status === "PASS" && posts === 1 && posted ? "prg" : `${result.status}/${posts}/${posted}/${(result.steps.find((s) => !s.ok) || {}).error || ""}`.slice(0, 120).replace(/"/g, "'");
} catch (e) { out.prg = `error ${String(e.message).split("\n")[0].slice(0, 100)}`.replace(/"/g, "'"); }
const measured = sandboxes.length === 2;
out.seccomp = measured && sandboxes.every((s) => s.rendererSeccomp && s.rendererNoNewPrivs) ? "2" : measured ? "not-2" : "unmeasured";
out.userns = measured && sandboxes.every((s) => s.rendererOwnUserNs) ? "own" : measured ? "shared" : "unmeasured";
out.nosandbox = measured && sandboxes.every((s) => !s.noSandboxFlag) ? "absent" : measured ? "present" : "unmeasured";
out.renderers = sandboxes.map((s) => s.renderers).join("+");
const seen = (p) => { try { fs.readdirSync(p); return true; } catch { return false; } };
out.paths = ["/home/runner/.codex", "/mnt/c", "/home/runner/ws"].some(seen) ? "VISIBLE" : "hidden";
site.close();
console.log("E2E " + JSON.stringify(out));
process.exit(0);
IFRIM_C19_EOF
C19OUT=$(env -i HOME=/home/runner USER=runner LANG=C.UTF-8 PATH=/usr/local/bin:/usr/bin:/bin timeout 240 bwrap "${E2E_ARGS[@]}" \
  /usr/local/bin/node /hub/c19.mjs "$HOSTIP" "$PORT" 2>/dev/null | grep '^E2E ' | head -1)
c19v() { echo "$C19OUT" | grep -o "\"$1\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }
res C19a ok "$(c19v title)" "Chromium (own sandbox) loads a loopback page with Romanian diacritics in the title, inside the namespace"
res C19b blocked "$(c19v internet)" "public internet (93.184.215.14) from Chromium without the Hub proxy flags"
res C19c blocked "$(c19v dns)" "DNS (example.com) from Chromium without the Hub proxy flags"
res C19d 2 "$(c19v seccomp)" "every renderer in seccomp-bpf mode 2 with NoNewPrivs (/proc, both launches)"
res C19e own "$(c19v userns)" "every renderer in a user namespace other than the browser's (Chromium namespace sandbox)"
res C19f absent "$(c19v nosandbox)" "--no-sandbox in any Chromium command line (renderers seen: $(c19v renderers))"
res C19g hidden "$(c19v paths)" "~/.codex, /mnt/c and the other workspaces from the browser's namespace"
res C19h prg "$(c19v prg)" "production E2E core: form POST answered 303, one POST, GET of the target, no resubmit"
res C19i blocked "$(c19v host)" "Windows host listener ($HOSTIP:$PORT) from Chromium"
fi
rm -rf "$E2"
# C20 (M07): the READ-ONLY reviewer's boundary with the EXACT production argv (RV_ARGS = reviewerArgs()): the copy read-only
# at /work, no host home or other workspaces, the dedicated config dir as the only entry of the reviewer's home, the
# network shared (the client must reach Anthropic) but not the Windows host, a clean environment; then the real client
# inside it: --version and `auth status` (no prompt, no model; only loggedIn/authMethod/apiProvider are read).
RV=/home/runner/ws/hub/canary-rv
rm -rf "$RV"
if [ ! -x /home/runner/tools/claude/node_modules/@anthropic-ai/claude-code/bin/claude.exe ] || [ ! -d /home/runner/ifrim-reviewer/config ]; then
  echo "C20 FAIL Claude Code or the reviewer's config dir not installed at the fixed paths (the review stays on Windows)"
else
mkdir -p "$RV/repo"; printf 'reviewer canary\n' > "$RV/repo/README.md"
RVOUT=$(env -i HOME=/home/runner USER=runner LANG=C.UTF-8 PATH=/usr/local/bin:/usr/bin:/bin timeout 90 bwrap "${RV_ARGS[@]}" \
  /usr/local/bin/node --input-type=module - "$HOSTIP" "$PORT" 2>/dev/null <<'IFRIM_C20_EOF' | grep '^RV ' | head -1
import fs from "node:fs";
import net from "node:net";
import dns from "node:dns/promises";
const [hostIp, hostPort] = process.argv.slice(2);
const out = {};
try { fs.writeFileSync("/work/.c20-write", "x"); out.work = "WRITABLE"; } catch (e) { out.work = e.code === "EROFS" ? "readonly" : `err-${e.code}`; }
const seen = (p) => { try { fs.readdirSync(p); return "VISIBLE"; } catch { return "hidden"; } };
out.codex = seen("/home/runner/.codex"); out.ws = seen("/home/runner/ws"); out.mnt = seen("/mnt/c");
let entries = []; try { entries = fs.readdirSync("/rhome"); } catch { /* none */ }
let mode = "none"; try { mode = (fs.statSync("/rhome/.claude-config/.credentials.json").mode & 0o777).toString(8); } catch { /* absent */ }
out.rhome = entries.length === 1 && entries[0] === ".claude-config" ? `only-config:${mode}` : `entries-${entries.length}:${mode}`;
const tcp = (host, port, ms = 4000) => new Promise((resolve) => {
  if (!host) return resolve("blocked");
  const s = net.connect({ host, port }); const t = setTimeout(() => { s.destroy(); resolve("blocked"); }, ms);
  s.on("connect", () => { clearTimeout(t); s.destroy(); resolve("connected"); }); s.on("error", () => { clearTimeout(t); resolve("blocked"); });
});
out.host = await tcp(hostIp, Number(hostPort));
out.hub = await tcp(hostIp, 8011);
try { await dns.lookup("api.anthropic.com"); out.api = await tcp("api.anthropic.com", 443, 8000); } catch { out.api = "dns-failed"; }
const names = Object.keys(process.env);
out.env = names.some((n) => /^(WSL|WINDIR|USERPROFILE|APPDATA|LOCALAPPDATA|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|OPENAI_API_KEY)/i.test(n)) || /\/mnt\//.test(process.env.PATH || "") ? "windows" : "clean";
out.names = String(names.length);
console.log("RV " + JSON.stringify(out));
IFRIM_C20_EOF
)
rvv() { echo "$RVOUT" | grep -o "\"$1\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }
res C20a readonly "$(rvv work)" "/work (the reviewed copy) inside the reviewer sandbox"
res C20b hidden "$(rvv codex)" "/home/runner/.codex inside the reviewer sandbox"
res C20c hidden "$(rvv ws)" "the other workspaces (/home/runner/ws) inside the reviewer sandbox"
res C20d hidden "$(rvv mnt)" "/mnt/c inside the reviewer sandbox"
res C20e only-config:600 "$(rvv rhome)" "the reviewer's home holds only its config dir; credentials file mode (stat only, never read)"
res C20f blocked "$(rvv host)" "Windows host listener ($HOSTIP:$PORT) from the reviewer sandbox"
res C20g blocked "$(rvv hub)" "Hub port 8011 on the Windows host from the reviewer sandbox"
res C20h connected "$(rvv api)" "api.anthropic.com resolves and TCP 443 connects (no request sent)"
res C20i clean "$(rvv env)" "environment names inside the reviewer sandbox ($(rvv names) variables)"
CLV=$(env -i HOME=/home/runner USER=runner LANG=C.UTF-8 PATH=/usr/local/bin:/usr/bin:/bin timeout 60 bwrap "${RV_ARGS[@]}" "$CLAUDE_IN" --version 2>/dev/null | head -1 | awk '{print $1}')
[ -n "$CLV" ] && c20j=runs || c20j=failed
res C20j runs "$c20j" "Claude Code ${CLV:-?} runs inside the reviewer sandbox (--version)"
AUTHV=$(env -i HOME=/home/runner USER=runner LANG=C.UTF-8 PATH=/usr/local/bin:/usr/bin:/bin timeout 90 bwrap "${RV_ARGS[@]}" "$CLAUDE_IN" auth status --json 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{try{const j=JSON.parse(s);console.log(`${j.loggedIn}/${j.authMethod}/${j.apiProvider}`)}catch{console.log("unparsable")}})')
res C20k "true/claude.ai/firstParty" "$AUTHV" "claude auth status inside the reviewer sandbox (no model; only loggedIn/authMethod/apiProvider read)"
fi
rm -rf "$RV"
# Fingerprint of the environment the result belongs to
echo "FINGERPRINT distro=ifrim-runner wslconf=$(sha256sum /etc/wsl.conf | cut -c1-16) codex=$(codex --version | awk '{print $2}') config=$(sha256sum ~/.codex/config.toml | cut -c1-16) kernel=$(uname -r)"
# Cleanup of the in-distro canary files
rm -rf "$WS" "$ALT" ~/.codex/canary-marker
