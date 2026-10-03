#!/bin/bash
# ifrim-env:reviewercleanup v1 — removes ONE reviewer session's files from the reviewer's dedicated config dir (M07): the
# transcript and the per-session state Claude Code keeps under projects/, todos/, file-history/, session-env/,
# shell-snapshots/, debug/, paste-cache/, and that session's lines in history.jsonl. They hold excerpts of the reviewed code.
# Only entries whose NAME (or history line) carries the session id; never the credentials, the settings or other sessions.
# Arg 1: the session id (a lowercase UUID). Prints counts only.
set -u
SID="${1:-}"
case "$SID" in ""|*[!0-9a-f-]*) echo "error=invalid session id"; exit 2 ;; esac
[ ${#SID} -eq 36 ] || { echo "error=invalid session id"; exit 2; }
RC=/home/runner/ifrim-reviewer/config
[ -d "$RC" ] || { echo "error=no reviewer config"; exit 3; }
n=0
for d in projects todos file-history session-env shell-snapshots debug paste-cache; do
  [ -d "$RC/$d" ] || continue
  while IFS= read -r -d '' p; do rm -rf -- "$p" && n=$((n + 1)); done < <(find "$RC/$d" -name "*$SID*" -prune -print0 2>/dev/null)
done
h=0
if [ -f "$RC/history.jsonl" ] && grep -q -- "$SID" "$RC/history.jsonl" 2>/dev/null; then
  h=$(grep -c -- "$SID" "$RC/history.jsonl")
  umask 077
  grep -v -- "$SID" "$RC/history.jsonl" > "$RC/history.jsonl.ifrim-tmp"; mv -f -- "$RC/history.jsonl.ifrim-tmp" "$RC/history.jsonl"
fi
echo "removed=$n"
echo "history_lines=$h"
echo "left=$(find "$RC" -name "*$SID*" 2>/dev/null | wc -l)"
