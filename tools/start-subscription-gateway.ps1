param([switch]$ApprovedHub018)
$ErrorActionPreference = 'Stop'
if (-not $ApprovedHub018) { throw 'HUB-018 approval required' }
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$state = Join-Path $root '.ifrim\private\openclaw-subscription-runtime'
$node = Join-Path $env:APPDATA 'fnm\node-versions\v24.16.0\installation\node.exe'
& $node (Join-Path $PSScriptRoot 'verify-subscription-boundary.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Physical isolation boundary verification failed before maintenance lock' }
$maintenancePath = Join-Path $state 'maintenance.lock'
$maintenance = [IO.File]::Open($maintenancePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
& (Join-Path $PSScriptRoot 'protect-subscription-state.ps1')
$configPath = Join-Path $state 'openclaw.json'
$raw = Get-Content -LiteralPath $configPath -Raw
$config = $raw | ConvertFrom-Json
if ($raw.Contains('"$include"') -or $config.env -and $config.env.psobject.Properties.Count -gt 0) { throw 'Environment/includes require a separate audit' }
if (Test-Path -LiteralPath (Join-Path $state '.env')) { throw 'Global dotenv requires a separate audit' }
$listeners = Get-NetTCPConnection -State Listen -ErrorAction Stop
if ($listeners | Where-Object { $_.LocalPort -in @(18789,18790) }) { throw 'Stop the existing Gateway officially before controlled startup' }
& $node (Join-Path $PSScriptRoot 'audit-subscription-isolation.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Subscription-only startup audit failed; Gateway was not started' }
& $node (Join-Path $PSScriptRoot 'audit-isolated-runtime.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Native runtime audit failed; Gateway was not started' }
$entry = Join-Path $env:APPDATA 'npm\node_modules\openclaw\dist\index.js'
$info = New-Object System.Diagnostics.ProcessStartInfo
$info.FileName = $node
$launcher = Join-Path $PSScriptRoot 'launch-isolated-gateway.mjs'
$info.Arguments = '"' + $launcher + '" "' + $root + '" "' + $entry + '"'
$info.WorkingDirectory = $state
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.RedirectStandardOutput = $true
$info.RedirectStandardError = $true
$info.EnvironmentVariables.Clear()
foreach ($name in @('SystemRoot','WINDIR','COMSPEC','USERPROFILE','USERNAME','USERDOMAIN','APPDATA','LOCALAPPDATA','TEMP','TMP','ProgramFiles','ProgramFiles(x86)','ProgramData','HOMEDRIVE','HOMEPATH')) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if ($value) { $info.EnvironmentVariables[$name] = $value }
}
$claudeBin = Join-Path $env:APPDATA 'npm\node_modules\@anthropic-ai\claude-code\bin'
$info.EnvironmentVariables['PATH'] = $claudeBin + ';' + (Split-Path -Parent $node) + ';' + (Join-Path $env:APPDATA 'npm') + ';' + (Join-Path $env:SystemRoot 'System32') + ';' + (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0') + ';C:\Program Files\Git\cmd'
$info.EnvironmentVariables['OPENCLAW_STATE_DIR'] = $state
$info.EnvironmentVariables['OPENCLAW_CONFIG_PATH'] = $configPath
$info.EnvironmentVariables['OPENCLAW_LOAD_SHELL_ENV'] = '0'
$info.EnvironmentVariables['OPENCLAW_SKIP_CRON'] = '1'
$info.EnvironmentVariables['OPENCLAW_LIVE_CLI_BACKEND_PRESERVE_ENV'] = ''
$launchProcess = [Diagnostics.Process]::Start($info)
$launchOutput = $launchProcess.StandardOutput.ReadToEnd()
$launchError = $launchProcess.StandardError.ReadToEnd()
$launchProcess.WaitForExit()
if ($launchProcess.ExitCode -ne 0) { throw ('Isolated launch failed: ' + $launchError) }
$launch = $launchOutput | ConvertFrom-Json
$process = [Diagnostics.Process]::GetProcessById($launch.pid)
$startedAt = $process.StartTime.ToUniversalTime().ToString('o')
$deadline = [DateTime]::UtcNow.AddSeconds(300)
do {
  $process.Refresh()
  if ($process.HasExited) { throw ('Gateway exited before readiness; inspect private log: ' + $launch.stderrPath) }
  $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq 18790)
  if ($listeners.Count -gt 0) {
    if (@($listeners | Where-Object OwningProcess -ne $launch.pid).Count -gt 0) { throw 'Gateway port belongs to a different process' }
    break
  }
  if ([DateTime]::UtcNow -ge $deadline) { throw ('Gateway readiness timed out; PID: ' + $launch.pid) }
  Start-Sleep -Milliseconds 500
} while ($true)
$private = Join-Path (Split-Path -Parent $PSScriptRoot) '.ifrim\private'
$receipt = @{
  port = 18790
  projectRoot = $root
  pid = $process.Id
  startedAt = $startedAt
  executable = $node
  executableSha256 = (Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash.ToLowerInvariant()
  environmentPolicy = 'allowlist-subscription-only-v1'
  workingDirectory = $state
  configSha256 = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash.ToLowerInvariant()
  entrypoint = $entry
  entrypointSha256 = (Get-FileHash -LiteralPath $entry -Algorithm SHA256).Hash.ToLowerInvariant()
  preloadPath = Join-Path $root 'tools\hidden-gateway-preload.mjs'
  preloadSha256 = (Get-FileHash -LiteralPath (Join-Path $root 'tools\hidden-gateway-preload.mjs') -Algorithm SHA256).Hash.ToLowerInvariant()
  childPolicySha256 = (Get-FileHash -LiteralPath (Join-Path $root 'apps\api\src\hidden-child-process.mjs') -Algorithm SHA256).Hash.ToLowerInvariant()
  rpcDiagnosticsSha256 = (Get-FileHash -LiteralPath (Join-Path $root 'apps\api\src\gateway-rpc-diagnostics.mjs') -Algorithm SHA256).Hash.ToLowerInvariant()
  environment = @{}
  stdoutPath = $launch.stdoutPath
  stderrPath = $launch.stderrPath
}
foreach ($key in $info.EnvironmentVariables.Keys) { $receipt.environment[$key] = $info.EnvironmentVariables[$key] }
[IO.File]::WriteAllText((Join-Path $private 'subscription-gateway-receipt.json'), ($receipt | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))
[pscustomobject]$receipt | Select-Object pid,startedAt,environmentPolicy | ConvertTo-Json -Compress
} finally {
  $maintenance.Dispose()
  Remove-Item -LiteralPath $maintenancePath -ErrorAction Stop
}
