param(
  [switch]$StartNow
)

$ErrorActionPreference = "Stop"
$taskName = "Ifrim Agent Hub"
$trayScript = Join-Path $PSScriptRoot "agent-hub-tray.ps1"

if (-not (Test-Path -LiteralPath $trayScript)) {
  throw "Launcherul Agent Hub nu exista: $trayScript"
}

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$escapedScript = $trayScript.Replace('"', '\"')
$arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$escapedScript`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Days 3650)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "Porneste Ifrim Agent Hub in system tray la logarea Windows." `
  -Force | Out-Null

if ($StartNow) {
  Start-ScheduledTask -TaskName $taskName
}

Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State, Description

