param(
  [switch]$OpenDashboard
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$dashboardUrl = "http://127.0.0.1:3004/"
$apiHealthUrl = "http://127.0.0.1:8004/api/health"
$privateDir = Join-Path $projectRoot ".ifrim\private"
$logDir = Join-Path $privateDir "logs"
$pidFile = Join-Path $privateDir "agent-hub-services.json"
$mutexName = "Local\IfrimDigitalAgentHubTray"

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$createdNew)
if (-not $createdNew) {
  if ($OpenDashboard) { Start-Process $dashboardUrl }
  exit 0
}

function Test-AgentHubHealth {
  try {
    $response = Invoke-WebRequest -Uri $apiHealthUrl -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -eq 200
  }
  catch {
    return $false
  }
}

function Get-PortOwner {
  param([int]$Port)

  $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $connection) { return $null }

  return Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)" -ErrorAction SilentlyContinue
}

function Test-AgentHubProcess {
  param($ProcessInfo)

  if (-not $ProcessInfo) { return $false }
  $commandLine = [string]$ProcessInfo.CommandLine
  $belongsToRoot = $commandLine.IndexOf($projectRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
  $isAgentHubApi = $commandLine -match "apps[/\\]api[/\\]src[/\\]server\.mjs"
  $isAgentHubWeb = $commandLine -match "vite(?:\.js)?" -and $commandLine -match "--port\s+3004(?:\s|$)"
  return $belongsToRoot -or $isAgentHubApi -or $isAgentHubWeb
}

function Save-ServicePids {
  param([hashtable]$Pids)

  $Pids | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8
}

function Start-AgentHubServices {
  $apiOwner = Get-PortOwner -Port 8004
  $webOwner = Get-PortOwner -Port 3004

  if ($apiOwner -and -not (Test-AgentHubProcess $apiOwner)) {
    throw "Portul 8004 este folosit de alt program. Agent Hub nu a pornit ca sa nu il opreasca sau suprascrie."
  }
  if ($webOwner -and -not (Test-AgentHubProcess $webOwner)) {
    throw "Portul 3004 este folosit de alt program. Agent Hub nu a pornit ca sa nu il opreasca sau suprascrie."
  }

  $started = @{}
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"

  if (-not $apiOwner) {
    $apiProcess = Start-Process -FilePath "node.exe" `
      -ArgumentList "apps/api/src/server.mjs" `
      -WorkingDirectory $projectRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $logDir "$stamp-api.out.log") `
      -RedirectStandardError (Join-Path $logDir "$stamp-api.err.log") `
      -PassThru
    $started.api = $apiProcess.Id
  }

  if (-not $webOwner) {
    $webProcess = Start-Process -FilePath "npm.cmd" `
      -ArgumentList "run", "dev:web" `
      -WorkingDirectory $projectRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $logDir "$stamp-web.out.log") `
      -RedirectStandardError (Join-Path $logDir "$stamp-web.err.log") `
      -PassThru
    $started.web = $webProcess.Id
  }

  if ($started.Count -gt 0) { Save-ServicePids -Pids $started }

  $deadline = (Get-Date).AddSeconds(35)
  do {
    if ((Test-AgentHubHealth) -and (Get-PortOwner -Port 3004)) { return $true }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  throw "Agent Hub nu a devenit disponibil in 35 de secunde. Verifica logurile din $logDir."
}

function Stop-AgentHubServices {
  $candidatePids = @()
  foreach ($port in @(3004, 8004)) {
    $owner = Get-PortOwner -Port $port
    if ($owner -and (Test-AgentHubProcess $owner)) {
      $candidatePids += [int]$owner.ProcessId
    }
  }

  if (Test-Path -LiteralPath $pidFile) {
    try {
      $saved = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
      $candidatePids += @($saved.api, $saved.web) | Where-Object { $_ } | ForEach-Object { [int]$_ }
    }
    catch {
      # A stale PID file must not prevent a safe shutdown.
    }
  }

  foreach ($processId in ($candidatePids | Sort-Object -Unique)) {
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
    if ($processInfo -and (Test-AgentHubProcess $processInfo)) {
      & taskkill.exe /PID $processId /T /F 2>$null | Out-Null
    }
  }

  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 700
}

function Show-AgentHubMessage {
  param(
    [string]$Message,
    [System.Windows.Forms.MessageBoxIcon]$Icon = [System.Windows.Forms.MessageBoxIcon]::Information
  )

  [System.Windows.Forms.MessageBox]::Show(
    $Message,
    "Ifrim Agent Hub",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    $Icon
  ) | Out-Null
}

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
$notifyIcon.Text = "Ifrim Agent Hub - Se porneste"
$notifyIcon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = $menu.Items.Add("Deschide Agent Hub")
$statusItem = $menu.Items.Add("Arata status")
$restartItem = $menu.Items.Add("Restart servicii")
$stopItem = $menu.Items.Add("Opreste servicii")
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$exitItem = $menu.Items.Add("Inchide iconita")
$notifyIcon.ContextMenuStrip = $menu

$openAction = {
  Start-Process $dashboardUrl
}

$openItem.add_Click($openAction)
$notifyIcon.add_DoubleClick($openAction)

$statusItem.add_Click({
  if ((Test-AgentHubHealth) -and (Get-PortOwner -Port 3004)) {
    Show-AgentHubMessage "Agent Hub este ONLINE.`nDashboard: $dashboardUrl`nAPI: $apiHealthUrl"
  }
  else {
    Show-AgentHubMessage "Agent Hub este OFFLINE. Foloseste Restart servicii pentru a-l porni." ([System.Windows.Forms.MessageBoxIcon]::Warning)
  }
})

$restartItem.add_Click({
  try {
    $notifyIcon.Text = "Ifrim Agent Hub - Restart"
    Stop-AgentHubServices
    [void](Start-AgentHubServices)
    $notifyIcon.ShowBalloonTip(3000, "Ifrim Agent Hub", "Serviciile au fost repornite.", [System.Windows.Forms.ToolTipIcon]::Info)
  }
  catch {
    Show-AgentHubMessage $_.Exception.Message ([System.Windows.Forms.MessageBoxIcon]::Error)
  }
})

$stopItem.add_Click({
  Stop-AgentHubServices
  $notifyIcon.Text = "Ifrim Agent Hub - Offline"
  $notifyIcon.ShowBalloonTip(3000, "Ifrim Agent Hub", "Serviciile au fost oprite. Iconita ramane activa.", [System.Windows.Forms.ToolTipIcon]::Warning)
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 10000
$timer.add_Tick({
  if ((Test-AgentHubHealth) -and (Get-PortOwner -Port 3004)) {
    $notifyIcon.Text = "Ifrim Agent Hub - Online"
  }
  else {
    $notifyIcon.Text = "Ifrim Agent Hub - Offline"
  }
})
$timer.Start()

$exitItem.add_Click({
  $timer.Stop()
  $notifyIcon.Visible = $false
  $notifyIcon.Dispose()
  $mutex.ReleaseMutex()
  $mutex.Dispose()
  [System.Windows.Forms.Application]::ExitThread()
})

try {
  [void](Start-AgentHubServices)
  $notifyIcon.Text = "Ifrim Agent Hub - Online"
  $notifyIcon.ShowBalloonTip(4000, "Ifrim Agent Hub", "Agent Hub este pornit. Dublu-click pe iconita pentru dashboard.", [System.Windows.Forms.ToolTipIcon]::Info)
  if ($OpenDashboard) { Start-Process $dashboardUrl }
}
catch {
  $notifyIcon.Text = "Ifrim Agent Hub - Eroare"
  $notifyIcon.ShowBalloonTip(5000, "Ifrim Agent Hub", $_.Exception.Message, [System.Windows.Forms.ToolTipIcon]::Error)
}

[System.Windows.Forms.Application]::Run()
