#!/bin/bash
# ifrim-env:reap v2 — ends the processes of ONE run workspace (M05 §20): processes of this user whose working directory is
# inside the workspace, or whose environment carries the run marker. Never other users, never the whole distro.
# Arg 1: workspace path (/home/runner/ws/hub/<id>); arg 2: run marker value (IFRIM_RUN=<id>) or "-"; arg 3 "all": every
# process of this user except this script (used when no other run is active, so a process that left the workspace dies too).
# The reaper never counts itself: its ancestors (wsl relay, env) and its descendants (the $(...) subshells, tr, stat, wc,
# sleep) are skipped by walking the parent chain. v1 skipped only $$ and $PPID, so in "all" mode it always found its own
# subshells and reported remaining>=1 (found before the first live probe, 2026-10-02).
set -u
WS="$1"
MARK="${2:-}"
[ "$MARK" = "-" ] && MARK=""
MODE="${3:-}"
case "$WS" in /home/runner/ws/hub/?*) ;; *) echo "error=workspace outside the Hub root"; exit 2 ;; esac
ME=$(id -u)
SELF=$$
ppid_of() {
  local s
  s=$(cat "/proc/$1/stat" 2>/dev/null) || return 1
  s=${s##*) }
  set -- $s
  echo "$2"
}
ANC=" "
a=$SELF
n=0
while [ -n "$a" ] && [ "$a" != "0" ] && [ $n -lt 64 ]; do
  ANC="$ANC$a "
  [ "$a" = "1" ] && break
  a=$(ppid_of "$a") || break
  n=$((n + 1))
done
mine() {
  local q=$1 k=0
  while [ -n "$q" ] && [ "$q" != "0" ] && [ "$q" != "1" ] && [ $k -lt 64 ]; do
    [ "$q" = "$SELF" ] && return 0
    q=$(ppid_of "$q") || return 1
    k=$((k + 1))
  done
  return 1
}
list() {
  for p in /proc/[0-9]*; do
    pid=${p#/proc/}
    case "$ANC" in *" $pid "*) continue ;; esac
    [ "$(stat -c %u "$p" 2>/dev/null)" = "$ME" ] || continue
    mine "$pid" && continue
    cwd=$(readlink "$p/cwd" 2>/dev/null) || cwd=""
    hit=""
    [ "$MODE" = "all" ] && hit=1
    case "$cwd" in "$WS"|"$WS"/*) hit=1 ;; esac
    if [ -z "$hit" ] && [ -n "$MARK" ] && tr '\0' '\n' < "$p/environ" 2>/dev/null | grep -qx "IFRIM_RUN=$MARK"; then hit=1; fi
    [ -n "$hit" ] && echo "$pid"
  done
}
FIRST=$(list | tr '\n' ' ')
echo "found=$(echo $FIRST | wc -w)"
[ -n "$FIRST" ] && kill -TERM $FIRST 2>/dev/null
for i in 1 2 3 4 5 6 7 8 9 10; do
  LEFT=$(list | tr '\n' ' ')
  [ -z "$LEFT" ] && break
  sleep 0.3
done
LEFT=$(list | tr '\n' ' ')
[ -n "$LEFT" ] && kill -KILL $LEFT 2>/dev/null && sleep 0.3
echo "killed_forced=$(echo $LEFT | wc -w)"
echo "remaining=$(list | wc -l)"
