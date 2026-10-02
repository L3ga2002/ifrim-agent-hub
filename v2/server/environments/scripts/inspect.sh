#!/bin/bash
# ifrim-env:inspect v1 — metadata of the ifrim-runner environment for the Hub (M05 §12).
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
# M06-A: what a later install would add (names/versions only): a Playwright Chromium for Linux, a Claude Code client.
echo "pw_chromium=$(ls -1d "$HOME"/.cache/ms-playwright/chromium* 2>/dev/null | head -1 | xargs -r basename)"
echo "claude_cli=$(command -v claude >/dev/null 2>&1 && claude --version 2>/dev/null | head -1 | awk '{print $1}')"
if id -nG | tr ' ' '\n' | grep -qxE 'sudo|admin|wheel|root'; then echo "privileged_group=yes"; else echo "privileged_group=no"; fi
if sudo -n true >/dev/null 2>&1; then echo "sudo=allowed"; else echo "sudo=refused"; fi
echo "mnt_drives=$(ls /mnt 2>/dev/null | grep -E '^[a-z]$' | tr '\n' ',')"
echo "drvfs_mounts=$(mount 2>/dev/null | grep -ciE 'type (drvfs|9p)')"
if command -v cmd.exe >/dev/null 2>&1; then echo "interop_cmd=found"; else echo "interop_cmd=absent"; fi
if echo "$PATH" | grep -qiE '/mnt/[a-z]/'; then echo "path_windows=yes"; else echo "path_windows=no"; fi
if [ -d /home/runner/ws/hub ]; then echo "workspaces=$(ls -1 /home/runner/ws/hub 2>/dev/null | wc -l)"; else echo "workspaces=0"; fi
echo "disk_free_kb=$(df -Pk "$HOME" 2>/dev/null | awk 'NR==2{print $4}')"
echo "done=1"
