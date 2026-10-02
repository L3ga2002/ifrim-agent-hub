#!/bin/bash
# ifrim-env:canary v2 (M06-A adds C18, the local-only profile; C1-C13 unchanged since M05)
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
# (loopback only), /usr read-only, empty /home, the copy at /work. Same flags as localOnlyArgs() in wsl-factory-runner.mjs.
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
LOOUT=$(env -i HOME=/home/runner USER=runner LANG=C.UTF-8 PATH=/usr/local/bin:/usr/bin:/bin bwrap --unshare-all --die-with-parent --new-session --clearenv \
  --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 --symlink usr/sbin /sbin \
  --proc /proc --dev /dev --tmpfs /tmp --tmpfs /home --bind "$LO/repo" /work --ro-bind "$LO/host" /hub --chdir /work \
  --setenv PATH /usr/local/bin:/usr/bin:/bin --setenv HOME /tmp --setenv TMPDIR /tmp --setenv LANG C.UTF-8 \
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
# Fingerprint of the environment the result belongs to
echo "FINGERPRINT distro=ifrim-runner wslconf=$(sha256sum /etc/wsl.conf | cut -c1-16) codex=$(codex --version | awk '{print $2}') config=$(sha256sum ~/.codex/config.toml | cut -c1-16) kernel=$(uname -r)"
# Cleanup of the in-distro canary files
rm -rf "$WS" "$ALT" ~/.codex/canary-marker
