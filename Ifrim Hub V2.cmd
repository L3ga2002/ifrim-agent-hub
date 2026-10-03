@echo off
rem Ifrim Agent Hub V2: starts the Hub if it is not running, checks its health, opens Lega on http://localhost:8011.
rem It never restarts a running Hub, opens the microphone or starts a model.
cd /d "%~dp0"
node v2\scripts\open.mjs %*
if errorlevel 1 pause
