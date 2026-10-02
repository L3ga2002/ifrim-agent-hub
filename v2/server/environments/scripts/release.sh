#!/bin/bash
# ifrim-env:release v1 — removes one run workspace after its processes are confirmed gone (rm does not follow links).
# Arg 1: workspace path (/home/runner/ws/hub/<id>).
set -u
WS="$1"
case "$WS" in /home/runner/ws/hub/?*) ;; *) echo "error=workspace outside the Hub root"; exit 2 ;; esac
case "$WS" in */../*|*/..|*//*) echo "error=invalid workspace path"; exit 2 ;; esac
ME=$(id -u)
for p in /proc/[0-9]*; do
  pid=${p#/proc/}
  [ "$pid" = "$$" ] && continue
  [ "$(stat -c %u "$p" 2>/dev/null)" = "$ME" ] || continue
  cwd=$(readlink "$p/cwd" 2>/dev/null) || continue
  case "$cwd" in "$WS"|"$WS"/*) echo "error=process $pid still uses the workspace"; exit 4 ;; esac
done
if [ -e "$WS" ] || [ -L "$WS" ]; then rm -rf -- "$WS"; fi
if [ -e "$WS" ]; then echo "error=not removed"; exit 5; fi
echo "ok=1"
