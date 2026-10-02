#!/bin/bash
# ifrim-env:prepare v1 — creates one run workspace (owner-only permissions) under the Hub workspace root.
# Arg 1: the workspace path, already validated by the Hub (/home/runner/ws/hub/<id>).
set -eu
WS="$1"
case "$WS" in /home/runner/ws/hub/?*) ;; *) echo "error=workspace outside the Hub root"; exit 2 ;; esac
case "$WS" in */../*|*/..|*//*) echo "error=invalid workspace path"; exit 2 ;; esac
umask 077
mkdir -p /home/runner/ws/hub
if [ -e "$WS" ] || [ -L "$WS" ]; then echo "error=workspace exists"; exit 3; fi
mkdir -p "$WS/repo/.ifrim-tmp"
echo "ok=1"
