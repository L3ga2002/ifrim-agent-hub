# Starts the V2 Hub as a process that does not belong to the calling terminal, agent session or packaged app (WMI
# Win32_Process.Create: the new process gets the user's normal environment, outside any job object or MSIX container).
# It never restarts a running Hub (start.mjs refuses), registers nothing to run at logon and opens no microphone.
#   powershell -ExecutionPolicy Bypass -File "v2\scripts\start-detached.ps1"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$node = (Get-Command node -ErrorAction Stop).Source
# A shell with fnm/nvm resolves node to a per-shell link the Codex sandbox cannot launch: prefer the system install (pilot 2026-10-08).
$system = Join-Path $env:ProgramFiles "nodejs\node.exe"
if ($node -match '\\(fnm_multishells|fnm|nvm|volta)\\' -and (Test-Path $system)) { $node = $system }
$start = Join-Path $root "v2\scripts\start.mjs"
$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "`"$node`" `"$start`""; CurrentDirectory = $root }
if ($result.ReturnValue -ne 0) { Write-Host "Win32_Process.Create failed ($($result.ReturnValue))"; exit 1 }
for ($i = 0; $i -lt 80; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:8011/api/health" -TimeoutSec 2
    if ($h.ok) { Write-Host "Ifrim Agent Hub V2 $($h.version), mod $($h.mode), contract $($h.apiContract), http://localhost:8011"; exit 0 }
  } catch { }
}
Write-Host "Hub-ul nu a raspuns in 40 s; vezi v2-hub.log in folderul de date (.ifrim\private sau locatia din .ifrim\data-location.json)"
exit 1
