# The logon action of the "Ifrim Agent Hub V2" scheduled task (registered by autostart.ps1 -Install).
# It starts the V2 Hub only when nothing answers on 8011; it never stops, restarts or upgrades a Hub. The Hub always starts in
# BUILD_SAFE and starts no model, no Lega session and no microphone (those stay the owner's clicks). Outcome in
# %USERPROFILE%\IfrimHub\autostart.log (last ~200 lines kept).
$ErrorActionPreference = "Continue"
$health = "http://127.0.0.1:8011/api/health"
$logDir = Join-Path $env:USERPROFILE "IfrimHub"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "autostart.log"
if ((Test-Path -LiteralPath $log) -and ((Get-Item -LiteralPath $log).Length -gt 256KB)) {
  $tail = Get-Content -LiteralPath $log -Tail 200
  Set-Content -LiteralPath $log -Value $tail -Encoding utf8
}
function Write-Log([string]$message) { "$(Get-Date -Format o) $message" | Add-Content -LiteralPath $log -Encoding utf8 }
function Get-Health { try { return Invoke-RestMethod -Uri $health -TimeoutSec 3 } catch { return $null } }

$h = Get-Health
if ($h -and $h.ok) { Write-Log "deja pornit: $($h.version), mod $($h.mode)"; exit 0 }

# M11: the working tree may hold an unreleased migration; a reboot must not apply it. A pending migration means the Hub is started
# only through the owner-approved upgrade (node v2/scripts/upgrade.mjs --apply), never by this logon task.
$guard = & node (Join-Path $PSScriptRoot "boot-guard.mjs") 2>$null | Out-String
if ($LASTEXITCODE -eq 3) { Write-Log ("NU pornesc: codul are o migrare neaplicata, care cere upgrade-ul aprobat ({0})" -f $guard.Trim()); exit 0 }

Write-Log "pornesc Hub-ul V2"
# A child PowerShell: start-detached.ps1 ends with `exit`, which would end this script too if it were dot-sourced.
$out = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "start-detached.ps1") 2>&1 | Out-String
$code = $LASTEXITCODE
Write-Log ("start-detached (cod {0}): {1}" -f $code, $out.Trim())
if ($code -eq 0) { exit 0 }

# A cold boot can be slower than start-detached's 40 s (Defender, OneDrive, disk): the Hub process keeps starting on its own,
# so wait up to 2 more minutes before reporting a failure.
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 2
  $h = Get-Health
  if ($h -and $h.ok) { Write-Log "pornit dupa asteptare suplimentara: $($h.version), mod $($h.mode)"; exit 0 }
}
Write-Log "Hub-ul nu a raspuns; vezi v2-hub.log in folderul de date (locatia din .ifrim\data-location.json)"
exit 1
