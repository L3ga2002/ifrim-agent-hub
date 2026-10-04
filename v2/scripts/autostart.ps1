# Starts the V2 Hub automatically when the owner logs on to Windows (after a boot or a restart), through a per-user scheduled task.
#   powershell -ExecutionPolicy Bypass -File "v2\scripts\autostart.ps1" -Install     register (or update) the task
#   powershell -ExecutionPolicy Bypass -File "v2\scripts\autostart.ps1" -Uninstall   remove it
#   powershell -ExecutionPolicy Bypass -File "v2\scripts\autostart.ps1"              status
# The task runs as the logged-on user (Interactive, no stored password, no elevation), 45 s after logon, and only calls
# autostart-run.ps1, which starts the Hub if nothing answers on 8011. The Hub needs the user's session (Codex config, WebAuthn on
# localhost), so it starts at logon, not before it. The V1 tray task ("Ifrim Agent Hub", ports 3004/8004) is separate and untouched.
param([switch]$Install, [switch]$Uninstall)
$ErrorActionPreference = "Stop"
$taskName = "Ifrim Agent Hub V2"
$user = "$env:USERDOMAIN\$env:USERNAME"
$runner = (Resolve-Path (Join-Path $PSScriptRoot "autostart-run.ps1")).Path
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Sarcina '$taskName' a fost stearsa. Hub-ul care ruleaza acum nu a fost oprit."
  } else { Write-Host "Sarcina '$taskName' nu exista." }
  exit 0
}

if ($Install) {
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`"" -WorkingDirectory $root
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
  $trigger.Delay = "PT45S" # let the desktop, OneDrive and the network settle
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  # The launcher ends in minutes; the Hub itself is created through WMI (not a child of the task), so the time limit never stops it.
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew
  $description = "Porneste Ifrim Agent Hub V2 (http://localhost:8011) la logarea in Windows, daca nu ruleaza deja. Porneste in BUILD_SAFE; nu porneste niciun model si nicio sesiune Lega. Instalat de v2\scripts\autostart.ps1; jurnal: %USERPROFILE%\IfrimHub\autostart.log."
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description $description -Force | Out-Null
  Write-Host "Sarcina '$taskName' e inregistrata: la logarea lui $user (+45 s) ruleaza $runner."
}

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) { Write-Host "Sarcina '$taskName' nu exista (instalare: -Install)."; exit 1 }
$info = Get-ScheduledTaskInfo -TaskName $taskName
Write-Host ("Sarcina: {0} - stare {1} - ultima rulare {2} - rezultat {3} - declansator la logare ({4}, intarziere {5})" -f `
  $taskName, $task.State, $info.LastRunTime, $info.LastTaskResult, $task.Triggers[0].UserId, $task.Triggers[0].Delay)
Write-Host ("Actiune: {0} {1}" -f $task.Actions[0].Execute, $task.Actions[0].Arguments)
