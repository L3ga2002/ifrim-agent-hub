#!/bin/bash
# ifrim-env:inspect v2 — metadata of the ifrim-runner environment for the Hub (M05 §12; M07 adds the browser and the reviewer).
# Prints KEY=VALUE lines only: versions, hashes, table NAMES and presence flags. Never a file's content or a secret value.
set -u
export PATH=/usr/local/bin:/usr/bin:/bin
CFG="$HOME/.codex/config.toml"
echo "schema=1"
echo "user=$(id -un)"
echo "uid=$(id -u)"
echo "groups=$(id -nG | tr ' ' ',')"
if [ -r /etc/os-release ]; then . /etc/os-release; echo "os=${PRETTY_NAME:-unknown}"; else echo "os=unknown"; fi
echo "kernel=$(uname -r)"
echo "wslconf=$(sha256sum /etc/wsl.conf 2>/dev/null | cut -c1-16)"
# wsl.conf settings that define the boundary (section.key=value for the known keys only)
awk -F= '
  /^[[:space:]]*\[/ { gsub(/[][[:space:]]/, ""); sect=$0; next }
  /^[[:space:]]*[A-Za-z]+[[:space:]]*=/ { key=$1; gsub(/[[:space:]]/, "", key); val=$2; gsub(/[[:space:]]/, "", val);
    k=sect "." key
    if (k=="automount.enabled" || k=="automount.mountFsTab" || k=="interop.enabled" || k=="interop.appendWindowsPath" || k=="user.default" || k=="gpu.enabled") print "wslconf." k "=" val }
' /etc/wsl.conf 2>/dev/null
CODEX_BIN=$(command -v codex 2>/dev/null)
echo "codex_version=$(codex --version 2>/dev/null | awk '{print $2}')"
if [ -n "$CODEX_BIN" ]; then
  REAL=$(readlink -f "$CODEX_BIN")
  echo "codex_path=$REAL"
  echo "codex_sha=$(sha256sum "$REAL" 2>/dev/null | cut -c1-16)"
  echo "codex_owner=$(stat -c %U "$REAL" 2>/dev/null)"
fi
echo "config=$(sha256sum "$CFG" 2>/dev/null | cut -c1-16)"
# Other client inputs (rules, instructions, skills, prompts, hooks): one hash over their contents; nothing is printed.
echo "codex_extras=$(find "$HOME/.codex/rules" "$HOME/.codex/AGENTS.md" "$HOME/.codex/skills" "$HOME/.codex/prompts" "$HOME/.codex/hooks" "$HOME/.codex/hooks.json" -type f 2>/dev/null | sort | xargs -r sha256sum 2>/dev/null | sha256sum | cut -c1-16)"
# Permission profile and MCP server table NAMES only.
echo "profiles=$(grep -oE '^\[permissions\.[A-Za-z0-9_-]+' "$CFG" 2>/dev/null | sed -E 's/^\[permissions\.//' | sort -u | tr '\n' ',')"
echo "mcp_servers=$(grep -oE '^\[mcp_servers\.[A-Za-z0-9_-]+' "$CFG" 2>/dev/null | sed -E 's/^\[mcp_servers\.//' | sort -u | tr '\n' ',')"
echo "mcp_inline=$(grep -cE '^[[:space:]]*mcp_servers[[:space:]]*=' "$CFG" 2>/dev/null)"
# Billing-relevant: top-level key NAMES (a custom provider or an API-key login preference), and the forced login method
# only when it is one of the two known words.
echo "config_keys=$(grep -oE '^[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=' "$CFG" 2>/dev/null | sed -E 's/[[:space:]]*=$//' | sort -u | tr '\n' ',')"
echo "forced_login_method=$(grep -E '^[[:space:]]*forced_login_method[[:space:]]*=' "$CFG" 2>/dev/null | head -1 | grep -oE '"(chatgpt|api)"' | tr -d '"')"
if [ -f "$HOME/.codex/auth.json" ]; then echo "auth_present=yes"; echo "auth_mode=$(stat -c %a "$HOME/.codex/auth.json")"; else echo "auth_present=no"; fi
echo "node_version=$(node --version 2>/dev/null)"
echo "node_path=$(readlink -f "$(command -v node 2>/dev/null)" 2>/dev/null)"
echo "npm_path=$(readlink -f "$(command -v npm 2>/dev/null)" 2>/dev/null)"
echo "bwrap=$(bwrap --version 2>/dev/null | awk '{print $2}')"
echo "tar=$(tar --version 2>/dev/null | head -1 | awk '{print $NF}')"
# M07: the E2E browser and the reviewer client, at the FIXED paths the bwrap profiles bind (names, versions, hashes, presence
# and modes only; nothing is executed). Both binaries are pinned by hash in the fingerprint: replacing one invalidates the
# attestation. The reviewer's credentials file is only stat-ed, never read.
PW=/home/runner/tools/pw/node_modules/playwright
echo "pw_version=$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$PW/package.json" 2>/dev/null | head -1)"
HS=$(ls -1d "$HOME"/.cache/ms-playwright/chromium_headless_shell-* 2>/dev/null | head -1)
echo "pw_chromium=$([ -n "$HS" ] && basename "$HS")"
echo "pw_sha=$([ -n "$HS" ] && sha256sum "$HS/chrome-headless-shell-linux64/chrome-headless-shell" 2>/dev/null | cut -c1-16)"
echo "pw_owner=$([ -n "$HS" ] && stat -c %U "$HS/chrome-headless-shell-linux64/chrome-headless-shell" 2>/dev/null)"
CC=/home/runner/tools/claude/node_modules/@anthropic-ai/claude-code
CLREAL=$(readlink -f /home/runner/tools/claude/node_modules/.bin/claude 2>/dev/null)
echo "claude_cli=$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$CC/package.json" 2>/dev/null | head -1)"
echo "claude_path=$CLREAL"
echo "claude_sha=$([ -f "$CC/bin/claude.exe" ] && sha256sum "$CC/bin/claude.exe" 2>/dev/null | cut -c1-16)"
echo "claude_owner=$([ -f "$CC/bin/claude.exe" ] && stat -c %U "$CC/bin/claude.exe" 2>/dev/null)"
RC=/home/runner/ifrim-reviewer/config
if [ -d "$RC" ]; then echo "reviewer_config=present:$(stat -c %a "$RC")"; else echo "reviewer_config=absent"; fi
if [ -f "$RC/.credentials.json" ]; then echo "reviewer_creds=present:$(stat -c %a "$RC/.credentials.json")"; else echo "reviewer_creds=absent"; fi
# The reviewer's user settings (the only ones a Hub run loads): key NAMES that could change the billing route or the model.
if [ -f "$RC/settings.json" ]; then
  node -e 'let s={};try{s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))}catch{console.log("reviewer_settings=unreadable");process.exit(0)}
const risky=["ANTHROPIC_API_KEY","ANTHROPIC_AUTH_TOKEN","ANTHROPIC_BASE_URL","ANTHROPIC_PROFILE","ANTHROPIC_FEDERATION_RULE_ID","ANTHROPIC_ORGANIZATION_ID","CLAUDE_CODE_USE_BEDROCK","CLAUDE_CODE_USE_VERTEX","CLAUDE_CODE_USE_FOUNDRY","AWS_BEARER_TOKEN_BEDROCK","CLAUDE_CODE_OAUTH_TOKEN","HTTP_PROXY","HTTPS_PROXY","ALL_PROXY"];
const env=Object.keys(s.env||{}).filter((k)=>risky.includes(k.toUpperCase()));
console.log("reviewer_settings=present");console.log("reviewer_api_key_helper="+(s.apiKeyHelper?"yes":"no"));
console.log("reviewer_fallback="+(s.fallbackModel!==undefined&&s.fallbackModel!==null&&String(s.fallbackModel)!==""?"yes":"no"));
console.log("reviewer_risky_env="+env.join(","));console.log("reviewer_hooks="+(s.hooks&&Object.keys(s.hooks).length?"yes":"no"))' "$RC/settings.json" 2>/dev/null
else
  echo "reviewer_settings=absent"
fi
if id -nG | tr ' ' '\n' | grep -qxE 'sudo|admin|wheel|root'; then echo "privileged_group=yes"; else echo "privileged_group=no"; fi
if sudo -n true >/dev/null 2>&1; then echo "sudo=allowed"; else echo "sudo=refused"; fi
echo "mnt_drives=$(ls /mnt 2>/dev/null | grep -E '^[a-z]$' | tr '\n' ',')"
echo "drvfs_mounts=$(mount 2>/dev/null | grep -ciE 'type (drvfs|9p)')"
if command -v cmd.exe >/dev/null 2>&1; then echo "interop_cmd=found"; else echo "interop_cmd=absent"; fi
if echo "$PATH" | grep -qiE '/mnt/[a-z]/'; then echo "path_windows=yes"; else echo "path_windows=no"; fi
if [ -d /home/runner/ws/hub ]; then echo "workspaces=$(ls -1 /home/runner/ws/hub 2>/dev/null | wc -l)"; else echo "workspaces=0"; fi
echo "disk_free_kb=$(df -Pk "$HOME" 2>/dev/null | awk 'NR==2{print $4}')"
echo "done=1"
