# Controlled Hub V2 restart: graceful stop through the API (refused while runs are active), then a start that does not
# depend on this terminal (start-detached.ps1), then health. Run from anywhere:
#   powershell -ExecutionPolicy Bypass -File "v2\scripts\restart.ps1"
Set-Location (Join-Path $PSScriptRoot "..\..")
node v2/scripts/stop.mjs
if ($LASTEXITCODE -ne 0) { Write-Host "Oprirea a fost refuzata (rulari active?); nimic nu a fost repornit."; exit 1 }
& (Join-Path $PSScriptRoot "start-detached.ps1")
exit $LASTEXITCODE
